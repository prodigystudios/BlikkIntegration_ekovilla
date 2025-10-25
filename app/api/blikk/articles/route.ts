import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('query') || '';
  const page = Number(req.nextUrl.searchParams.get('page') || '1') || 1;
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') || req.nextUrl.searchParams.get('limit') || '25') || 25;
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1';
  const mock = req.nextUrl.searchParams.get('mock') === '1';

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => ({
      id: `mock-${(page-1)*pageSize + i + 1}`,
      name: `Artikel ${(page-1)*pageSize + i + 1}`,
      articleNumber: `A${1000 + i}`,
      price: 123.45 + i,
      unit: 'st',
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ items, source: 'mock' });
  }

  try {
    const blikk = getBlikk();
    const meta = await blikk.listArticlesWithMeta({ page, pageSize, query: q });
    const raw = meta.data;
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map((a) => ({
      id: a.id ?? a.articleId ?? a.ArticleId ?? a.number ?? a.code ?? a.sku ?? a.SKU ?? a.ArticleNumber ?? undefined,
      name: a.name ?? a.title ?? a.articleName ?? a.ArticleName ?? a.displayName ?? `Artikel ${a.id ?? ''}`,
      articleNumber: a.articleNumber ?? a.number ?? a.code ?? a.sku ?? a.SKU ?? null,
      price: a.price ?? a.unitPrice ?? a.listPrice ?? a.salesPrice ?? null,
      unit: a.unit ?? a.unitName ?? a.Unit ?? null,
      ...(includeRaw ? { _raw: a } : {}),
    }));
    return NextResponse.json({ items: mapped, source: meta.usedUrl ? `blikk:${meta.usedUrl}` : 'blikk' });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}
