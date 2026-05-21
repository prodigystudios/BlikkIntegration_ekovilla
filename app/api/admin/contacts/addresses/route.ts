import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export async function GET() {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { data, error } = await supabase.from('addresses').select('*').order('sort').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ addresses: data });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const body = await req.json();
  const { name, address, sort } = body;
  if (!name || !address) return NextResponse.json({ error: 'missing name/address' }, { status: 400 });
  const ins = { name: String(name).trim(), address: String(address).trim(), sort: typeof sort === 'number' ? sort : undefined };
  const { data, error } = await supabase.from('addresses').insert(ins).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ address: data });
}
