import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { ok, parseAdminResourceQuery, routeError } from '../_admin-resource';

// Consolidated articles listing endpoint (supports mock & raw, returns normalized items + meta sample)
export async function GET(req: NextRequest) {
  const parsedQuery = parseAdminResourceQuery(req);
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  const { q, page, pageSize, includeRaw, mock } = parsedQuery.data;

  if (mock) {
    const items = Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => ({
      id: `mock-${(page - 1) * pageSize + i + 1}`,
      name: `Artikel ${(page - 1) * pageSize + i + 1}`,
      articleNumber: `A${1000 + i}`,
      price: 120 + i,
      unit: 'st',
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return ok(
      { items, source: 'mock', sample: items[0] || null },
      { items, source: 'mock', sample: items[0] || null },
    );
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
    return ok(
      { items: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts, sample: mapped[0] || null },
      { items: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts, sample: mapped[0] || null },
    );
  } catch (e: any) {
    return routeError(500, 'articles_fetch_failed', String(e?.message || e), { items: [] });
  }
}
