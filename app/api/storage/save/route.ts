import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    // Diagnostics: capture env presence (not values) for debugging intermittent 'No API key' issues
    try {
      const dbg = {
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 10,
        hasAnonKey: !!process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.length > 10,
        hasUrl: !!process.env.SUPABASE_URL && /https?:\/\//.test(process.env.SUPABASE_URL),
        bucketEnv: process.env.SUPABASE_BUCKET || 'pdfs',
        runtime: process.env.NEXT_RUNTIME || 'node',
        nodeVersion: process.version,
      };
      // Only log in development to avoid noisy production logs; toggle by env if needed
      if (process.env.NODE_ENV !== 'production') {
        console.log('[storage/save] env diagnostics', dbg);
      }
    } catch {}
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
    const MAX_SUFFIX_TRIES = 15; // a few more than before
    for (let i = 0; i < MAX_SUFFIX_TRIES; i++) {
      const suffix = i === 0 ? '' : `-${i}`; // now -1, -2 etc (i=1 => -1)
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
      try {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('no api key')) {
          console.error('[storage/save] Upload attempt failed due to missing API key header. Attempt index:', i, 'candidatePath:', candidatePath, 'rawError:', error);
        }
        const isConflict = msg.includes('exists') || msg.includes('duplicate') || msg.includes('409');
        if (!isConflict) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        // else loop to try next suffix
      } catch {}
    }
    if (!finalPath) {
      // All suffixes taken — fall back to a timestamp + random segment to guarantee uniqueness
      try {
        const uniqueName = `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const uniquePath = `${fixedFolder}/${uniqueName}`;
        const { data: uData, error: uErr } = await supa.storage.from(bucket).upload(uniquePath, bytes, {
          contentType: 'application/pdf',
          upsert: false,
          metadata: metadata as any,
        });
        if (uErr) {
          return NextResponse.json({ error: uErr.message || lastErr?.message || 'Kunde inte spara filen (namnkonflikt)' }, { status: 500 });
        }
        finalPath = uData?.path || uniquePath;
      } catch (e: any) {
        return NextResponse.json({ error: e.message || lastErr?.message || 'Kunde inte spara filen (namnkonflikt)' }, { status: 500 });
      }
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
