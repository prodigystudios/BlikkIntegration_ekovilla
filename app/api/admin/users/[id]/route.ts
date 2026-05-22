import { NextRequest } from 'next/server';
import {
  buildAdminDetailUpdates,
  buildAdminProfileUpdates,
  buildSensitiveProfileUpdates,
} from '../../../../../lib/profileDetails';
import { ok, requireUsersAdminContext, routeError, routeIdParamsSchema, updateAdminUserSchema, validationError } from '../_lib';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireUsersAdminContext();
  if ('response' in context) return context.response;

  const parsedParams = routeIdParamsSchema.safeParse(params);
  if (!parsedParams.success) return validationError(parsedParams.error);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = updateAdminUserSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { supabase } = context;
  const { id } = parsedParams.data;
  const { role, disabled, tags } = parsed.data;

  const profileUpdates = buildAdminProfileUpdates(parsed.data);
  const detailUpdates = buildAdminDetailUpdates(parsed.data);
  const sensitiveUpdates = buildSensitiveProfileUpdates(parsed.data);
  const profileMutation: Record<string, unknown> = { ...profileUpdates };
  if (role) profileMutation.role = role;
  if (tags) profileMutation.tags = tags;

  let profileDetailsUpdated = false;
  if (Object.keys(profileMutation).length) {
    const { error: profileErr } = await supabase.from('profiles').update(profileMutation).eq('id', id);
    if (profileErr) return routeError(500, 'profile_update_failed', 'Failed updating profile fields', profileErr.message);
    profileDetailsUpdated = true;
  }

  let employeeDetailsUpdated = false;
  if (Object.keys(detailUpdates).length) {
    const { error: detailErr } = await supabase
      .from('employee_profile_details')
      .upsert({ user_id: id, ...detailUpdates }, { onConflict: 'user_id' });
    if (detailErr) return routeError(500, 'employee_details_update_failed', 'Failed updating employee details', detailErr.message);
    employeeDetailsUpdated = true;
  }

  let sensitiveUpdated = false;
  if (Object.keys(sensitiveUpdates).length) {
    const { error: sensitiveErr } = await supabase
      .from('employee_sensitive_details')
      .upsert({ user_id: id, ...sensitiveUpdates }, { onConflict: 'user_id' });
    if (sensitiveErr) return routeError(500, 'sensitive_details_update_failed', 'Failed updating sensitive details', sensitiveErr.message);
    sensitiveUpdated = true;
  }
  // Disable/enable user (Supabase: update user) if requested
  let disabledRequested = false;
  if (typeof disabled === 'boolean') {
    // Supabase JS v2 doesn't expose direct 'banned' flag; placeholder for future
    disabledRequested = true;
  }

  return ok(
    {
      updated: {
        profile: Object.keys(profileMutation).length > 0,
        employeeDetails: employeeDetailsUpdated,
        sensitiveDetails: sensitiveUpdated,
        disabledRequested,
      },
    },
    {
      profileDetailsUpdated,
      employeeDetailsUpdated,
      sensitiveUpdated,
      disabledRequested,
    },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireUsersAdminContext();
  if ('response' in context) return context.response;

  const parsedParams = routeIdParamsSchema.safeParse(params);
  if (!parsedParams.success) return validationError(parsedParams.error);

  const { supabase } = context;
  const { id } = parsedParams.data;
  // Delete auth user (cascade should remove profile row)
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return routeError(500, 'delete_user_failed', error.message);
  return ok(null);
}
