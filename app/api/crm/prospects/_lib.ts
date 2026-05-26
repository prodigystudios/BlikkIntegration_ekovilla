import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOptionalTextSchema() {
  return z.preprocess((value) => normalizeOptionalText(value), z.string().nullable());
}

export const listCrmProspectsQuerySchema = z.object({
  q: z.string().trim().optional(),
});

export const createCrmProspectSchema = z.object({
  company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
  organization_number: buildOptionalTextSchema().optional().default(null),
  contact_name: buildOptionalTextSchema().optional().default(null),
  phone: buildOptionalTextSchema().optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().email('Ogiltig e-post').nullable(),
  ).optional().default(null),
  street_address: buildOptionalTextSchema().optional().default(null),
  postal_code: buildOptionalTextSchema().optional().default(null),
  city: buildOptionalTextSchema().optional().default(null),
  source: buildOptionalTextSchema().optional().default(null),
  notes: buildOptionalTextSchema().optional().default(null),
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
  return routeError(400, 'validation_error', 'Invalid request', parsedError.flatten());
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