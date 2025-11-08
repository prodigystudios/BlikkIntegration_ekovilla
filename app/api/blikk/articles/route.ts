import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Consolidated articles listing endpoint (supports mock & raw, returns normalized items + meta sample)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q') || sp.get('query') || '';
  const page = Number(sp.get('page') || '1') || 1;
  const pageSize = Number(sp.get('pageSize') || sp.get('limit') || '50') || 50;
  const includeRaw = sp.get('raw') === '1';
  const mock = sp.get('mock') === '1';

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => ({
      id: `mock-${(page - 1) * pageSize + i + 1}`,
      name: `Artikel ${(page - 1) * pageSize + i + 1}`,
      articleNumber: `A${1000 + i}`,
      price: 120 + i,
      unit: 'st',
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ ok: true, items, source: 'mock', sample: items[0] || null });
  }

  try {
    const blikk = getBlikk();
    const meta = await (blikk as any).listArticlesWithMeta({ page, pageSize, query: q || undefined });
    const raw = meta.data;
    const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = arr.map((a) => ({
      id: a.id ?? a.articleId ?? a.ArticleId ?? a.number ?? a.code ?? a.sku ?? a.SKU ?? a.ArticleNumber ?? undefined,
      name: a.name ?? a.title ?? a.articleName ?? a.ArticleName ?? a.displayName ?? `Artikel ${a.id ?? ''}`,
      articleNumber: a.articleNumber ?? a.number ?? a.code ?? a.sku ?? a.SKU ?? null,
      code: a.code ?? a.number ?? null,
      price: a.price ?? a.unitPrice ?? a.listPrice ?? a.salesPrice ?? null,
      unit: a.unit ?? a.unitName ?? a.Unit ?? null,
      ...(includeRaw ? { _raw: a } : {}),
    })).filter(r => r.id != null);
    return NextResponse.json({ ok: true, items: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts, sample: mapped[0] || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, items: [], error: String(e?.message || e) });
  }
}
