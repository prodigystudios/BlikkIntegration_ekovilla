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
    const baseName = String(fileName || 'file.pdf');
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '.pdf';

    let finalPath = '';
    let lastErr: any = null;
    for (let i = 0; i < 10; i++) {
      const suffix = i === 0 ? '' : `-${i + 1}`;
      const candidateName = `${stem}${suffix}${ext}`;
      const candidatePath = `${fixedFolder}/${candidateName}`;
      const { data, error } = await supa.storage.from(bucket).upload(candidatePath, bytes, {
        contentType: 'application/pdf',
        upsert: false,
        metadata: metadata as any,
      });
      if (!error) {
        finalPath = data?.path || candidatePath;
        break;
      }
      lastErr = error;
  const msg = String((error as any)?.message || '').toLowerCase();
  const isConflict = msg.includes('exists') || msg.includes('duplicate') || msg.includes('409');
      if (!isConflict) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // else continue to try a new suffix
    }
    if (!finalPath) {
      return NextResponse.json({ error: lastErr?.message || 'Kunde inte spara filen (namnkonflikt)' }, { status: 500 });
    }

  // Index writing removed — single folder strategy keeps listing simple and consistent

    // Get a signed URL valid for 7 days
    const { data: signed, error: sErr } = await supa.storage.from(bucket).createSignedUrl(finalPath, 60 * 60 * 24 * 7);
    if (sErr) {
      return NextResponse.json({ path: finalPath }, { status: 201 });
    }

  // Invalidate archive list caches across regions so the new PDF appears immediately
  try { revalidateTag('archive-list'); } catch {}
  return NextResponse.json({ path: finalPath, url: signed?.signedUrl }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
