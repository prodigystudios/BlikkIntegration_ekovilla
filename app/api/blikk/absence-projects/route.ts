import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';

// GET /api/blikk/absence-projects
// Simple proxy to list Absence Projects from Blikk so you can inspect the raw payload.
// Uses single canonical path, with env override:
//   BLIKK_ABSENCE_PROJECTS_PATH (default: /v1/Admin/AbsenceProjects)
// Query params:
//   page (default 1)
//   limit (default 50)
//   query (optional search text)
//   mock=1 (optional test data)

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  q: z.string().optional().default(''),
  query: z.string().optional(),
  mock: z.enum(['1']).optional(),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
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

export async function GET(req: NextRequest) {
  const parsedQuery = querySchema.safeParse({
    page: req.nextUrl.searchParams.get('page') || '1',
    limit: req.nextUrl.searchParams.get('limit') || '50',
    q: req.nextUrl.searchParams.get('q') || undefined,
    query: req.nextUrl.searchParams.get('query') || undefined,
    mock: req.nextUrl.searchParams.get('mock') || undefined,
  });
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  const page = parsedQuery.data.page;
  const limit = parsedQuery.data.limit;
  const q = parsedQuery.data.q || parsedQuery.data.query || '';
  const mock = parsedQuery.data.mock === '1';

  if (mock) {
    const items = Array.from({ length: Math.min(limit, 5) }).map((_, i) => ({
      id: `mock-abs-${(page - 1) * limit + i + 1}`,
      name: `Absence Project ${(page - 1) * limit + i + 1}`,
      code: `ABS${100 + i}`,
      active: true,
    }));
    const payload = { usedUrl: 'mock', data: { items, page, limit, query: q || undefined } };
    return ok(payload, payload);
  }

  try {
    const blikk = getBlikk();
    const base = process.env.BLIKK_ABSENCE_PROJECTS_PATH || '/v1/Admin/AbsenceProjects';
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) qs.set('query', q);
    const usedUrl = `${base}?${qs.toString()}`;
    const raw: any = await (blikk as any).request(usedUrl.replace(/^https?:\/\/[^/]+/, ''));
    // Return raw upstream shape so you can inspect exactly what Blikk responds with.
    const payload = { usedUrl, data: raw };
    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'absence_projects_fetch_failed', String(e?.message || e));
  }
}
