import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import {
  buildAdminDetailUpdates,
  buildAdminProfileUpdates,
  buildSensitiveProfileUpdates,
} from '../../../../../lib/profileDetails';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });

  const { id } = params;
  const body = await req.json();
  let { role, full_name, disabled, tags, phone } = body as { role?: string; full_name?: string; disabled?: boolean; tags?: string[]; phone?: string };
  if (role === 'readonly') role = 'konsult';

  const profileUpdates = buildAdminProfileUpdates(body || {});
  const detailUpdates = buildAdminDetailUpdates(body || {});
  const sensitiveUpdates = buildSensitiveProfileUpdates(body || {});

  // Update profile name if provided
  let nameUpdated = false;
  if (full_name !== undefined) {
    const { error: nameErr } = await supabase.from('profiles').update({ full_name }).eq('id', id);
    if (nameErr) return NextResponse.json({ error: 'failed updating name', details: nameErr.message }, { status: 500 });
    nameUpdated = true;
  }
  // Change role (direct update with service role; server already validated current user is admin)
  let roleUpdated = false;
  if (role && ['member','sales','admin','konsult'].includes(role)) {
    const { error: roleErr } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (roleErr) return NextResponse.json({ error: 'failed updating role', details: roleErr.message }, { status: 500 });
    roleUpdated = true;
  }
  // Update tags directly with service role (bypasses RLS); server already validated admin
  let tagsUpdated = false;
  if (Array.isArray(tags)) {
    const { error: tagErr } = await supabase.from('profiles').update({ tags }).eq('id', id);
    if (tagErr) return NextResponse.json({ error: 'failed updating tags', details: tagErr.message }, { status: 500 });
    tagsUpdated = true;
  }

  // Update phone (allow clearing by explicitly sending phone)
  let phoneUpdated = false;
  if ('phone' in (body || {})) {
    const phoneValue = typeof phone === 'string' ? phone.trim() : '';
    const { error: phoneErr } = await supabase.from('profiles').update({ phone: phoneValue || null }).eq('id', id);
    if (phoneErr) return NextResponse.json({ error: 'failed updating phone', details: phoneErr.message }, { status: 500 });
    phoneUpdated = true;
  }

  const remainingProfileUpdates = { ...profileUpdates };
  delete remainingProfileUpdates.full_name;
  delete remainingProfileUpdates.phone;

  let profileDetailsUpdated = false;
  if (Object.keys(remainingProfileUpdates).length) {
    const { error: profileErr } = await supabase.from('profiles').update(remainingProfileUpdates).eq('id', id);
    if (profileErr) return NextResponse.json({ error: 'failed updating profile fields', details: profileErr.message }, { status: 500 });
    profileDetailsUpdated = true;
  }

  let employeeDetailsUpdated = false;
  if (Object.keys(detailUpdates).length) {
    const { error: detailErr } = await supabase
      .from('employee_profile_details')
      .upsert({ user_id: id, ...detailUpdates }, { onConflict: 'user_id' });
    if (detailErr) return NextResponse.json({ error: 'failed updating employee details', details: detailErr.message }, { status: 500 });
    employeeDetailsUpdated = true;
  }

  let sensitiveUpdated = false;
  if (Object.keys(sensitiveUpdates).length) {
    const { error: sensitiveErr } = await supabase
      .from('employee_sensitive_details')
      .upsert({ user_id: id, ...sensitiveUpdates }, { onConflict: 'user_id' });
    if (sensitiveErr) return NextResponse.json({ error: 'failed updating sensitive details', details: sensitiveErr.message }, { status: 500 });
    sensitiveUpdated = true;
  }
  // Disable/enable user (Supabase: update user) if requested
  if (typeof disabled === 'boolean') {
    // Supabase JS v2 doesn't expose direct 'banned' flag; placeholder for future
  }

  return NextResponse.json({ ok: true, nameUpdated, roleUpdated, tagsUpdated, phoneUpdated, profileDetailsUpdated, employeeDetailsUpdated, sensitiveUpdated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdminUser())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });
  const { id } = params;
  // Delete auth user (cascade should remove profile row)
  await supabase.auth.admin.deleteUser(id);
  return NextResponse.json({ ok: true });
}
