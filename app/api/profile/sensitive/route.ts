import { NextRequest } from 'next/server';
import {
  asRecord,
  buildSensitiveProfileUpdates,
  mergeSensitiveStatus,
  SENSITIVE_PROFILE_SELECT,
} from '../../../../lib/profileDetails';
import { getProfileRouteContext, ok, routeError, sensitiveProfileUpdateSchema, validationError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getProfileRouteContext();
  if ('response' in context) return context.response;

  const { admin, user } = context;
  if (!admin) {
    return routeError(500, 'service_role_missing', 'Service role not configured');
  }

  const { data, error } = await admin
    .from('employee_sensitive_details')
    .select(SENSITIVE_PROFILE_SELECT)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return routeError(500, 'sensitive_status_load_failed', 'Failed loading sensitive profile status', error.message);
  }

  const sensitiveStatus = mergeSensitiveStatus(asRecord(data));
  return ok({ sensitiveStatus }, { sensitiveStatus });
}

export async function PUT(req: NextRequest) {
  const context = await getProfileRouteContext();
  if ('response' in context) return context.response;

  const { admin, user } = context;
  if (!admin) {
    return routeError(500, 'service_role_missing', 'Service role not configured');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = sensitiveProfileUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const updates = buildSensitiveProfileUpdates(parsed.data);

  const { error } = await admin
    .from('employee_sensitive_details')
    .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' });

  if (error) {
    return routeError(500, 'sensitive_profile_update_failed', 'Failed updating sensitive profile', error.message);
  }

  const { data: freshRow, error: freshError } = await admin
    .from('employee_sensitive_details')
    .select(SENSITIVE_PROFILE_SELECT)
    .eq('user_id', user.id)
    .maybeSingle();

  if (freshError) {
    return ok({ updated: true });
  }

  const sensitiveStatus = mergeSensitiveStatus(asRecord(freshRow));
  return ok({ sensitiveStatus }, { sensitiveStatus });
}

export const PATCH = PUT;