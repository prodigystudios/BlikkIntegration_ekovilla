import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

export const assignCrmRinglistProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'Välj minst ett prospekt'),
  assigned_to: z.string().uuid('Ogiltig användare').nullable(),
});

const optionalTextSchema = z.preprocess((value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

export const importCrmRinglistRowsSchema = z.object({
  assigned_to: z.string().uuid('Ogiltig användare').nullable(),
  rows: z.array(z.object({
    row_number: z.number().int().positive(),
    company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
    organization_number: optionalTextSchema.optional().default(null),
    contact_name: optionalTextSchema.optional().default(null),
    phone: optionalTextSchema.optional().default(null),
    email: optionalTextSchema.optional().default(null),
    city: optionalTextSchema.optional().default(null),
    source: optionalTextSchema.optional().default(null),
    notes: optionalTextSchema.optional().default(null),
  })).min(1, 'Minst en rad krävs').max(500, 'Importen är för stor, dela upp filen i mindre delar'),
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

export function validationError(parsedError: z.ZodError) {
  const flattened = parsedError.flatten();
  const fieldErrorGroups = Object.values(flattened.fieldErrors);

  for (const messages of fieldErrorGroups) {
    const firstMessage = messages?.find(Boolean);
    if (firstMessage) return routeError(400, 'validation_error', firstMessage, flattened);
  }

  return routeError(400, 'validation_error', flattened.formErrors.find(Boolean) || 'Invalid request', flattened);
}

export async function requireCrmAdmin() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  if (currentUser.role !== 'admin') {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}