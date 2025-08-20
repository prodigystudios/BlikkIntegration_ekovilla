import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';

    const body = await req.json();
    const {
      fileName, // suggested name
      pdfBytesBase64, // base64 string (no data: prefix)
      metadata = {}, // optional
      // folder ignored now; we save under a single prefix to avoid listing inconsistencies
    } = body || {};

    if (!fileName || !pdfBytesBase64) {
      return NextResponse.json({ error: 'fileName and pdfBytesBase64 are required' }, { status: 400 });
    }

    const bytes = Buffer.from(pdfBytesBase64, 'base64');
  const fixedFolder = 'Egenkontroller';
  const path = `${fixedFolder}/${fileName}`;

    const { data, error } = await supa.storage.from(bucket).upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
      metadata: metadata as any,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

  // Index writing removed — single folder strategy keeps listing simple and consistent

    // Get a signed URL valid for 7 days
    const { data: signed, error: sErr } = await supa.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (sErr) {
      return NextResponse.json({ path: data?.path }, { status: 201 });
    }

  // Invalidate archive list caches across regions so the new PDF appears immediately
  try { revalidateTag('archive-list'); } catch {}
  return NextResponse.json({ path: data?.path, url: signed?.signedUrl }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
