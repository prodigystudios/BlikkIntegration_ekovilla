import { NextResponse } from 'next/server';
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
        // Heuristic: folders have metadata === null and may include id=null; files have metadata object
        if (entry.name && (entry as any).metadata == null) {
          // Supabase marks folders as entries with null metadata
          queue.push(pfx ? `${pfx}/${entry.name}` : entry.name);
        } else if (entry.name) {
          const path = pfx ? `${pfx}/${entry.name}` : entry.name;
          const anyEntry = entry as any;
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

export async function GET() {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
    const files = await listRecursive(supa, bucket, '');
    // sign links
    const withLinks = await Promise.all(files.map(async (f) => {
      // Use download option to set Content-Disposition=attachment so browsers download instead of opening inline
      const { data } = await supa.storage
        .from(bucket)
        .createSignedUrl(f.path, 60 * 60 * 24 * 2, { download: f.name });
      return { ...f, url: data?.signedUrl };
    }));
    return NextResponse.json({ files: withLinks }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
