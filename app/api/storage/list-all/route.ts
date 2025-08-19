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

async function listRecursive(
  supa: ReturnType<typeof getSupabaseAdmin>,
  bucket: string,
  prefix = '',
  trace?: TraceEntry[]
) {
  const out: Array<FileRow> = [];
  const pageSize = 100;
  const queue: string[] = [];

  // If starting from root, explicitly list root once to seed all top-level folders and files
  if (!prefix) {
    let page = 0;
    let entriesCountForPrefix = 0;
    let filesAddedForPrefix = 0;
    let foldersAddedForPrefix = 0;
  for (;;) {
      const { data, error } = await supa.storage.from(bucket).list('', {
        limit: pageSize,
        offset: page * pageSize,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      entriesCountForPrefix += data.length;
    const pageFolders: string[] = [];
    const pageFiles: string[] = [];
    for (const entry of data) {
        const anyEntry = entry as any;
        const isFolder = anyEntry?.id == null; // Supabase list: folders have null id
        if (entry.name && isFolder) {
          queue.push(entry.name);
          foldersAddedForPrefix++;
      pageFolders.push(entry.name);
        } else if (entry.name) {
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path: entry.name, name: entry.name, size, updatedAt });
          filesAddedForPrefix++;
      pageFiles.push(entry.name);
        }
      }
    trace?.push({ scope: '', page, count: data.length, folders: pageFolders, files: pageFiles });
      if (data.length < pageSize) break;
      page++;
    }
    // Fallback: do a fresh one-shot root list and ensure all folders are enqueued
    const { data: topOnce } = await supa.storage.from(bucket).list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    const existing = new Set(queue);
  for (const entry of topOnce || []) {
      const anyEntry = entry as any;
      const isFolder = anyEntry?.id == null;
      if (entry.name && isFolder && !existing.has(entry.name)) {
        queue.push(entry.name);
        foldersAddedForPrefix++;
      }
    }
  // (no debug)
  } else {
    queue.push(prefix);
  }

  // BFS for all queued folders
  while (queue.length) {
    const pfx = queue.shift()!;
    let page = 0;
    let filesAddedForPrefix = 0;
    let foldersAddedForPrefix = 0;
    let entriesCountForPrefix = 0;
    for (;;) {
      const { data, error } = await supa.storage.from(bucket).list(pfx, {
        limit: pageSize,
        offset: page * pageSize,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      entriesCountForPrefix += data.length;
      const pageFolders: string[] = [];
      const pageFiles: string[] = [];
      for (const entry of data) {
        const anyEntry = entry as any;
        const isFolder = anyEntry?.id == null;
        if (entry.name && isFolder) {
          const nextPrefix = pfx ? `${pfx}/${entry.name}` : entry.name;
          queue.push(nextPrefix);
          foldersAddedForPrefix++;
          pageFolders.push(entry.name);
          continue;
        }
        if (entry.name && !isFolder) {
          const path = pfx ? `${pfx}/${entry.name}` : entry.name;
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path, name: entry.name, size, updatedAt });
          filesAddedForPrefix++;
          pageFiles.push(entry.name);
        }
      }
      trace?.push({ scope: pfx, page, count: data.length, folders: pageFolders, files: pageFiles });
      if (data.length < pageSize) break;
      page++;
    }
  // (no debug)
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
  const url = new URL(req.url);
  const prefix = url.searchParams.get('prefix') || '';
  const debug = url.searchParams.get('debug') === '1';
  const trace: TraceEntry[] = [];
  const files = await listRecursive(supa, bucket, prefix, debug ? trace : undefined);
    // sign links
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // No need to sign here; client uses /api/storage/download
  if (debug) {
    return NextResponse.json({ files, trace }, { status: 200, headers });
  }
  return NextResponse.json({ files }, { status: 200, headers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
