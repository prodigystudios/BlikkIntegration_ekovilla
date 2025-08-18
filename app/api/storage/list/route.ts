import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
    const { searchParams } = new URL(req.url);
    const prefix = (searchParams.get('prefix') || '').replace(/[^\w/.-]+/g, '_');

    const { data, error } = await supa.storage.from(bucket).list(prefix || undefined, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Generate signed links for convenience
    const entries = await Promise.all((data || []).map(async (file) => {
      if (!file?.name) return null;
      const path = `${prefix ? prefix + '/' : ''}${file.name}`;
      const { data: signed } = await supa.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 2);
  const size = (file as any)?.metadata?.size ?? undefined;
  return { path, name: file.name, size, url: signed?.signedUrl };
    }));

    return NextResponse.json({ files: entries.filter(Boolean) }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
