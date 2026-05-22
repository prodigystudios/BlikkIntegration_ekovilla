import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOptionalTextSchema() {
  return z.preprocess((value) => normalizeOptionalText(value), z.string().nullable());
}

export const routeIdParamsSchema = z.object({
  id: z.string().trim().min(1, 'Missing id'),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').optional(),
  sort: z.number().int().optional(),
}).refine((value) => value.name !== undefined || value.sort !== undefined, {
  message: 'At least one field must be updated',
});

export const createContactSchema = z.object({
  category_id: z.string().trim().min(1, 'Category is required'),
  name: z.string().trim().min(1, 'Name is required'),
  phone: buildOptionalTextSchema().optional().default(null),
  location: buildOptionalTextSchema().optional().default(null),
  role: buildOptionalTextSchema().optional().default(null),
  sort: z.number().int().optional(),
});

export const updateContactSchema = z.object({
  name: buildOptionalTextSchema(),
  phone: buildOptionalTextSchema(),
  location: buildOptionalTextSchema(),
  role: buildOptionalTextSchema(),
  sort: z.number().int().optional(),
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be updated',
});

export const createAddressSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  address: z.string().trim().min(1, 'Address is required'),
  sort: z.number().int().optional(),
});

export const updateAddressSchema = z.object({
  name: buildOptionalTextSchema(),
  address: buildOptionalTextSchema(),
  sort: z.number().int().optional(),
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be updated',
});

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', 'Invalid request', parsedError.flatten());
}

export async function requireContactsAdminContext() {
  const currentUser = await requireAdminUser();
  if (!currentUser) {
    return { response: routeError(403, 'forbidden', 'Forbidden') };
  }

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    return { response: routeError(500, 'service_role_missing', 'Service role missing') };
  }

  return { currentUser, supabase };
}