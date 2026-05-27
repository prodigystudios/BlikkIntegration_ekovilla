import { domainToASCII } from 'node:url';
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

const asciiEmailSchema = z.string().email();

function isValidEmailAddress(value: string) {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return false;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  const asciiDomain = domainToASCII(domainPart);

  if (!asciiDomain) return false;
  return asciiEmailSchema.safeParse(`${localPart}@${asciiDomain}`).success;
}

export const listCrmAiProspectSuggestionsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected']).optional().default('all'),
});

export const createCrmAiProspectSuggestionSchema = z.object({
  company_name: z.string().trim().min(1, 'Företagsnamn krävs'),
  organization_number: buildOptionalTextSchema().optional().default(null),
  contact_name: buildOptionalTextSchema().optional().default(null),
  phone: buildOptionalTextSchema().optional().default(null),
  email: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().refine(isValidEmailAddress, 'Ogiltig e-post').nullable(),
  ).optional().default(null),
  city: buildOptionalTextSchema().optional().default(null),
  website: buildOptionalTextSchema().optional().default(null),
  source: buildOptionalTextSchema().optional().default(null),
  rationale: buildOptionalTextSchema().optional().default(null),
  notes: buildOptionalTextSchema().optional().default(null),
});

export const reviewCrmAiProspectSuggestionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  review_note: buildOptionalTextSchema().optional().default(null),
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