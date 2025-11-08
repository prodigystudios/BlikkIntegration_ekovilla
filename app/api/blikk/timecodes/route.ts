import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

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
  const pageSize = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') || req.nextUrl.searchParams.get('limit') || '50') || 50));
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1';
  const mock = req.nextUrl.searchParams.get('mock') === '1';

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

  try {
    const blikk = getBlikk();
    // We'll attempt multiple candidate base paths & param variants similar to listArticles/listTasks.
    const envPath = process.env.BLIKK_TIMECODES_PATH || null; // allow override like '/v1/Admin/Resources/Timecodes'
    const bases = envPath ? [envPath] : [
      '/v1/Admin/Resources/Timecodes',
      '/v1/Admin/Timecodes',
      '/v1/Administration/Timecodes',
      '/v1/Core/Timecodes',
      '/v1/Timecodes'
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
        // Official style first: filter.query, then fallback keys
        const officialQs = new URLSearchParams(paging);
        if (q) officialQs.set('filter.query', q);
        const officialUrl = `${base}?${officialQs.toString()}`;
        attempts.push(officialUrl);
        try {
          raw = await blikk['request'](officialUrl.replace(/^https?:\/\/[^/]+/, '')); // internal request usage; path only
          usedUrl = officialUrl;
          break outer;
        } catch (e: any) {
          lastErr = e;
        }
        for (const qk of queryKeys) {
          if (qk === 'filter.query') continue; // already tried
          const qs = new URLSearchParams(paging);
          if (q) qs.set(qk, q);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            raw = await blikk['request'](url.replace(/^https?:\/\/[^/]+/, ''));
            usedUrl = url;
            break outer;
          } catch (e: any) {
            lastErr = e;
          }
        }
        // Finally without query
        const plain = `${base}?${new URLSearchParams(paging).toString()}`;
        attempts.push(plain);
        try {
          raw = await blikk['request'](plain.replace(/^https?:\/\/[^/]+/, ''));
          usedUrl = plain;
          break outer;
        } catch (e: any) {
          lastErr = e;
        }
      }
    }

    if (!raw && lastErr) throw lastErr;
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map(tc => ({
      id: tc.id ?? tc.timecodeId ?? tc.Id ?? tc.TimecodeId ?? tc.code ?? tc.number ?? tc.Code ?? undefined,
      name: tc.name ?? tc.title ?? tc.displayName ?? tc.code ?? `Tidkod ${tc.id ?? ''}`,
      code: tc.code ?? tc.number ?? tc.Code ?? null,
      billable: tc.billable ?? tc.isBillable ?? null,
      active: tc.active ?? tc.isActive ?? null,
      ...(includeRaw ? { _raw: tc } : {}),
    }));

    console.log('[blikk timecodes] attempts', attempts);
    console.log('[blikk timecodes] usedUrl', usedUrl);
    console.log('[blikk timecodes] sample', mapped.slice(0, 3));

    return NextResponse.json({ items: mapped, source: usedUrl ? `blikk:${usedUrl}` : 'blikk', attempts });
  } catch (e: any) {
    console.error('GET /api/blikk/timecodes failed', e);
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}
