import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!(await requireAdminUser())) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const tag = (searchParams.get('tag') || '').trim();
  if (!tag) return NextResponse.json({ ok: false, error: 'missing tag' }, { status: 400 });

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, tags')
    .contains('tags', [tag])
    .order('full_name', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}
