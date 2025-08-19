import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

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
  supa: ReturnType<typeof getSupabaseAdmin>,
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
  supa: ReturnType<typeof getSupabaseAdmin>,
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
      const { data, error } = await supa.storage.from(bucket).list(pfx, {
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
        const isFolder = anyEntry?.id == null; // folders have null id
        if (!entry.name) continue;
        if (isFolder) {
          const nextPrefix = pfx ? `${pfx}/${entry.name}` : entry.name;
          queue.push(nextPrefix);
          pageFolders.push(entry.name);
        } else {
          // Hide placeholder/dot files (e.g., .emptyFolderPlaceholder created by dashboards)
          const baseName = String(entry.name || '');
          if (baseName.startsWith('.')) continue;
          const path = pfx ? `${pfx}/${entry.name}` : entry.name;
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path, name: entry.name, size, updatedAt });
          pageFiles.push(entry.name);
        }
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
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
  const url = new URL(req.url);
  const prefix = url.searchParams.get('prefix') || 'Egenkontroller';
  const debug = url.searchParams.get('debug') === '1';
  const modeParam = url.searchParams.get('mode'); // 'db' | 'bfs'
  const envMode = process.env.SUPABASE_LIST_MODE; // 'db' | 'bfs'
  const preferDb = modeParam ? modeParam === 'db' : envMode ? envMode !== 'bfs' : true;
  const trace: TraceEntry[] = [];
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
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // No need to sign here; client uses /api/storage/download
  if (debug) {
    const meta = {
      bucket,
      supabaseHost: (process.env.SUPABASE_URL || '').replace(/^(https?:\/\/)?/i, '').replace(/\/$/, ''),
      now: new Date().toISOString(),
    };
    return NextResponse.json({ files, trace, meta }, { status: 200, headers });
  }
  return NextResponse.json({ files }, { status: 200, headers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
