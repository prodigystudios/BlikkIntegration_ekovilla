import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FileRow = { path: string; name: string; size?: number; updatedAt?: string };
type PrefixDiag = { prefix: string; entries: number; filesAdded: number; foldersAdded: number };

async function listRecursive(
  supa: ReturnType<typeof getSupabaseAdmin>,
  bucket: string,
  prefix = '',
  diag?: PrefixDiag[]
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
      for (const entry of data) {
        const anyEntry = entry as any;
        const nameLower = String(entry.name || '').toLowerCase();
        const looksLikeFileByExt = /\.(pdf|png|jpg|jpeg|gif|txt|csv|doc|docx|xlsx|json)$/i.test(nameLower);
        const isFolder = (anyEntry?.id == null) && (anyEntry?.metadata == null) && !looksLikeFileByExt;
        if (entry.name && isFolder) {
          queue.push(entry.name);
          foldersAddedForPrefix++;
        } else if (entry.name) {
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path: entry.name, name: entry.name, size, updatedAt });
          filesAddedForPrefix++;
        }
      }
      if (data.length < pageSize) break;
      page++;
    }
    if (diag) diag.push({ prefix: '', entries: entriesCountForPrefix, filesAdded: filesAddedForPrefix, foldersAdded: foldersAddedForPrefix });
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
      for (const entry of data) {
        const anyEntry = entry as any;
        const nameLower = String(entry.name || '').toLowerCase();
        const looksLikeFileByExt = /\.(pdf|png|jpg|jpeg|gif|txt|csv|doc|docx|xlsx|json)$/i.test(nameLower);
        const isFolder = (anyEntry?.id == null) && (anyEntry?.metadata == null) && !looksLikeFileByExt;
        if (entry.name && isFolder) {
          const nextPrefix = pfx ? `${pfx}/${entry.name}` : entry.name;
          queue.push(nextPrefix);
          foldersAddedForPrefix++;
          continue;
        }
        if (entry.name && !isFolder) {
          const path = pfx ? `${pfx}/${entry.name}` : entry.name;
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path, name: entry.name, size, updatedAt });
          filesAddedForPrefix++;
        }
      }
      if (data.length < pageSize) break;
      page++;
    }
    if (diag) diag.push({ prefix: pfx, entries: entriesCountForPrefix, filesAdded: filesAddedForPrefix, foldersAdded: foldersAddedForPrefix });
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
  const url = new URL(req.url);
  const prefix = url.searchParams.get('prefix') || '';
  const diags: PrefixDiag[] | undefined = url.searchParams.get('debug') ? [] : undefined;
  const files = await listRecursive(supa, bucket, prefix, diags);
    // sign links
    const withLinks = await Promise.all(files.map(async (f) => {
      // Use download option to set Content-Disposition=attachment so browsers download instead of opening inline
      const { data } = await supa.storage
        .from(bucket)
        .createSignedUrl(f.path, 60 * 60 * 24 * 2, { download: f.name });
      return { ...f, url: data?.signedUrl };
    }));
  const debug = url.searchParams.get('debug');
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (debug) {
      // Gather extra diagnostics to understand prod differences
  const { data: buckets } = await supa.storage.listBuckets();
  const { data: top } = await supa.storage.from(bucket).list(prefix || '', { limit: 200, sortBy: { column: 'name', order: 'asc' } });
      const host = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '');
      return NextResponse.json(
        {
          files: withLinks,
          debug: {
            bucket,
            supabaseHost: host,
            count: withLinks.length,
            prefix,
            buckets,
            topLevel: top,
            prefixes: diags,
          },
        },
        { status: 200, headers }
      );
    }
    return NextResponse.json({ files: withLinks }, { status: 200, headers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
