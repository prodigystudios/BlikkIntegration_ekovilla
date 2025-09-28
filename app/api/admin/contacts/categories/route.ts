import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../lib/adminSupabase';

async function ensureAdmin() {
  const p = await getUserProfile();
  return p && p.role === 'admin';
}

export async function GET() {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { data, error } = await adminSupabase.from('contact_categories').select('*').order('sort', { ascending: true }).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data });
}

export async function POST(req: NextRequest) {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const body = await req.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'missing name' }, { status: 400 });
  const { data, error } = await adminSupabase.from('contact_categories').insert({ name }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}
