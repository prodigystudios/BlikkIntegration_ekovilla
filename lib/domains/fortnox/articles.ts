import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut, fortnoxDelete, fortnoxSleep, FortnoxApiError } from './client';
import { articleSearchTokens, sortArticlesFavoritesFirst } from './articleSearch';
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
  /** Antal artiklar som FICK en beskrivning i den här körningen (tomma Note räknas inte). */
  notesFetched: number;
};

// ── Artikelbeskrivningar (Fortnox `Note`) ────────────────────────────────────
//
// `GET /articles` (listan) returnerar INTE `Note` — bara enskild-GET gör det (samma lucka som
// kundernas `Type` och artiklarnas `HouseworkType`). Beskrivningen måste därför hämtas per artikel.
//
// Kostnaden bärs EN gång: `note_synced_at` markerar att vi frågat, så en artikel utan beskrivning
// inte frågas om igen. Första körningen tar ~100 s för ~289 artiklar; därefter hämtas bara nya.

/** Fortnox tål ~4 req/s. En paus mellan varje anrop håller oss under, med marginal. */
const NOTE_FETCH_DELAY_MS = 300;

/**
 * Tak per körning. Skyddar mot att synken springer in i en funktionstimeout om artikelregistret
 * växer kraftigt — resten hämtas vid nästa synk, eftersom `note_synced_at` gör passet resumebart.
 */
const NOTE_FETCH_MAX_PER_RUN = 400;

/**
 * Städar en artikelbeskrivning från upprepade segment.
 *
 * ⚠️ Beskrivningarna i Fortnox är till stor del DUBBLETTER: samma text ligger två till fyra gånger
 * i samma fält, separerad med semikolon. Vid mätning 2026-08-13 gällde det 177 av 227 ifyllda
 * beskrivningar (78 %), och en artikel gick från 435 till 108 tecken vid dedupe. Mönstret ser ut
 * som upprepade importer där texten lagts på i stället för att ersättas.
 *
 * Vi städar vid skrivning till vår cache i stället för att röra Fortnox: fältet är hjälptext för
 * säljaren, och att skriva om 177 artiklar i det skarpa registret är en helt annan sorts åtgärd som
 * kräver ett eget beslut. Funktionen är idempotent, så en omsynk ger samma resultat.
 *
 * Segment jämförs exakt efter trim — inget försök att slå ihop "nästan lika" texter, eftersom två
 * snarlika segment mycket väl kan vara två verkliga upplysningar.
 */
export function dedupeArticleNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return null;
  const segments = trimmed.split(';').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  return [...new Set(segments)].join('; ');
}

/**
 * Hämtar `Note` för artiklar som ännu inte frågats efter och skriver in den i cachen.
 *
 * Sekventiellt med paus — INTE `Promise.all`. Parallell fan-out mot Fortnox är precis vad som
 * sprängde kundimporten (TD-3): 429-storm, tappade svar och tyst felaktig data. Ett misslyckat
 * anrop stämplar ändå `note_synced_at` så en trasig artikel inte blockerar passet för alltid; den
 * plockas upp igen vid nästa fulla omsynk.
 */
export async function syncArticleNotes(): Promise<number> {
  const supabase = getSupabaseAdmin();

  const { data: pending, error } = await supabase
    .from('fortnox_articles_cache')
    .select('article_number')
    .is('note_synced_at', null)
    .order('article_number', { ascending: true })
    .limit(NOTE_FETCH_MAX_PER_RUN);

  if (error) throw new Error(`Kunde inte läsa artiklar utan beskrivning: ${error.message}`);
  if (!pending?.length) return 0;

  let fetched = 0;
  for (const [i, row] of pending.entries()) {
    const articleNumber = (row as { article_number: string }).article_number;
    let note: string | null = null;
    try {
      const { Article } = await fortnoxGet<FortnoxArticleWriteResponse>(
        `/articles/${encodeURIComponent(articleNumber)}`,
      );
      note = dedupeArticleNote(Article?.Note);
      if (note) fetched++;
    } catch (e) {
      // ⚠️ STÄMPLA INTE vid fel. Ett enda 429 eller timeout hade annars satt note_synced_at på en
      // artikel vars beskrivning aldrig lästes — och eftersom passet bara plockar rader där
      // stämpeln är null, och den fulla synken medvetet inte rör kolumnerna, hade den
      // beskrivningen varit borta för alltid utan annan väg tillbaka än manuell SQL. Raden lämnas
      // orörd och plockas upp vid nästa synk. Samma val som verifyCustomerTypesBatch gör.
      console.warn(`[Fortnox] kunde inte hämta beskrivning för artikel ${articleNumber}:`, (e as Error).message);
      continue;
    }

    const { error: updateError } = await supabase
      .from('fortnox_articles_cache')
      .update({ note, note_synced_at: new Date().toISOString() })
      .eq('article_number', articleNumber);
    if (updateError) {
      console.warn(`[Fortnox] kunde inte spara beskrivning för artikel ${articleNumber}:`, updateError.message);
    }

    if (i < pending.length - 1) await fortnoxSleep(NOTE_FETCH_DELAY_MS);
  }

  return fetched;
}

