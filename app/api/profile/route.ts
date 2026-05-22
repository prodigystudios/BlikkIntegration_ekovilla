import { NextRequest, NextResponse } from 'next/server';
import {
  asRecord,
  attachSensitiveStatus,
  buildSelfProfileUpdates,
  mergeEmployeeProfile,
  PROFILE_DETAILS_SELECT,
  PROFILE_SELECT,
  SENSITIVE_PROFILE_SELECT,
} from '../../../lib/profileDetails';
import { getProfileRouteContext, ok, routeError, selfProfileUpdateSchema, validationError } from './_lib';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getProfileRouteContext();
  if ('response' in context) return context.response;

  const { supabase, admin, user } = context;

  const userId = user.id;
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
    return routeError(500, 'profile_load_failed', 'Failed loading profile', profileError.message);
  }

  if (detailError) {
    return routeError(500, 'profile_details_load_failed', 'Failed loading profile details', detailError.message);
  }

  if (sensitiveError) {
    return routeError(500, 'sensitive_status_load_failed', 'Failed loading sensitive profile status', sensitiveError.message);
  }

  const profile = attachSensitiveStatus(mergeEmployeeProfile(
    asRecord(profileRow),
    asRecord(detailRow),
  ), asRecord(sensitiveRow));
  if (!profile) {
    return routeError(404, 'profile_not_found', 'Profile not found');
  }

  const authEmail = user.email || null;
  return ok({ profile, authEmail }, { profile, authEmail });
}

export async function PATCH(req: NextRequest) {
  const context = await getProfileRouteContext();
  if ('response' in context) return context.response;

  const { supabase, admin, user } = context;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = selfProfileUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const updates = buildSelfProfileUpdates(parsed.data);

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
  if (error) {
    return routeError(500, 'profile_update_failed', 'Failed updating profile', error.message);
  }

  if (!admin) {
    return ok({ updated: true });
  }

  const [
    { data: profileRow, error: profileError },
    { data: detailRow, error: detailError },
    { data: sensitiveRow, error: sensitiveError },
  ] = await Promise.all([
    admin.from('profiles').select(PROFILE_SELECT).eq('id', user.id).maybeSingle(),
    admin.from('employee_profile_details').select(PROFILE_DETAILS_SELECT).eq('user_id', user.id).maybeSingle(),
    admin.from('employee_sensitive_details').select(SENSITIVE_PROFILE_SELECT).eq('user_id', user.id).maybeSingle(),
  ]);

  if (profileError || detailError || sensitiveError) {
    return ok({ updated: true });
  }

  const profile = attachSensitiveStatus(
    mergeEmployeeProfile(
      asRecord(profileRow),
      asRecord(detailRow),
    ),
    asRecord(sensitiveRow),
  );

  return ok({ profile, authEmail: user.email || null }, { profile, authEmail: user.email || null });
}