import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';

export const tripIdParamsSchema = z.object({
  id: z.string().trim().min(1, 'Missing id'),
});

export const tripsListQuerySchema = z.object({
  ym: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid ym').optional(),
});

const optionalKilometerSchema = z.union([z.number(), z.string(), z.null()]).optional();

export const createTripSchema = z.object({
  date: z.string().trim().optional(),
  startAddress: z.string().optional().nullable(),
  endAddress: z.string().optional().nullable(),
  startKm: optionalKilometerSchema,
  endKm: optionalKilometerSchema,
  note: z.string().optional().nullable(),
  salesPerson: z.string().optional().nullable(),
});

export const updateTripSchema = z.object({
  date: z.string().trim().optional(),
  startAddress: z.string().optional().nullable(),
  endAddress: z.string().optional().nullable(),
  startKm: optionalKilometerSchema,
  endKm: optionalKilometerSchema,
  note: z.string().optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to update',
});

export function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export async function getKorjournalRouteContext() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { supabase, user, response: null };
}

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export function normalizeOptionalKilometer(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