// Map a Fortnox article into a fortnox_articles_cache row. Shared by the bulk
// sync and the single-article write paths so the cached shape stays identical.
//
// ⚠️ `note`/`note_synced_at` ligger MED FLIT utanför. Listendpointen returnerar ingen `Note`, så
// hade fältet stått här hade varje full artikelsynk nollat alla beskrivningar vi mödosamt hämtat
// en och en. En PostgREST-upsert rör bara de kolumner som finns i payloaden — utelämnade kolumner
// står kvar orörda, vilket är precis vad vi vill här. Enskild-GET-vägen sätter dem explicit
// (se upsertArticleCacheRow).
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

  // Beskrivningarna (Note) finns inte i listsvaret och hämtas per artikel — men bara för dem vi
  // inte redan frågat om. Första körningen är därför långsam (~100 s), därefter snabb igen.
  // Icke-fatalt: artiklarna är synkade även om beskrivningshämtningen fallerar, och passet är
  // resumebart via note_synced_at.
  let notesFetched = 0;
  try {
    notesFetched = await syncArticleNotes();
  } catch (e) {
    console.warn('[Fortnox] hämtning av artikelbeskrivningar misslyckades:', (e as Error).message);
  }

  return { synced: totalSynced, pages: totalPages, notesFetched };
}

// Read articles from local cache. Fast, no external API call.
const ARTICLE_CACHE_SELECT =
  'article_number, description, note, sales_price, purchase_price, unit, article_type, active, last_fetched_at';

// The global favorite article numbers (shared, not per-user). Small curated set.
export async function listFavoriteArticleNumbers(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('fortnox_article_favorites').select('article_number');
  if (error) return new Set();
  return new Set((data ?? []).map((r: { article_number: string }) => r.article_number));
}

/**
 * Artiklar som normalt hör hemma i arbetsbeskrivningen (brandmatta, sarg runt lucka) — till
 * skillnad från vindduk, som lämnas till kunden och inte är ett arbetsmoment.
 *
 * Egen tabell av samma skäl som favoriterna: en kolumn på cachen hade behövt undantas för hand ur
 * varje synkväg för att inte nollas. Ett tomt set vid fel är rätt fallback — standarden är "nej",
 * och en trasig läsning ska inte kunna smyga in rader i installatörens beskrivning.
 */
export async function listWorkDescriptionArticleNumbers(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('fortnox_article_work_description_defaults').select('article_number');
  if (error) return new Set();
  return new Set((data ?? []).map((r: { article_number: string }) => r.article_number));
}

export async function listCachedFortnoxArticles(opts?: {
  activeOnly?: boolean;
  search?: string;
  limit?: number;
  /**
   * Slå upp specifika artikelnummer. Används av offertformuläret vid redigering: raderna bär
   * artikelnummer men inte inköpspris (det lagras med flit aldrig på raden — se pricing.ts), så
   * täckningsgraden behöver slås upp för just de artiklar offerten faktiskt använder i stället för
   * att dra hem hela registret.
   */
  numbers?: string[];
}): Promise<CachedFortnoxArticle[]> {
  const supabase = getSupabaseAdmin();
  const [favorites, workDescriptionDefaults] = await Promise.all([
    listFavoriteArticleNumbers(),
    listWorkDescriptionArticleNumbers(),
  ]);

  const tokens = articleSearchTokens(opts?.search);
  // Fresh builder each call — a builder can't be reused after it's awaited.
  const buildQuery = () => {
    let q = supabase.from('fortnox_articles_cache').select(ARTICLE_CACHE_SELECT).order('article_number', { ascending: true });
    if (opts?.activeOnly !== false) q = q.eq('active', true);
    if (opts?.numbers?.length) q = q.in('article_number', opts.numbers);
    // Each token adds an AND group: (number~token OR description~token) — multi-word order-independent.
    for (const token of tokens) q = q.or(`article_number.ilike.%${token}%,description.ilike.%${token}%`);
    return q;
  };
  const mark = (rows: unknown[]): CachedFortnoxArticle[] =>
    (rows as CachedFortnoxArticle[]).map((r) => ({
      ...r,
      is_favorite: favorites.has(r.article_number),
      include_in_work_description: workDescriptionDefaults.has(r.article_number),
    }));

  // No limit (e.g. the register loads everything): fetch all matches, favorites floated up.
  if (!opts?.limit) {
    const { data, error } = await buildQuery();
    if (error) throw new Error(`Kunde inte läsa artikelcache: ${error.message}`);
    return sortArticlesFavoritesFirst(mark(data ?? []));
  }

  // Limited (e.g. the offer picker's 20-row dropdown): fetch matching favorites (unbounded — the
  // set is tiny) separately so they're never cut off by the limit, then fill with the rest.
  const favMatches = favorites.size > 0
    ? mark((await buildQuery().in('article_number', [...favorites])).data ?? [])
    : [];
  const { data: restData, error } = await buildQuery().limit(opts.limit + favorites.size);
  if (error) throw new Error(`Kunde inte läsa artikelcache: ${error.message}`);
  const favSet = new Set(favMatches.map((f) => f.article_number));
  const rest = mark(restData ?? []).filter((r) => !favSet.has(r.article_number));
  return [...favMatches, ...rest].slice(0, opts.limit);
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
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('fortnox_articles_cache')
    .upsert({
      ...mapFortnoxArticleToCacheRow(article, now),
      // Det här är svaret från en ENSKILD artikel, alltså den enda vägen `Note` kommer med. Skriv in
      // den direkt så en beskrivning som ändras i CRM:s artikelformulär slår igenom i offertens
      // artikelväljare med en gång, utan att invänta nästa fulla synk.
      note: dedupeArticleNote(article.Note),
      note_synced_at: now,
    }, { onConflict: 'article_number' });
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
