import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../lib/adminSupabase';

async function ensureAdmin() { const p = await getUserProfile(); return p && p.role === 'admin'; }

export async function GET() {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { data, error } = await adminSupabase.from('contacts').select('*').order('category_id').order('sort').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data });
}

export async function POST(req: NextRequest) {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const body = await req.json();
  const { category_id, name, phone, location, role, sort } = body;
  if (!category_id || !name) return NextResponse.json({ error: 'missing category_id or name' }, { status: 400 });
  const ins = { category_id, name: String(name).trim(), phone: phone?.trim() || null, location: location?.trim() || null, role: role?.trim() || null, sort: typeof sort === 'number' ? sort : undefined };
  const { data, error } = await adminSupabase.from('contacts').insert(ins).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
