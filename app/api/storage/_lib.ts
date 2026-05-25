import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const flagSchema = z.enum(['1']).optional();

export const saveBodySchema = z.object({
  fileName: z.string().trim().min(1),
  pdfBytesBase64: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional().default({}),
  folder: z.string().optional(),
}).passthrough();

export const listQuerySchema = z.object({
  prefix: z.string().optional(),
});

export const downloadQuerySchema = z.object({
  path: z.string().trim().min(1),
});

export const listAllQuerySchema = z.object({
  prefix: z.string().optional(),
  debug: flagSchema,
  all: flagSchema,
  check: z.string().optional(),
  mode: z.enum(['db', 'bfs']).optional(),
});

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

export function getStorageAdminOrThrow() {
  // Service role is required here because archive files live in a private bucket
  // and list-all may query storage.objects directly when the storage API view is incomplete.
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    throw new Error('Storage admin client is not configured');
  }
  return supabase;
}

export function sanitizePrefix(prefix?: string) {
  return String(prefix || '')
  .replace(/[^\w/.-]+/g, '_')
    .replace(/^\/+|\/+$/g, '');
}

export function sanitizeStoragePath(path: string) {
  const trimmed = String(path || '').trim();
  if (!trimmed || trimmed.includes('..')) {
    throw new Error('Invalid path');
  }
  return trimmed.replace(/^\/+/, '');
}

export function parseQuery<T extends z.ZodTypeAny>(req: NextRequest, schema: T, input: z.input<T>) {
  return schema.safeParse(input);
}
