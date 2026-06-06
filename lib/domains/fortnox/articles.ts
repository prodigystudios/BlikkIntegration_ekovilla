import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut, fortnoxDelete, FortnoxApiError } from './client';
import type {
  FortnoxArticle,
  FortnoxArticleListResponse,
  FortnoxArticleInput,
  CachedFortnoxArticle,
} from './types';

const PAGE_SIZE = 500;

// Fortnox manages the sales price through a price list when the account is set to
// price-list-controlled pricing – Article.SalesPrice is then read-only and must
// be set via /prices instead. 'A' is Fortnox's standard/default price list; make
// it overridable in case an account uses a different default sales list.
const DEFAULT_SALES_PRICE_LIST = process.env.FORTNOX_DEFAULT_PRICE_LIST || 'A';
// The base price tier (FromQuantity 0) – the price shown as Article.SalesPrice.
const BASE_PRICE_FROM_QUANTITY = '0';

type FortnoxArticleWriteResponse = { Article: FortnoxArticle };

export type ArticleSyncResult = {
  synced: number;
  pages: number;
};

// Map a Fortnox article into a fortnox_articles_cache row. Shared by the bulk
// sync and the single-article write paths so the cached shape stays identical.
function mapFortnoxArticleToCacheRow(a: FortnoxArticle, now: string) {
  return {
    article_number: a.ArticleNumber,
    description: a.Description ?? null,
    sales_price: a.SalesPrice ?? null,
    purchase_price: a.PurchasePrice ?? null,
    unit: a.Unit ?? null,
    article_type: a.Type ?? null,
    active: a.Active ?? true,
    raw: a as unknown as Record<string, unknown>,
    last_fetched_at: now,
  };
}

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
      const now = new Date().toISOString();
      const rows = articles.map((a) => mapFortnoxArticleToCacheRow(a, now));

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

// Build the Fortnox Article payload from our input. Field names must match the
// Fortnox API exactly. undefined values are omitted from the JSON body so an
// update never overwrites Fortnox data with blanks. ArticleNumber is only sent
// on create (and only when the user supplied one – Fortnox auto-assigns otherwise).
// SalesPrice is intentionally NOT sent: it is read-only on price-list-controlled
// accounts and is set separately via setArticleSalesPrice().
// Exported for unit testing – the SalesPrice omission and exact Fortnox field
// names are regression-guarded (Fortnox error 2000321).
export function buildFortnoxArticlePayload(input: FortnoxArticleInput, includeArticleNumber: boolean) {
  return {
    ...(includeArticleNumber && input.ArticleNumber ? { ArticleNumber: input.ArticleNumber } : {}),
    Description: input.Description,
    PurchasePrice: input.PurchasePrice ?? undefined,
    Unit: input.Unit ?? undefined,
    Type: input.Type,
    Active: input.Active,
  };
}

// Set the article's sales price on the default price list via /prices. The price
// row may or may not already exist (a freshly created article has none, an edited
// one usually does), so probe with a GET and either update or create. Requires the
// `price` scope, which the integration already requests.
async function setArticleSalesPrice(articleNumber: string, price: number): Promise<void> {
  const list = encodeURIComponent(DEFAULT_SALES_PRICE_LIST);
  const number = encodeURIComponent(articleNumber);
  const pricePath = `/prices/${list}/${number}/${BASE_PRICE_FROM_QUANTITY}`;

  let exists = false;
  try {
    await fortnoxGet<unknown>(pricePath);
    exists = true;
  } catch (e) {
    if (!(e instanceof FortnoxApiError) || e.status !== 404) throw e;
  }

  if (exists) {
    await fortnoxPut<unknown>(pricePath, { Price: { Price: price } });
  } else {
    await fortnoxPost<unknown>('/prices', {
      Price: {
        ArticleNumber: articleNumber,
        PriceList: DEFAULT_SALES_PRICE_LIST,
        FromQuantity: Number(BASE_PRICE_FROM_QUANTITY),
        Price: price,
      },
    });
  }
}

// Apply the sales price (when provided) and return the authoritative article.
// Re-fetches so the cached SalesPrice reflects the price we just set on the list,
// since the article write response carries the old (read-only) value.
async function applySalesPrice(
  articleNumber: string,
  salesPrice: number | null,
  fallback: FortnoxArticle,
): Promise<FortnoxArticle> {
  if (salesPrice === null || salesPrice === undefined) return fallback;
  await setArticleSalesPrice(articleNumber, salesPrice);
  const reloaded = await fortnoxGet<FortnoxArticleWriteResponse>(
    `/articles/${encodeURIComponent(articleNumber)}`,
  );
  return reloaded.Article;
}

// Upsert a single Fortnox article into the local cache after a write so the list
// reflects the change without a full re-sync. Uses service role – approved use
// for integration writes, consistent with syncFortnoxArticles.
async function upsertArticleCacheRow(article: FortnoxArticle): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('fortnox_articles_cache')
    .upsert(mapFortnoxArticleToCacheRow(article, new Date().toISOString()), {
      onConflict: 'article_number',
    });
  if (error) throw new Error(`Kunde inte uppdatera artikelcache: ${error.message}`);
}

// Create a new article in Fortnox and mirror it into the local cache. The sales
// price is set separately on the price list (see setArticleSalesPrice).
export async function createFortnoxArticle(input: FortnoxArticleInput): Promise<FortnoxArticle> {
  const response = await fortnoxPost<FortnoxArticleWriteResponse>('/articles', {
    Article: buildFortnoxArticlePayload(input, true),
  });
  const article = await applySalesPrice(response.Article.ArticleNumber, input.SalesPrice, response.Article);
  await upsertArticleCacheRow(article);
  return article;
}

// Update an existing article in Fortnox (matched on ArticleNumber, which cannot
// change) and refresh its cache row.
export async function updateFortnoxArticle(
  articleNumber: string,
  input: FortnoxArticleInput,
): Promise<FortnoxArticle> {
  const response = await fortnoxPut<FortnoxArticleWriteResponse>(
    `/articles/${encodeURIComponent(articleNumber)}`,
    { Article: buildFortnoxArticlePayload(input, false) },
  );
  const article = await applySalesPrice(articleNumber, input.SalesPrice, response.Article);
  await upsertArticleCacheRow(article);
  return article;
}

// Delete an article in Fortnox and remove it from the local cache. Fortnox
// rejects the delete (FortnoxApiError) if the article is referenced elsewhere.
export async function deleteFortnoxArticle(articleNumber: string): Promise<void> {
  await fortnoxDelete(`/articles/${encodeURIComponent(articleNumber)}`);

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('fortnox_articles_cache')
    .delete()
    .eq('article_number', articleNumber);
  if (error) throw new Error(`Kunde inte ta bort artikel ur cachen: ${error.message}`);
}
