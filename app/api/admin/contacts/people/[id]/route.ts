import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../../lib/adminSupabase';

async function ensureAdmin() { const p = await getUserProfile(); return p && p.role === 'admin'; }

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { id } = params;
  const body = await req.json();
  const upd: any = {};
  ['name','phone','location','role'].forEach(k => { if (body[k] !== undefined) upd[k] = body[k] === '' ? null : String(body[k]).trim(); });
  if (typeof body.sort === 'number') upd.sort = body.sort;
  if (Object.keys(upd).length === 0) return NextResponse.json({ error: 'no updates' }, { status: 400 });
  const { data, error } = await adminSupabase.from('contacts').update(upd).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await ensureAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { id } = params;
  const { error } = await adminSupabase.from('contacts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
