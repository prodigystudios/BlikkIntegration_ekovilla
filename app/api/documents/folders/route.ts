import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser, sanitizeFolderColor, sanitizeFolderName } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const supabase = createRouteHandlerClient({ cookies });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const parentId = body?.parentId ? String(body.parentId).trim() : null;
  const rawName = String(body?.name || '');
  const name = sanitizeFolderName(rawName);
  const color = sanitizeFolderColor(body?.color);
  if (!name) return NextResponse.json({ ok: false, error: 'name_required' }, { status: 400 });
  if (name === '.' || name === '..') return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ ok: false, error: 'name_too_long' }, { status: 400 });

  if (parentId) {
    const { data: parent, error: pErr } = await supabase
      .from('documents_folders')
      .select('id')
      .eq('id', parentId)
      .maybeSingle();
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
    if (!parent) return NextResponse.json({ ok: false, error: 'parent_not_found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('documents_folders')
    .insert({ parent_id: parentId, name, color, created_by: current.id })
    .select('id, parent_id, name, color, created_at')
    .single();

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return NextResponse.json({ ok: false, error: 'name_exists' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, folder: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const supabase = createRouteHandlerClient({ cookies });
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  // Only allow deleting empty folders (simple + safe)
  const { data: childFolder } = await supabase
    .from('documents_folders')
    .select('id')
    .eq('parent_id', id)
    .limit(1);
  if (childFolder && childFolder.length) {
    return NextResponse.json({ ok: false, error: 'folder_not_empty' }, { status: 400 });
  }
  const { data: childFile } = await supabase
    .from('documents_files')
    .select('id')
    .eq('folder_id', id)
    .limit(1);
  if (childFile && childFile.length) {
    return NextResponse.json({ ok: false, error: 'folder_not_empty' }, { status: 400 });
  }

  const { error } = await supabase.from('documents_folders').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (current.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const supabase = createRouteHandlerClient({ cookies });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const id = String(body?.id || '').trim();
  const rawName = String(body?.name || '');
  const name = sanitizeFolderName(rawName);
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: 'name_required' }, { status: 400 });
  if (name === '.' || name === '..') return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ ok: false, error: 'name_too_long' }, { status: 400 });

  const { data: existing, error: exErr } = await supabase
    .from('documents_folders')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('documents_folders')
    .update({ name })
    .eq('id', id)
    .select('id, parent_id, name, color, created_at')
    .single();

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return NextResponse.json({ ok: false, error: 'name_exists' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, folder: data }, { status: 200 });
}
