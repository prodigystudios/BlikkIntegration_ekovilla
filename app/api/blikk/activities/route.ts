import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { getActivitiesFromCache } from '@/lib/blikkCache';

/*
  GET /api/blikk/activities
  Fetch activity types (Aktiviteter) from Blikk Admin Resources.

  Query params:
    q / query / filter.query : optional search string
    page (default 1)
    pageSize / limit (default 50)
    raw=1 include original objects under _raw
    mock=1 return mock list for testing

  Response shape:
    { items: [ { id, name, code, active, billable, _raw? } ], source, attempts }
*/

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('query') || '';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') || req.nextUrl.searchParams.get('limit') || '50') || 50));
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1';
  const mock = req.nextUrl.searchParams.get('mock') === '1';
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const useCache = req.nextUrl.searchParams.get('nocache') !== '1';

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => ({
      id: `mock-act-${(page-1)*pageSize + i + 1}`,
      name: `Aktivitet ${(page-1)*pageSize + i + 1}`,
      code: `ACT${200 + i}`,
      active: true,
      billable: i % 2 === 0,
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ items, source: 'mock' });
  }

  // Serve from cache if possible
  if (useCache && !mock) {
    try {
      const cached = await getActivitiesFromCache({ q, page, pageSize, forceRefresh });
      if (cached.length) {
        return NextResponse.json({ items: cached, source: 'cache', cached: true });
      }
    } catch (e: any) {
      console.warn('activities cache fallback to direct Blikk', e?.message || e);
    }
  }

  try {
    const blikk = getBlikk();
  const base = process.env.BLIKK_ACTIVITIES_PATH || '/v1/Admin/Activities';
  // Tenant expects limit param naming; use that
  const qs = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (q) qs.set('query', q);
    const usedUrl = `${base}?${qs.toString()}`;
    const raw: any = await (blikk as any).request(usedUrl.replace(/^https?:\/\/[^/]+/, ''));
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map(a => ({
      id: a.id ?? a.activityId ?? a.Id ?? a.ActivityId ?? a.code ?? a.Code ?? undefined,
      name: a.name ?? a.title ?? a.displayName ?? a.code ?? `Aktivitet ${a.id ?? ''}`,
      code: a.code ?? a.Code ?? null,
      active: a.active ?? a.isActive ?? null,
      billable: a.billable ?? a.isBillable ?? null,
      ...(includeRaw ? { _raw: a } : {}),
    }));

    console.log('[blikk activities] usedUrl', usedUrl);
    console.log('[blikk activities] sample', mapped.slice(0,3));

    return NextResponse.json({ items: mapped, source: `blikk:${usedUrl}`, cached: false });
  } catch (e: any) {
    console.error('GET /api/blikk/activities failed', e);
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}
