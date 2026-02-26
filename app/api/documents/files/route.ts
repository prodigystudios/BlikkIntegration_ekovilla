import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCurrentUser, getDocsBucket, sanitizeFileName } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function splitExt(name: string) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function guessContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const supabase = createRouteHandlerClient({ cookies });
  const admin = getSupabaseAdmin();
  const form = await req.formData();
  const file = form.get('file');
  const folderIdRaw = form.get('folderId');
  const folderId = folderIdRaw ? String(folderIdRaw).trim() : '';
  const folderIdOrNull = folderId || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'missing_file' }, { status: 400 });
  }

  if (folderId) {
    const { data: folder, error: fErr } = await supabase
      .from('documents_folders')
      .select('id')
      .eq('id', folderId)
      .maybeSingle();
    if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });
    if (!folder) return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
  }

  const safeOriginal = sanitizeFileName(file.name);
  const { stem, ext } = splitExt(safeOriginal);

  // Allocate a non-conflicting display name within the folder
  let finalName = safeOriginal;
  for (let i = 0; i < 30; i++) {
    const suffix = i === 0 ? '' : `-${i}`;
    const candidate = `${stem}${suffix}${ext}`;
    const q = supabase.from('documents_files').select('id').limit(1);
    const { data: existing } = folderIdOrNull
      ? await q.eq('folder_id', folderIdOrNull).ilike('file_name', candidate)
      : await q.is('folder_id', null).ilike('file_name', candidate);
    if (!existing || existing.length === 0) {
      finalName = candidate;
      break;
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const bucket = getDocsBucket();
  const uid = crypto.randomUUID();
  const prefix = folderId ? `Documents/${folderId}` : 'Documents/root';
  const storagePath = `${prefix}/${uid}-${finalName}`;
  const contentType = file.type || guessContentType(finalName);

  const { error: upErr } = await admin.storage.from(bucket).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  const { data: inserted, error: insErr } = await supabase
    .from('documents_files')
    .insert({
      folder_id: folderIdOrNull,
      file_name: finalName,
      storage_bucket: bucket,
      storage_path: storagePath,
      content_type: contentType,
      size_bytes: bytes.byteLength,
      created_by: current.id,
    })
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .single();

  if (insErr) {
    // Roll back storage object best-effort
    try {
      await admin.storage.from(bucket).remove([storagePath]);
    } catch {}
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, file: inserted }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const supabase = createRouteHandlerClient({ cookies });
  const admin = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('documents_files')
    .select('id, storage_bucket, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const bucket = String((data as any).storage_bucket);
  const path = String((data as any).storage_path);

  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
    // ignore; still delete DB row
  }

  const { error: delErr } = await supabase.from('documents_files').delete().eq('id', id);
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
