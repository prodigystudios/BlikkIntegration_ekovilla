import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export async function GET() {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const { data, error } = await supabase.from('contacts').select('*').order('category_id').order('sort').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role missing' }, { status: 500 });
  const body = await req.json();
  const { category_id, name, phone, location, role, sort } = body;
  if (!category_id || !name) return NextResponse.json({ error: 'missing category_id or name' }, { status: 400 });
  const ins = { category_id, name: String(name).trim(), phone: phone?.trim() || null, location: location?.trim() || null, role: role?.trim() || null, sort: typeof sort === 'number' ? sort : undefined };
  const { data, error } = await supabase.from('contacts').insert(ins).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
