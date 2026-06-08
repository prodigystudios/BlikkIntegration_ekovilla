import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { PERMISSION_KEYS } from '@/lib/auth/permissions';

export const PERMISSION_ROLES = ['member', 'sales', 'admin', 'konsult'] as const;

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, errorDetails: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function validationError(parsedError: z.ZodError) {
  const flat = parsedError.flatten();
  const first = Object.values(flat.fieldErrors).flatMap((m) => m ?? [])[0] || flat.formErrors[0] || 'Invalid request';
  return routeError(400, 'validation_error', first, flat);
}

const permissionKey = z.string().refine(
  (k) => (PERMISSION_KEYS as readonly string[]).includes(k),
  'unknown permission key',
);

// Set a role bundle entry, or a per-user grant/revoke override (effect=null clears it).
export const setPermissionSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('role'), role: z.enum(PERMISSION_ROLES), key: permissionKey, present: z.boolean() }),
  z.object({ scope: z.literal('user'), userId: z.string().uuid(), key: permissionKey, effect: z.enum(['grant', 'revoke']).nullable() }),
]);

// Admin context for the permission routes. Returns an `admin` (service-role) client for
// reading any user's permissions, plus a request-scoped `session` client so the SECURITY
// DEFINER setter functions see auth.uid() = the calling admin (a service-role client would
// have a null auth.uid() and the functions' admin check would fail).
export async function requirePermsAdmin() {
  const currentUser = await requireAdminUser();
  if (!currentUser) return { response: routeError(403, 'forbidden', 'Forbidden') };

  const admin = getOptionalSupabaseAdmin();
  if (!admin) return { response: routeError(500, 'service_role_missing', 'Service role not configured') };

  const session = createRouteHandlerClient({ cookies });
  return { currentUser, admin, session };
}
