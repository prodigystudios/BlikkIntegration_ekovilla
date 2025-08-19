import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function listRecursive(supa: ReturnType<typeof getSupabaseAdmin>, bucket: string, prefix = '') {
  const out: Array<{ path: string; name: string; size?: number; updatedAt?: string }> = [];
  let page = 0;
  const pageSize = 100;
  // BFS: list folder, enqueue subfolders
  const queue: string[] = [prefix];
  while (queue.length) {
    const pfx = queue.shift()!;
    page = 0;
    for (;;) {
      const { data, error } = await supa.storage.from(bucket).list(pfx || undefined, {
        limit: pageSize,
        offset: page * pageSize,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const anyEntry = entry as any;
        // Hardened folder detection: folders often have null id and no metadata
        const isFolder = (anyEntry?.id == null) && (anyEntry?.metadata == null);
        if (entry.name && isFolder) {
          const nextPrefix = pfx ? `${pfx}/${entry.name}` : entry.name;
          queue.push(nextPrefix);
          continue;
        }
        if (entry.name && !isFolder) {
          const path = pfx ? `${pfx}/${entry.name}` : entry.name;
          const size = anyEntry?.metadata?.size as number | undefined;
          const updatedAt = (anyEntry?.updated_at || anyEntry?.created_at) as string | undefined;
          out.push({ path, name: entry.name, size, updatedAt });
        }
      }
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
  const prefix = url.searchParams.get('prefix') || '';
  const files = await listRecursive(supa, bucket, prefix);
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
      const { data: top } = await supa.storage.from(bucket).list(prefix || undefined, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
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
