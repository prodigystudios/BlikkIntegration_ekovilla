import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import {
  asRecord,
  attachSensitiveStatus,
  buildSelfProfileUpdates,
  mergeEmployeeProfile,
  PROFILE_DETAILS_SELECT,
  PROFILE_SELECT,
  SENSITIVE_PROFILE_SELECT,
} from '../../../lib/profileDetails';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = authData.user.id;
  const [
    { data: profileRow, error: profileError },
    { data: detailRow, error: detailError },
    { data: sensitiveRow, error: sensitiveError },
  ] = await Promise.all([
    supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle(),
    supabase.from('employee_profile_details').select(PROFILE_DETAILS_SELECT).eq('user_id', userId).maybeSingle(),
    admin
      ? admin.from('employee_sensitive_details').select(SENSITIVE_PROFILE_SELECT).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (profileError) {
    return NextResponse.json({ error: 'failed loading profile', details: profileError.message }, { status: 500 });
  }

  if (detailError) {
    return NextResponse.json({ error: 'failed loading profile details', details: detailError.message }, { status: 500 });
  }

  if (sensitiveError) {
    return NextResponse.json({ error: 'failed loading sensitive profile status', details: sensitiveError.message }, { status: 500 });
  }

  const profile = attachSensitiveStatus(mergeEmployeeProfile(
    asRecord(profileRow),
    asRecord(detailRow),
  ), asRecord(sensitiveRow));
  if (!profile) {
    return NextResponse.json({ error: 'profile not found' }, { status: 404 });
  }

  return NextResponse.json({ profile, authEmail: authData.user.email || null });
}

export async function PATCH(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const updates = buildSelfProfileUpdates(body);
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'no supported fields provided' }, { status: 400 });
  }

  const { error } = await supabase.from('profiles').update(updates).eq('id', authData.user.id);
  if (error) {
    return NextResponse.json({ error: 'failed updating profile', details: error.message }, { status: 500 });
  }

  if (!admin) {
    return NextResponse.json({ ok: true });
  }

  const [
    { data: profileRow, error: profileError },
    { data: detailRow, error: detailError },
    { data: sensitiveRow, error: sensitiveError },
  ] = await Promise.all([
    admin.from('profiles').select(PROFILE_SELECT).eq('id', authData.user.id).maybeSingle(),
    admin.from('employee_profile_details').select(PROFILE_DETAILS_SELECT).eq('user_id', authData.user.id).maybeSingle(),
    admin.from('employee_sensitive_details').select(SENSITIVE_PROFILE_SELECT).eq('user_id', authData.user.id).maybeSingle(),
  ]);

  if (profileError || detailError || sensitiveError) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({
    ok: true,
    profile: attachSensitiveStatus(
      mergeEmployeeProfile(
        asRecord(profileRow),
        asRecord(detailRow),
      ),
      asRecord(sensitiveRow),
    ),
    authEmail: authData.user.email || null,
  });
}