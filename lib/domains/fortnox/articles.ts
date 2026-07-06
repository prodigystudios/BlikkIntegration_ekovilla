import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut, fortnoxDelete, FortnoxApiError } from './client';
import { articleSearchTokens } from './articleSearch';
import { listFortnoxPriceLists } from './customers';
import type {
  FortnoxArticle,
  FortnoxArticleListResponse,
  FortnoxArticleInput,
  FortnoxArticlePriceInput,
  FortnoxArticlePriceRow,
  CachedFortnoxArticle,
} from './types';

const PAGE_SIZE = 500;

// Fortnox manages sales prices through price lists when the account is set to
// price-list-controlled pricing – Article.SalesPrice is then read-only and must
// be set via /prices instead. The base price tier (FromQuantity 0) is the price
// shown as Article.SalesPrice for the account's default list.
const BASE_PRICE_FROM_QUANTITY = '0';

type FortnoxArticleWriteResponse = { Article: FortnoxArticle };
type FortnoxPriceResponse = { Price: { Price: number | null } };

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

  // Each token adds an AND group: (number~token OR description~token). Multi-word queries thus
  // match regardless of word order/adjacency; a single token behaves exactly as before.
  for (const token of articleSearchTokens(opts?.search)) {
    query = query.or(`article_number.ilike.%${token}%,description.ilike.%${token}%`);
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
// accounts and is set separately via the /prices endpoints.
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
    VAT: input.VAT ?? undefined,
    EAN: input.EAN ?? undefined,
    Manufacturer: input.Manufacturer ?? undefined,
    ManufacturerArticleNumber: input.ManufacturerArticleNumber ?? undefined,
    Note: input.Note ?? undefined,
  };
}

function pricePath(articleNumber: string, priceList: string): string {
  return `/prices/${encodeURIComponent(priceList)}/${encodeURIComponent(articleNumber)}/${BASE_PRICE_FROM_QUANTITY}`;
}

// Read the article's base price on one price list, or null when no price is set.
async function getArticlePrice(articleNumber: string, priceList: string): Promise<number | null> {
  try {
    const res = await fortnoxGet<FortnoxPriceResponse>(pricePath(articleNumber, priceList));
    return res.Price?.Price ?? null;
  } catch (e) {
    if (e instanceof FortnoxApiError && e.status === 404) return null;
    throw e;
  }
}

// Upsert the article's base price on one price list. The row may or may not
// already exist (a fresh article has none), so probe with a GET and either PUT
// (update) or POST (create). Requires the `price` scope.
async function setArticlePrice(articleNumber: string, priceList: string, price: number): Promise<void> {
  let exists = false;
  try {
    await fortnoxGet<FortnoxPriceResponse>(pricePath(articleNumber, priceList));
    exists = true;
  } catch (e) {
    if (!(e instanceof FortnoxApiError) || e.status !== 404) throw e;
  }

  if (exists) {
    await fortnoxPut<unknown>(pricePath(articleNumber, priceList), { Price: { Price: price } });
  } else {
    await fortnoxPost<unknown>('/prices', {
      Price: {
        ArticleNumber: articleNumber,
        PriceList: priceList,
        FromQuantity: Number(BASE_PRICE_FROM_QUANTITY),
        Price: price,
      },
    });
  }
}

// Remove the article's base price on one price list. A missing row is a no-op.
async function deleteArticlePrice(articleNumber: string, priceList: string): Promise<void> {
  try {
    await fortnoxDelete(pricePath(articleNumber, priceList));
  } catch (e) {
    if (e instanceof FortnoxApiError && e.status === 404) return;
    throw e;
  }
}

// Apply per-price-list prices: a number upserts that list's price, null clears it.
// Sequential to stay well within Fortnox rate limits (price lists are few).
async function applyPrices(articleNumber: string, prices: FortnoxArticlePriceInput[]): Promise<void> {
  for (const { priceList, price } of prices) {
    if (price === null) {
      await deleteArticlePrice(articleNumber, priceList);
    } else {
      await setArticlePrice(articleNumber, priceList, price);
    }
  }
}

// Apply prices then re-fetch so the cached SalesPrice reflects the account's
// default list (the article write response carries the old, read-only value).
async function applyPricesAndReload(
  articleNumber: string,
  prices: FortnoxArticlePriceInput[],
  fallback: FortnoxArticle,
): Promise<FortnoxArticle> {
  if (prices.length === 0) return fallback;
  await applyPrices(articleNumber, prices);
  const reloaded = await fortnoxGet<FortnoxArticleWriteResponse>(
    `/articles/${encodeURIComponent(articleNumber)}`,
  );
  return reloaded.Article;
}

// Load the full article plus its base price on every price list, for the edit page.
export async function getFortnoxArticleForEdit(
  articleNumber: string,
): Promise<{ article: FortnoxArticle; priceLists: FortnoxArticlePriceRow[] }> {
  const [{ Article: article }, lists] = await Promise.all([
    fortnoxGet<FortnoxArticleWriteResponse>(`/articles/${encodeURIComponent(articleNumber)}`),
    listFortnoxPriceLists(),
  ]);

  const priceLists = await Promise.all(
    lists.map(async (l) => ({
      code: l.code,
      description: l.description,
      price: await getArticlePrice(articleNumber, l.code),
    })),
  );

  return { article, priceLists };
}

// List the account's price lists with empty prices, for the create page.
export async function listFortnoxArticlePriceLists(): Promise<FortnoxArticlePriceRow[]> {
  const lists = await listFortnoxPriceLists();
  return lists.map((l) => ({ code: l.code, description: l.description, price: null }));
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

// Create a new article in Fortnox and mirror it into the local cache. Sales
// prices are set separately per price list (see applyPrices).
export async function createFortnoxArticle(
  input: FortnoxArticleInput,
  prices: FortnoxArticlePriceInput[] = [],
): Promise<FortnoxArticle> {
  const response = await fortnoxPost<FortnoxArticleWriteResponse>('/articles', {
    Article: buildFortnoxArticlePayload(input, true),
  });
  const article = await applyPricesAndReload(response.Article.ArticleNumber, prices, response.Article);
  await upsertArticleCacheRow(article);
  return article;
}

// Update an existing article in Fortnox (matched on ArticleNumber, which cannot
// change) and refresh its cache row.
export async function updateFortnoxArticle(
  articleNumber: string,
  input: FortnoxArticleInput,
  prices: FortnoxArticlePriceInput[] = [],
): Promise<FortnoxArticle> {
  const response = await fortnoxPut<FortnoxArticleWriteResponse>(
    `/articles/${encodeURIComponent(articleNumber)}`,
    { Article: buildFortnoxArticlePayload(input, false) },
  );
  const article = await applyPricesAndReload(articleNumber, prices, response.Article);
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
