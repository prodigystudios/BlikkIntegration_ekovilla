import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

export const coachContextSchema = z.object({
  type: z.enum(['prospect', 'call', 'quote']),
  id: z.string().uuid('Ogiltig kontext'),
});

export const coachRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'Fråga krävs'),
  quick_action: z.string().trim().nullable().optional().default(null),
  context: z.preprocess((value) => value ?? null, coachContextSchema.nullable()).optional().default(null),
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