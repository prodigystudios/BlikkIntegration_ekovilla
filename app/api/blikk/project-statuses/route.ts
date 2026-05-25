import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';
import { ok, routeError } from '../_admin-resource';

const projectStatusesQuerySchema = z.object({
  query: z.string().optional(),
  q: z.string().optional(),
  raw: z.enum(['1']).optional(),
  includeraw: z.enum(['1']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const parsedQuery = projectStatusesQuerySchema.safeParse({
    query: req.nextUrl.searchParams.get('query') || undefined,
    q: req.nextUrl.searchParams.get('q') || undefined,
    raw: req.nextUrl.searchParams.get('raw') || undefined,
    includeraw: req.nextUrl.searchParams.get('includeraw') || undefined,
    page: req.nextUrl.searchParams.get('page') || '1',
    pageSize: req.nextUrl.searchParams.get('pageSize') || '50',
    limit: req.nextUrl.searchParams.get('limit') || undefined,
  });
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  try {
    const query = parsedQuery.data.query || parsedQuery.data.q || '';
    const includeRaw = parsedQuery.data.raw === '1' || parsedQuery.data.includeraw === '1';
    const page = parsedQuery.data.page;
    const pageSize = parsedQuery.data.limit || parsedQuery.data.pageSize;

    const blikk = getBlikk();
    const meta = await blikk.listProjectStatusesWithMeta({ page, pageSize, query });
    const raw = meta.data;
    const items: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = items.map((s: any) => ({
      id: Number(s.id ?? s.statusId ?? s.Id ?? s.StatusId ?? 0) || 0,
      name: s.name || s.title || s.statusName || s.StatusName || 'Unknown',
      code: s.code || s.key || s.Code || null,
      color: s.color || s.Color || null,
      isActive: typeof s.isActive === 'boolean' ? s.isActive : (typeof s.active === 'boolean' ? s.active : null),
      order: typeof s.order === 'number' ? s.order : (typeof s.sortOrder === 'number' ? s.sortOrder : null),
      ...(includeRaw ? { _raw: s } : {}),
    }));
    return ok(
      { statuses: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts },
      { statuses: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts },
    );
  } catch (e: any) {
    return routeError(500, 'project_statuses_fetch_failed', String(e?.message || e));
  }
}
