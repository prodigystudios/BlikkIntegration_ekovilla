import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

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
  const pageSize = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') || req.nextUrl.searchParams.get('limit') || '50') || 50));
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1';
  const mock = req.nextUrl.searchParams.get('mock') === '1';

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

  try {
    const blikk = getBlikk();
    // Allow env override for activities path
    const envPath = process.env.BLIKK_ACTIVITIES_PATH || null; // e.g. '/v1/Admin/Resources/Activities'
    const bases = envPath ? [envPath] : [
      '/v1/Admin/Resources/Activities',
      '/v1/Admin/Activities',
      '/v1/Administration/Activities',
      '/v1/Core/Activities',
      '/v1/Activities'
    ];
    const queryKeys = ['filter.query', 'query', 'q', 'filter.name'];
    const pagingVariants: Array<Record<string,string>> = [
      { page: String(page), pageSize: String(pageSize) },
      { page: String(page), limit: String(pageSize) },
    ];
    const attempts: string[] = [];
    let lastErr: any = null;
    let raw: any = null;
    let usedUrl: string | null = null;

    outer: for (const base of bases) {
      for (const paging of pagingVariants) {
        // Official style first (filter.query)
        const officialQs = new URLSearchParams(paging);
        if (q) officialQs.set('filter.query', q);
        const officialUrl = `${base}?${officialQs.toString()}`;
        attempts.push(officialUrl);
        try {
          raw = await (blikk as any).request(officialUrl.replace(/^https?:\/\/[^/]+/, ''));
          usedUrl = officialUrl;
          break outer;
        } catch (e: any) {
          lastErr = e;
        }
        // Variant query keys
        for (const qk of queryKeys) {
          if (qk === 'filter.query') continue; // already attempted
          const qs = new URLSearchParams(paging);
          if (q) qs.set(qk, q);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            raw = await (blikk as any).request(url.replace(/^https?:\/\/[^/]+/, ''));
            usedUrl = url;
            break outer;
          } catch (e: any) {
            lastErr = e;
          }
        }
        // Plain (no query)
        const plain = `${base}?${new URLSearchParams(paging).toString()}`;
        attempts.push(plain);
        try {
          raw = await (blikk as any).request(plain.replace(/^https?:\/\/[^/]+/, ''));
          usedUrl = plain;
          break outer;
        } catch (e: any) {
          lastErr = e;
        }
      }
    }

    if (!raw && lastErr) throw lastErr;
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map(a => ({
      id: a.id ?? a.activityId ?? a.Id ?? a.ActivityId ?? a.code ?? a.Code ?? undefined,
      name: a.name ?? a.title ?? a.displayName ?? a.code ?? `Aktivitet ${a.id ?? ''}`,
      code: a.code ?? a.Code ?? null,
      active: a.active ?? a.isActive ?? null,
      billable: a.billable ?? a.isBillable ?? null,
      ...(includeRaw ? { _raw: a } : {}),
    }));

    console.log('[blikk activities] attempts', attempts);
    console.log('[blikk activities] usedUrl', usedUrl);
    console.log('[blikk activities] sample', mapped.slice(0,3));

    return NextResponse.json({ items: mapped, source: usedUrl ? `blikk:${usedUrl}` : 'blikk', attempts });
  } catch (e: any) {
    console.error('GET /api/blikk/activities failed', e);
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}
