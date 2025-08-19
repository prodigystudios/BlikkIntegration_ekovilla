import { NextRequest, NextResponse } from 'next/server';
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
      folder = '', // optional subfolder like orderId or projectId
    } = body || {};

    if (!fileName || !pdfBytesBase64) {
      return NextResponse.json({ error: 'fileName and pdfBytesBase64 are required' }, { status: 400 });
    }

    const bytes = Buffer.from(pdfBytesBase64, 'base64');
    const safeFolder = String(folder || '').replace(/[^\w/.-]+/g, '_');
    const path = `${safeFolder ? safeFolder + '/' : ''}${fileName}`;

    const { data, error } = await supa.storage.from(bucket).upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
      metadata: metadata as any,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Best-effort: update a simple folder index to help listing discover new prefixes immediately
    try {
      const indexPath = '__index/folders.json';
      const folderName = safeFolder.trim();
      if (folderName) {
        let folders: string[] = [];
        const existing = await supa.storage.from(bucket).download(indexPath);
        if (!existing.error && existing.data) {
          try {
            const text = await existing.data.text();
            const json = JSON.parse(text) as { folders?: string[] };
            if (Array.isArray(json.folders)) folders = json.folders;
          } catch {}
        }
        if (!folders.includes(folderName)) {
          folders.push(folderName);
          folders.sort();
          const payload = new Blob([JSON.stringify({ folders }, null, 2)], { type: 'application/json' });
          await supa.storage.from(bucket).upload(indexPath, payload, { contentType: 'application/json', upsert: true });
        }
      }
    } catch {}

    // Get a signed URL valid for 7 days
    const { data: signed, error: sErr } = await supa.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (sErr) {
      return NextResponse.json({ path: data?.path }, { status: 201 });
    }

    return NextResponse.json({ path: data?.path, url: signed?.signedUrl }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
