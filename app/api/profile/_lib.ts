import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalTextSchema() {
  return z.preprocess((value) => normalizeOptionalText(value), z.string().nullable());
}

export const selfProfileUpdateSchema = z.object({
  full_name: optionalTextSchema().optional(),
  phone: optionalTextSchema().optional(),
  private_email: optionalTextSchema().optional(),
  address_line1: optionalTextSchema().optional(),
  postal_code: optionalTextSchema().optional(),
  city: optionalTextSchema().optional(),
  emergency_contact_name: optionalTextSchema().optional(),
  emergency_contact_phone: optionalTextSchema().optional(),
  clothing_size: optionalTextSchema().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be updated',
});

export const sensitiveProfileUpdateSchema = z.object({
  personal_identity_number: optionalTextSchema().optional(),
  bank_account_name: optionalTextSchema().optional(),
  bank_clearing_number: optionalTextSchema().optional(),
  bank_account_number: optionalTextSchema().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be updated',
});

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

export async function getProfileRouteContext() {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { supabase, admin, user: authData.user };
}