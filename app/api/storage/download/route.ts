import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
    const { searchParams } = new URL(req.url);
    const path = (searchParams.get('path') || '').trim();
    if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    if (path.includes('..')) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

    const { data, error } = await supa.storage.from(bucket).download(path);
    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'File not found' }, { status: 404 });
    }

  const fileName = path.split('/').pop() || 'file';
  const arr = await data.arrayBuffer();

  return new NextResponse(arr, {
      status: 200,
      headers: {
        'Content-Type': data.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName).replace(/%20/g, ' ')}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
