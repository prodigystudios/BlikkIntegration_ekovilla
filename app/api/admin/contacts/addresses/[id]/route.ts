import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { id } = params;
  const body = await req.json();
  const upd: any = {};
  if (body.name !== undefined) upd.name = body.name.trim();
  if (body.address !== undefined) upd.address = body.address.trim();
  if (typeof body.sort === 'number') upd.sort = body.sort;
  if (Object.keys(upd).length === 0) return NextResponse.json({ error: 'no updates' }, { status: 400 });
  const { data, error } = await supabase.from('addresses').update(upd).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ address: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { id } = params;
  const { error } = await supabase.from('addresses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
