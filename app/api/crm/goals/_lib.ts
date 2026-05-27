import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';
import { getCurrentWeekStartDate } from '@/lib/crm/goals';

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const nonNegativeIntSchema = z.coerce.number().int().min(0, 'Värdet kan inte vara negativt');
const nonNegativeNumberSchema = z.coerce.number().min(0, 'Värdet kan inte vara negativt');

export const listCrmGoalsQuerySchema = z.object({
  period_type: z.enum(['week']).optional().default('week'),
  period_start: z.preprocess(
    (value) => normalizeOptionalText(value) || getCurrentWeekStartDate(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt perioddatum'),
  ),
});

export const upsertCrmGoalsSchema = z.object({
  period_type: z.enum(['week']).optional().default('week'),
  period_start: z.preprocess(
    (value) => normalizeOptionalText(value) || getCurrentWeekStartDate(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt perioddatum'),
  ),
  goals: z.array(z.object({
    user_id: z.string().uuid('Ogiltig användare'),
    calls_target: nonNegativeIntSchema,
    quotes_target: nonNegativeIntSchema,
    quote_value_target: nonNegativeNumberSchema,
  })).min(1, 'Minst ett mål krävs').max(50, 'För många mål i samma uppdatering'),
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