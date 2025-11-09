import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { getTimecodesFromCache } from '@/lib/blikkCache';

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
  const q = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('query') || '';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') || req.nextUrl.searchParams.get('limit') || '50') || 50));
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1';
  const mock = req.nextUrl.searchParams.get('mock') === '1';
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const useCache = req.nextUrl.searchParams.get('nocache') !== '1';

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 12) }).map((_, i) => ({
      id: `mock-${(page-1)*pageSize + i + 1}`,
      name: `Tidkod ${(page-1)*pageSize + i + 1}`,
      code: `TC${100 + i}`,
      billable: i % 3 !== 0,
      active: true,
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ items, source: 'mock' });
  }

  // Fast path: cached response
  if (useCache && !mock) {
    try {
      const cached = await getTimecodesFromCache({ q, page, pageSize, forceRefresh });
      if (cached.length) {
        return NextResponse.json({ items: cached, source: 'cache', cached: true });
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

    console.log('[blikk timecodes] usedUrl', usedUrl);
    console.log('[blikk timecodes] sample', mapped.slice(0, 3));

    return NextResponse.json({ items: mapped, source: `blikk:${usedUrl}`, cached: false });
  } catch (e: any) {
    console.error('GET /api/blikk/timecodes failed', e);
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}
