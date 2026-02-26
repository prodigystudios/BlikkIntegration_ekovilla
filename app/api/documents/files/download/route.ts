import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCurrentUser } from '../../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const supabase = createRouteHandlerClient({ cookies });
  const admin = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get('id') || '').trim();
  const download = (searchParams.get('download') || '').trim();
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('documents_files')
    .select('storage_bucket, storage_path, file_name')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const bucket = String((data as any).storage_bucket);
  const path = String((data as any).storage_path);
  const fileName = String((data as any).file_name || 'file');

  const shouldDownload = download === '1' || download.toLowerCase() === 'true';
  const { data: signed, error: sErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 30, shouldDownload ? { download: fileName } : undefined);
  if (sErr || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, error: sErr?.message || 'failed_signed_url' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
}
