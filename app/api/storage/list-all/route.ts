import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getStorageAdminOrThrow, listAllQuerySchema, routeError, sanitizePrefix, sanitizeStoragePath } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FileRow = { path: string; name: string; size?: number; updatedAt?: string };
type TraceEntry = {
  scope: string; // '' for root or the prefix string
  page: number;
  count: number;
  folders: string[];
  files: string[];
};

async function listViaDb(
  supa: ReturnType<typeof getStorageAdminOrThrow>,
  bucket: string,
  prefix = 'Egenkontroller',
  trace?: TraceEntry[]
) {
  const out: Array<FileRow> = [];
  const pageSize = 1000;
  const like = `${prefix.replace(/\/*$/, '')}/%`;
  let from = 0;
  for (;;) {
    const { data, error } = await (supa as any)
      .schema('storage')
      .from('objects')
      .select('name, metadata, updated_at')
      .eq('bucket_id', bucket)
      .ilike('name', like)
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    const pageFiles: string[] = [];
    for (const row of data as any[]) {
      const full = String(row.name || '');
      const base = full.split('/').pop() || full;
      if (!full.startsWith(prefix + '/') || base.startsWith('.')) continue;
      const mimetype = row?.metadata?.mimetype as string | undefined;
      if (mimetype && !/pdf|octet-stream/i.test(mimetype)) continue; // only pdf-like
      const size = row?.metadata?.size as number | undefined;
      const updatedAt = (row?.updated_at) as string | undefined;
      out.push({ path: full, name: base, size, updatedAt });
      pageFiles.push(base);
    }
    trace?.push({ scope: '::db', page: Math.floor(from / pageSize), count: data.length, folders: [], files: pageFiles });
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function listRecursive(
  supa: ReturnType<typeof getStorageAdminOrThrow>,
  bucket: string,
  prefix = 'Egenkontroller',
  trace?: TraceEntry[]
) {
  const out: Array<FileRow> = [];
  const pageSize = 100;
  const queue: string[] = [prefix];

  while (queue.length) {
    const pfx = queue.shift()!;
    let page = 0;
    for (;;) {
  const listPath = pfx === '' ? undefined : pfx;
  const { data, error } = await supa.storage.from(bucket).list(listPath as any, {
        limit: pageSize,
        offset: page * pageSize,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      const pageFolders: string[] = [];
      const pageFiles: string[] = [];
      for (const entry of data) {
        const anyEntry = entry as any;
        if (!entry.name) continue;
        const hasSize = typeof anyEntry?.metadata?.size === 'number';
        const hasStringId = typeof anyEntry?.id === 'string' && anyEntry.id.length > 0;
        const looksLikePdf = /\.pdf$/i.test(entry.name);
        const isFile = hasSize || hasStringId || looksLikePdf;
        if (!isFile) {
          const nextPrefix = pfx ? `${pfx}/${entry.name}` : entry.name;
          queue.push(nextPrefix);
          pageFolders.push(entry.name);
          continue;
        }
        // Hide placeholder/dot files (e.g., .emptyFolderPlaceholder created by dashboards)
        const baseName = String(entry.name || '');
        if (baseName.startsWith('.')) continue;
        const path = pfx ? `${pfx}/${entry.name}` : entry.name;
        const size = anyEntry?.metadata?.size as number | undefined;
        const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
        out.push({ path, name: entry.name, size, updatedAt });
        pageFiles.push(entry.name);
      }
      trace?.push({ scope: pfx, page, count: data.length, folders: pageFolders, files: pageFiles });
      if (data.length < pageSize) break;
      page++;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
  // Ensure this route is never cached by Vercel Data Cache
  noStore();
    const parsedQuery = listAllQuerySchema.safeParse({
      prefix: req.nextUrl.searchParams.get('prefix') || undefined,
      debug: req.nextUrl.searchParams.get('debug') || undefined,
      all: req.nextUrl.searchParams.get('all') || undefined,
      check: req.nextUrl.searchParams.get('check') || undefined,
      mode: req.nextUrl.searchParams.get('mode') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const supa = getStorageAdminOrThrow();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
  const url = new URL(req.url);
  const hasPrefix = url.searchParams.has('prefix');
  const rawPrefix = parsedQuery.data.prefix;
  let prefix = hasPrefix ? (rawPrefix ?? '') : 'Egenkontroller';
  const debug = parsedQuery.data.debug === '1';
  const modeParam = parsedQuery.data.mode; // 'db' | 'bfs'
  const envMode = process.env.SUPABASE_LIST_MODE; // 'db' | 'bfs'
  const preferDb = modeParam ? modeParam === 'db' : envMode ? envMode !== 'bfs' : true;
  prefix = sanitizePrefix(prefix);
  if (parsedQuery.data.all === '1') prefix = '';
  const checkPath = parsedQuery.data.check;
  const trace: TraceEntry[] = [];
  // Targeted existence check for diagnostics
  if (checkPath) {
    const safeCheckPath = sanitizeStoragePath(checkPath);
    const dir = safeCheckPath.includes('/') ? safeCheckPath.substring(0, safeCheckPath.lastIndexOf('/')) : '';
    const name = safeCheckPath.split('/').pop() || safeCheckPath;
    const listPath = dir === '' ? undefined : dir;
    const { data, error } = await supa.storage.from(bucket).list(listPath as any, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (error) return routeError(500, 'storage_check_failed', error.message);
    const match = (data || []).find((e: any) => e?.name === name);
    return NextResponse.json({ exists: !!match, dir, name, bucket }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  }
  let files: Array<FileRow> = [];
  if (preferDb) {
    try {
      files = await listViaDb(supa, bucket, prefix, debug ? trace : undefined);
    } catch {
      // Fallback to storage.list BFS if DB query is not available
      files = await listRecursive(supa, bucket, prefix, debug ? trace : undefined);
    }
  } else {
    files = await listRecursive(supa, bucket, prefix, debug ? trace : undefined);
  }
    // sign links
  const headers = new Headers({
    'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
    'Pragma': 'no-cache',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
  });
  // No need to sign here; client uses /api/storage/download
  if (debug) {
    const meta = {
      bucket,
      supabaseHost: (process.env.SUPABASE_URL || '').replace(/^(https?:\/\/)?/i, '').replace(/\/$/, ''),
      now: new Date().toISOString(),
  effectivePrefix: prefix,
  preferredMode: preferDb ? 'db' : 'bfs',
    };
    return NextResponse.json({ files, trace, meta }, { status: 200, headers });
  }
  return NextResponse.json({ files }, { status: 200, headers });
  } catch (err: any) {
    const message = err?.message === 'Invalid path' ? 'Invalid path' : err.message;
    const status = err?.message === 'Invalid path' ? 400 : 500;
    return routeError(status, status === 400 ? 'validation_error' : 'storage_list_all_failed', message);
  }
}
