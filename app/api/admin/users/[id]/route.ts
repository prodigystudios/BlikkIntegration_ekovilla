import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '../../../../../lib/getUserProfile';
import { adminSupabase } from '../../../../../lib/adminSupabase';

async function requireAdmin() {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  const { id } = params;
  const body = await req.json();
  const { role, full_name, disabled } = body as { role?: string; full_name?: string; disabled?: boolean };

  // Update profile name if provided
  let nameUpdated = false;
  if (full_name !== undefined) {
    const { error: nameErr } = await adminSupabase.from('profiles').update({ full_name }).eq('id', id);
    if (nameErr) return NextResponse.json({ error: 'failed updating name', details: nameErr.message }, { status: 500 });
    nameUpdated = true;
  }
  // Change role (direct update with service role; server already validated current user is admin)
  let roleUpdated = false;
  if (role && ['member','sales','admin'].includes(role)) {
    const { error: roleErr } = await adminSupabase.from('profiles').update({ role }).eq('id', id);
    if (roleErr) return NextResponse.json({ error: 'failed updating role', details: roleErr.message }, { status: 500 });
    roleUpdated = true;
  }
  // Disable/enable user (Supabase: update user) if requested
  if (typeof disabled === 'boolean') {
    // Supabase JS v2 doesn't expose direct 'banned' flag; placeholder for future
  }

  return NextResponse.json({ ok: true, nameUpdated, roleUpdated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!adminSupabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });
  const { id } = params;
  // Delete auth user (cascade should remove profile row)
  await adminSupabase.auth.admin.deleteUser(id);
  return NextResponse.json({ ok: true });
}
