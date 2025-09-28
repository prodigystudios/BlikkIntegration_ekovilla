import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../lib/adminSupabase';

async function ensureAdmin() { const p = await getUserProfile(); return p && p.role === 'admin'; }

export async function GET() {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { data, error } = await adminSupabase.from('addresses').select('*').order('sort').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ addresses: data });
}

export async function POST(req: NextRequest) {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const body = await req.json();
  const { name, address, sort } = body;
  if (!name || !address) return NextResponse.json({ error: 'missing name/address' }, { status: 400 });
  const ins = { name: String(name).trim(), address: String(address).trim(), sort: typeof sort === 'number' ? sort : undefined };
  const { data, error } = await adminSupabase.from('addresses').insert(ins).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ address: data });
}
