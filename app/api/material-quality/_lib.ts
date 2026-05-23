import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const nullableNumberishSchema = z.union([z.string(), z.number(), z.null()]).optional();

export const materialQualityIngestSchema = z.object({
  orderId: z.string().optional(),
  projectNumber: z.string().optional(),
  installationDate: z.string().optional(),
  materialUsed: z.string().optional(),
  flufferUsed: z.boolean().optional(),
  batchNumber: z.string().optional(),
  dammighet: nullableNumberishSchema,
  klumpighet: nullableNumberishSchema,
  etapperOpen: z.array(z.record(z.string(), z.any())).optional(),
  etapperClosed: z.array(z.record(z.string(), z.any())).optional(),
}).passthrough();

export function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      legacyError: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export function getMaterialQualityAdminOrThrow() {
  // Service role is required here because the quality samples table is managed as an internal dataset.
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    throw new Error('Material quality admin client is not configured');
  }
  return supabase;
}

export function parseJsonBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T) {
  return req.json().then((body) => schema.safeParse(body)).catch(() => schema.safeParse(null));
}
