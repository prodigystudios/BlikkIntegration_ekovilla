import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { getTimecodesFromCache } from '@/lib/blikkCache';
import { ok, parseAdminResourceQuery, routeError } from '../_admin-resource';

/*
  GET /api/blikk/timecodes
  Fetches time codes (Arbeidstyper / tidkoder) from Blikk Admin Resources API.
  The public docs show endpoint under Admin Resources Timecodes. We implement tolerant fetching similar to other wrappers.

  Query params:
    ?q=... optional query/filter (mapped onto multiple candidate param names)
    ?page=1 (default 1)
    ?pageSize=50 or ?limit=50 (default 50)
    ?raw=1 include original objects as _raw
    ?mock=1 return mock data (development/testing)
*/

export async function GET(req: NextRequest) {
  const parsedQuery = parseAdminResourceQuery(req);
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  const { q, page, pageSize, includeRaw, mock, forceRefresh, useCache, debug } = parsedQuery.data;

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 12) }).map((_, i) => ({
      id: `mock-${(page-1)*pageSize + i + 1}`,
      name: `Tidkod ${(page-1)*pageSize + i + 1}`,
      code: `TC${100 + i}`,
      billable: i % 3 !== 0,
      active: true,
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return ok({ items, source: 'mock' }, { items, source: 'mock' });
  }

  // Fast path: cached response
  if (useCache && !mock) {
    try {
      const cached = await getTimecodesFromCache({ q, page, pageSize, forceRefresh });
      if (cached.length) {
        return ok({ items: cached, source: 'cache', cached: true }, { items: cached, source: 'cache', cached: true });
      }
    } catch (e: any) {
      console.warn('timecodes cache fallback to direct Blikk', e?.message || e);
    }
  }

  try {
    const blikk = getBlikk();
  const base = process.env.BLIKK_TIMECODES_PATH || '/v1/Admin/Timecodes';
  // Your tenant expects limit param naming; use that and map q directly
  const qs = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (q) qs.set('query', q);
    const usedUrl = `${base}?${qs.toString()}`;
    const raw: any = await (blikk as any).request(usedUrl.replace(/^https?:\/\/[^/]+/, ''));
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map(tc => ({
      id: tc.id ?? tc.timecodeId ?? tc.Id ?? tc.TimecodeId ?? tc.code ?? tc.number ?? tc.Code ?? undefined,
      name: tc.name ?? tc.title ?? tc.displayName ?? tc.code ?? `Tidkod ${tc.id ?? ''}`,
      code: tc.code ?? tc.number ?? tc.Code ?? null,
      billable: tc.billable ?? tc.isBillable ?? null,
      active: tc.active ?? tc.isActive ?? null,
      ...(includeRaw ? { _raw: tc } : {}),
    }));

    if (debug && process.env.NODE_ENV !== 'production') {
      console.log('[blikk timecodes] usedUrl', usedUrl);
      console.log('[blikk timecodes] sample', mapped.slice(0, 3));
    }

    return ok(
      { items: mapped, source: `blikk:${usedUrl}`, cached: false },
      { items: mapped, source: `blikk:${usedUrl}`, cached: false },
    );
  } catch (e: any) {
    console.error('GET /api/blikk/timecodes failed', e);
    return routeError(500, 'timecodes_fetch_failed', String(e?.message || e), { items: [] });
  }
}
