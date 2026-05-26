import { NextResponse } from 'next/server';
import { domainToASCII } from 'node:url';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const outcomeSchema = z.enum(['no_answer', 'follow_up', 'positive', 'negative']);

function isValidEmailAddress(value: string) {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return false;

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  const asciiDomain = domainToASCII(domainPart);

  if (!asciiDomain) return false;

  return z.string().email().safeParse(`${localPart}@${asciiDomain}`).success;
}

export const listCrmCallsQuerySchema = z.object({
  q: z.string().trim().optional(),
  prospect_id: z.string().uuid('Ogiltigt prospekt').optional(),
});

export const createCrmCallSchema = z.object({
  prospect_id: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltigt prospekt').nullable()).optional().default(null),
  company_name: z.preprocess((value) => normalizeOptionalText(value), z.string().min(1, 'Företagsnamn krävs').nullable()).optional().default(null),
  organization_number: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().nullable().refine((value) => value == null || isValidEmailAddress(value), 'Ogiltig e-post')
  ).optional().default(null),
  city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  source: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  outcome: outcomeSchema,
  summary: z.string().trim().min(1, 'Samtalsanteckning krävs'),
  next_step: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  call_at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if (!value.prospect_id && !value.company_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['company_name'],
      message: 'Företagsnamn krävs för fristående samtal',
    });
  }
});

export const updateCrmCallSchema = createCrmCallSchema;

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