import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../lib/adminSupabase';
import path from 'path';
import { promises as fs } from 'fs';

async function ensureAdmin() {
  const profile = await getUserProfile();
  return profile && profile.role === 'admin' ? profile : null;
}

async function loadFallback() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'PhoneList.json');
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

export async function GET() {
  const ok = await ensureAdmin();
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (adminSupabase) {
    try {
      const { data, error } = await adminSupabase.storage.from('public-data').download('PhoneList.json');
      if (!error && data) {
        const text = await data.text();
        return NextResponse.json(JSON.parse(text));
      }
    } catch {/* ignore */}
  }
  const fb = await loadFallback();
  if (fb) return NextResponse.json(fb);
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function PUT(req: NextRequest) {
  const ok = await ensureAdmin();
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  // Very light validation: expect object with at least one key
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'expected object' }, { status: 400 });
  }
  try {
    const payload = JSON.stringify(body, null, 2);
    const { error: upErr } = await adminSupabase.storage.from('public-data').upload('PhoneList.json', new Blob([payload], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
    if (upErr) return NextResponse.json({ error: 'upload failed', details: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: 'unexpected', details: e?.message }, { status: 500 });
  }
}

export const PATCH = PUT; // treat PATCH same as full replace for simplicity
