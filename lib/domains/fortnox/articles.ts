import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet } from './client';
import type { FortnoxArticleListResponse, CachedFortnoxArticle } from './types';

const PAGE_SIZE = 500;

export type ArticleSyncResult = {
  synced: number;
  pages: number;
};

// Fetch all articles from Fortnox and upsert into fortnox_articles_cache.
// Uses service role for DB writes (approved: admin-triggered sync job).
export async function syncFortnoxArticles(): Promise<ArticleSyncResult> {
  const supabase = getSupabaseAdmin();
  let page = 1;
  let totalPages = 1;
  let totalSynced = 0;

  do {
    const response = await fortnoxGet<FortnoxArticleListResponse>('/articles', {
      limit: String(PAGE_SIZE),
      page: String(page),
    });

    const articles = response.Articles ?? [];
    totalPages = response.MetaInformation?.['@TotalPages'] ?? 1;

    if (articles.length > 0) {
      const rows = articles.map((a) => ({
        article_number: a.ArticleNumber,
        description: a.Description ?? null,
        sales_price: a.SalesPrice ?? null,
        purchase_price: a.PurchasePrice ?? null,
        unit: a.Unit ?? null,
        article_type: a.Type ?? null,
        active: a.Active ?? true,
        raw: a as unknown as Record<string, unknown>,
        last_fetched_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('fortnox_articles_cache')
        .upsert(rows, { onConflict: 'article_number' });

      if (error) throw new Error(`Kunde inte spara artiklar: ${error.message}`);
      totalSynced += rows.length;
    }

    page++;
  } while (page <= totalPages);

  return { synced: totalSynced, pages: totalPages };
}

// Read articles from local cache. Fast, no external API call.
export async function listCachedFortnoxArticles(opts?: {
  activeOnly?: boolean;
  search?: string;
  limit?: number;
}): Promise<CachedFortnoxArticle[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('fortnox_articles_cache')
    .select('article_number, description, sales_price, purchase_price, unit, article_type, active, last_fetched_at')
    .order('article_number', { ascending: true });

  if (opts?.activeOnly !== false) {
    query = query.eq('active', true);
  }

  if (opts?.search) {
    query = query.or(
      `article_number.ilike.%${opts.search}%,description.ilike.%${opts.search}%`,
    );
  }

  if (opts?.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Kunde inte läsa artikelcache: ${error.message}`);
  return (data ?? []) as CachedFortnoxArticle[];
}
