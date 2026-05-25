import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalTextSchema() {
  return z.preprocess((value) => normalizeOptionalText(value), z.string().nullable());
}

function optionalDateSchema() {
  return z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable(),
  );
}

const roleSchema = z.enum(['member', 'sales', 'admin', 'konsult', 'readonly']).transform((role) => (role === 'readonly' ? 'konsult' : role));

const tagsSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) return value;
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  },
  z.array(z.string().min(1)),
);

export const routeIdParamsSchema = z.object({
  id: z.string().trim().min(1, 'Missing id'),
});

export const createAdminUserSchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
  full_name: optionalTextSchema().optional(),
  role: roleSchema.optional(),
});

export const updateAdminUserSchema = z.object({
  role: roleSchema.optional(),
  full_name: optionalTextSchema().optional(),
  phone: optionalTextSchema().optional(),
  private_email: optionalTextSchema().optional(),
  address_line1: optionalTextSchema().optional(),
  postal_code: optionalTextSchema().optional(),
  city: optionalTextSchema().optional(),
  emergency_contact_name: optionalTextSchema().optional(),
  emergency_contact_phone: optionalTextSchema().optional(),
  clothing_size: optionalTextSchema().optional(),
  job_title: optionalTextSchema().optional(),
  department: optionalTextSchema().optional(),
  manager_name: optionalTextSchema().optional(),
  employment_start_date: optionalDateSchema().optional(),
  employment_type: optionalTextSchema().optional(),
  certifications: optionalTextSchema().optional(),
  admin_notes: optionalTextSchema().optional(),
  personal_identity_number: optionalTextSchema().optional(),
  bank_account_name: optionalTextSchema().optional(),
  bank_clearing_number: optionalTextSchema().optional(),
  bank_account_number: optionalTextSchema().optional(),
  tags: tagsSchema.optional(),
  disabled: z.boolean().optional(),
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

export async function requireUsersAdminContext() {
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