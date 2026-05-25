import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const booleanFlagSchema = z.enum(['1']).optional();

export const adminResourceQuerySchema = z.object({
  q: z.string().optional(),
  query: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  raw: booleanFlagSchema,
  mock: booleanFlagSchema,
  refresh: booleanFlagSchema,
  nocache: booleanFlagSchema,
  debug: booleanFlagSchema,
});

export type AdminResourceQuery = z.infer<typeof adminResourceQuerySchema>;

export function parseAdminResourceQuery(req: NextRequest) {
  const parsed = adminResourceQuerySchema.safeParse({
    q: req.nextUrl.searchParams.get('q') || undefined,
    query: req.nextUrl.searchParams.get('query') || undefined,
    page: req.nextUrl.searchParams.get('page') || '1',
    pageSize: req.nextUrl.searchParams.get('pageSize') || undefined,
    limit: req.nextUrl.searchParams.get('limit') || undefined,
    raw: req.nextUrl.searchParams.get('raw') || undefined,
    mock: req.nextUrl.searchParams.get('mock') || undefined,
    refresh: req.nextUrl.searchParams.get('refresh') || undefined,
    nocache: req.nextUrl.searchParams.get('nocache') || undefined,
    debug: req.nextUrl.searchParams.get('debug') || undefined,
  });

  if (!parsed.success) {
    return parsed;
  }

  return {
    success: true as const,
    data: {
      q: parsed.data.q || parsed.data.query || '',
      page: parsed.data.page,
      pageSize: parsed.data.pageSize || parsed.data.limit || 50,
      includeRaw: parsed.data.raw === '1',
      mock: parsed.data.mock === '1',
      forceRefresh: parsed.data.refresh === '1',
      useCache: parsed.data.nocache !== '1',
      debug: parsed.data.debug === '1',
    },
  };
}

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
