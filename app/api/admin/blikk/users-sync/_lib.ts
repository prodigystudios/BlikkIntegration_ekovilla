import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export type BlikkUser = {
  id: number;
  email?: string | null;
  name?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export const updateBlikkMappingSchema = z.object({
  userId: z.string().trim().min(1, 'User id is required'),
  blikkId: z.number().int().nullable(),
});

export function normEmail(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

export function blikkUserSummary(user: Record<string, unknown>) {
  const name =
    (typeof user.name === 'string' && user.name) ||
    (typeof user.fullName === 'string' && user.fullName) ||
    [user.firstName, user.lastName].filter((value) => typeof value === 'string' && value).join(' ').trim();
  const email =
    (typeof user.email === 'string' && user.email) ||
    (typeof user.Email === 'string' && user.Email) ||
    null;

  return {
    id: Number(user.id ?? user.userId ?? user.Id ?? user.UserId),
    email,
    name: name || null,
    fullName: typeof user.fullName === 'string' ? user.fullName : null,
    firstName: typeof user.firstName === 'string' ? user.firstName : null,
    lastName: typeof user.lastName === 'string' ? user.lastName : null,
  } as BlikkUser;
}

export function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', 'Invalid request', parsedError.flatten());
}

export async function requireBlikkUsersSyncContext() {
  const currentUser = await requireAdminUser();
  if (!currentUser) {
    return { response: routeError(403, 'forbidden', 'Forbidden') };
  }

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    return { response: routeError(500, 'service_role_missing', 'Service role not configured') };
  }

  return { currentUser, supabase };
}