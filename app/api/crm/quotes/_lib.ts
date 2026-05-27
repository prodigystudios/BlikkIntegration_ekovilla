import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = normalizeOptionalText(value);
  if (!normalized) return NaN;
  const numeric = Number(normalized.replace(/\s+/g, '').replace(',', '.'));
  return numeric;
}

const statusSchema = z.enum(['draft', 'sent', 'follow_up', 'won', 'lost']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

export const listCrmQuotesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: statusSchema.optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmQuoteSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  customer_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  project_name: z.string().trim().min(1, 'Offertnamn krävs'),
  description: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  amount: z.preprocess(parseAmount, z.number().finite('Ogiltigt belopp').min(0, 'Belopp måste vara 0 eller högre')),
  currency_code: z.preprocess((value) => normalizeOptionalText(value)?.toUpperCase(), z.string().length(3).nullable()).optional().default('SEK'),
  status: statusSchema.optional().default('draft'),
  quote_date: dateSchema,
  follow_up_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.customer_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_name'],
      message: 'Kundnamn krävs om offerten inte kopplas till ett prospekt',
    });
  }
});

export const updateCrmQuoteSchema = createCrmQuoteSchema;

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