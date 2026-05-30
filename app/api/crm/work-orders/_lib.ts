import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const workOrderStatusSchema = z.enum(['draft', 'scheduled', 'ready', 'in_progress', 'completed', 'cancelled']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const createWorkOrderTimeEntrySchema = z.object({
  work_date: dateSchema,
  hours: z.coerce.number().positive('Timmar måste vara större än 0').max(24, 'Timmar får inte överstiga 24'),
  note: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

export const createWorkOrderCommentSchema = z.object({
  body: z.string().trim().min(1, 'Kommentar krävs'),
});

export const listCrmWorkOrdersQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: workOrderStatusSchema.optional(),
  work_order_id: z.string().uuid('Ogiltig arbetsorder').optional(),
});

export const updateCrmWorkOrderSchema = z.object({
  status: workOrderStatusSchema,
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  internal_handoff: z.object({
    desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
    handoff_notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    work_scope: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
  work_address: z.object({
    street_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    delivery_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    invoice_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
});

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getFirstValidationMessage(parsedError: z.ZodError) {
  const flattened = parsedError.flatten();
  const fieldErrorGroups = Object.values(flattened.fieldErrors);

  for (const messages of fieldErrorGroups) {
    const firstMessage = messages?.find(Boolean);
    if (firstMessage) return firstMessage;
  }

  return flattened.formErrors.find(Boolean) || 'Invalid request';
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', getFirstValidationMessage(parsedError), parsedError.flatten());
}

export async function requireCrmUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  if (!(currentUser.role === 'sales' || currentUser.role === 'admin')) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

export async function requireSignedInUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { currentUser, response: null };
}