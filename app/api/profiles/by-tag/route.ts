import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '../../../../lib/adminSupabase';
import { getUserProfile } from '../../../../lib/getUserProfile';

async function requireAdmin() {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function GET(req: NextRequest) {
  const profile = await requireAdmin();
  if (!profile) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const tag = (searchParams.get('tag') || '').trim();
  if (!tag) return NextResponse.json({ ok: false, error: 'missing tag' }, { status: 400 });

  const { data, error } = await adminSupabase
    .from('profiles')
    .select('id, full_name, role, tags')
    .contains('tags', [tag])
    .order('full_name', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}
