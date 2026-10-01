import type { SupabaseClient } from '@supabase/supabase-js';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { listFortnoxPriceListPrices, RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import type { PortalArticleFields } from './articleFields';
import { listPortalArticleFields } from './articleFieldsStore';
import { resolvePortalTarget } from './config';
import { dispatchPortalOutbox, enqueuePortalEvent } from './outbox';
import { NOT_QUEUED, readOutboxDeliveries, type OutboxDelivery } from './outboxDelivery';
import type { PricelistBatchItem } from './pricelistBatch';
import type { PricelistBatchLoad } from './pricelistBatchSources';
import {
  PRICELIST_PATH,
  buildPricelistDraft,
  isAllowedValidFrom,
  pricelistIdempotencyKey,
  pricelistOrderingKey,
  type ListPrice,
  type PricelistDraft,
  type PricelistPayload,
  type RegisterArticle,
} from './pricelist';

/**
 * Publiceringen av prislistan (RESELLER_PORTAL_CRM_PLAN.md fas 2b): läser källorna, sparar publiceringen, köar den och
 * gör ett första utskick. Reglerna för innehållet bor i ./pricelist.ts, och vad en publicering består av (lista 160 och
 * butikernas egna listor, 10b2) i ./pricelistBatch.ts.
 *
 * Två klienter, med flit:
 *   sessionen      portalfälten, artikelregistret, publiceringarna och köns status. RLS är grinden.
 *   service-rollen kön skrivs och töms bara av service_role (fas 1b). Se "Reviewed elevations" i
 *                  SUPABASE_CONVENTIONS.md.
 */

export type PricelistSources = {
  fields: () => Promise<PortalArticleFields[]>;
  register: (articleNumbers: string[]) => Promise<RegisterArticle[]>;
  prices: () => Promise<ListPrice[]>;
};

/**
 * Registret för de här artikelnumren, med sessionen (cachens läspolicy släpper in sales och admin; crm.portal.manage
 * är admin). I delar: numren står i adressen (`in.(…)`), och ett svar kapas tyst vid 1000 rader.
 */
const REGISTER_CHUNK = 150;

export async function readRegisterArticles(session: SupabaseClient, articleNumbers: string[]): Promise<RegisterArticle[]> {
  const out: RegisterArticle[] = [];
  for (let i = 0; i < articleNumbers.length; i += REGISTER_CHUNK) {
    const { data, error } = await session
      .from('fortnox_articles_cache')
      .select('article_number, description, unit, active')
      .in('article_number', articleNumbers.slice(i, i + REGISTER_CHUNK));
    if (error) throw new Error(`Artikelregistret gick inte att läsa: ${error.message}`);
    out.push(...((data ?? []) as RegisterArticle[]));
  }
  return out;
}

export function pricelistSources(session: SupabaseClient): PricelistSources {
  return {
    fields: () => listPortalArticleFields(session),
    register: (articleNumbers) => readRegisterArticles(session, articleNumbers),
    prices: () => listFortnoxPriceListPrices(RESELLER_PRICE_LIST_CODE),
  };
}

/** Det utkastet byggs av: portalfälten, lista 160 ur Fortnox och registret för artiklarna på någon av dem. */
export type PricelistInputs = { fields: PortalArticleFields[]; register: RegisterArticle[]; prices: ListPrice[] };

/**
 * Källorna som de ser ut nu. Partnerlistorna (10b) bygger på samma läsning, så att de och den gemensamma listan
 * räknas på samma portalfält och samma register.
 */
export async function loadPricelistInputs(sources: PricelistSources): Promise<PricelistInputs> {
  const [fields, prices] = await Promise.all([sources.fields(), sources.prices()]);
  const numbers = [...new Set([...fields.map((f) => f.article_number), ...prices.map((p) => p.articleNumber)])].sort();
  const register = await sources.register(numbers);
  return { fields, register, prices };
}

/** Utkastet som det ser ut nu. */
export async function loadPricelistDraft(sources: PricelistSources): Promise<PricelistDraft> {
  return buildPricelistDraft(await loadPricelistInputs(sources));
}

/** Ett fel från källorna, som en användare kan läsa. Fortnox egna fel översätts; andra får sitt eget meddelande. */
export function describeSourceError(e: unknown): string {
  if (e instanceof FortnoxNotConnectedError || e instanceof FortnoxApiError) {
    return `Lista ${RESELLER_PRICE_LIST_CODE} gick inte att läsa: ${friendlyFortnoxMessage(e)}`;
  }
  return e instanceof Error ? e.message : 'Prislistan gick inte att läsa.';
}

// ----------------------------------------------------------------------------------------------------- leveransen

/** Hur det gick för publiceringens händelse i kön. Läses som inbjudningarnas, se outboxDelivery.ts. */
export type PricelistDelivery = OutboxDelivery;

// ---------------------------------------------------------------------------------------------------- historiken

/** En lista i en publicering: den gemensamma, eller en butiks egen. */
export type PricelistPublicationList = {
  /** null = den gemensamma listan. */
  resellerId: string | null;
  /** Butikens namn, om butiken finns kvar. */
  storeName: string | null;
  /** Listan i Fortnox. null på publiceringar före 10b2. */
  code: string | null;
  contentHash: string;
  articleCount: number;
  idempotencyKey: string;
  delivery: PricelistDelivery;
};

/** En publicering: alla rader med samma löpnummer. Fälten utanför `lists` gäller den gemensamma listan. */
export type PricelistPublication = {
  id: string;
  sequence: number;
  validFrom: string;
  contentHash: string;
  idempotencyKey: string;
  articleCount: number;
  publishedByName: string | null;
  createdAt: string;
  /** Den sämsta statusen bland listorna: en nekad lista syns, också när den gemensamma gick fram. */
  delivery: PricelistDelivery;
  lists: PricelistPublicationList[];
};

type PublicationRow = {
  id: string;
  sequence: number;
  valid_from: string;
  content_hash: string;
  idempotency_key: string;
  article_count: number;
  published_by_name: string | null;
  created_at: string;
  reseller_id: string | null;
  price_list_code: string | null;
};

const PUBLICATION_SELECT =
  'id, sequence, valid_from, content_hash, idempotency_key, article_count, published_by_name, created_at, reseller_id, price_list_code';

/** Hur illa det gick, för att visa publiceringens sämsta lista. */
const DELIVERY_SEVERITY: Record<PricelistDelivery['status'], number> = {
  dead: 5,
  not_queued: 4,
  pending: 3,
  sending: 2,
  superseded: 1,
  sent: 0,
};

const KEY_CHUNK = 100;

async function readDeliveriesChunked(client: SupabaseClient, keys: string[]): Promise<Map<string, PricelistDelivery>> {
  const out = new Map<string, PricelistDelivery>();
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    for (const [key, delivery] of await readOutboxDeliveries(client, keys.slice(i, i + KEY_CHUNK))) out.set(key, delivery);
  }
  return out;
}

/**
 * De senaste publiceringarna med varje listas utskick. Sessionsklienten: publiceringarna, kön och butikerna kräver
 * crm.portal.manage. Raderna läses med ett tak; en publicering har en rad per butik med egen lista, några tiotal som mest.
 */
export async function listPricelistPublications(session: SupabaseClient, limit = 10): Promise<PricelistPublication[]> {
  const { data, error } = await session
    .from('crm_portal_pricelist_publications')
    .select(PUBLICATION_SELECT)
    .order('sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Publiceringarna gick inte att läsa: ${error.message}`);

  const groups = new Map<number, PublicationRow[]>();
  for (const row of (data ?? []) as PublicationRow[]) {
    if (!groups.has(row.sequence) && groups.size >= limit) break;
    groups.set(row.sequence, [...(groups.get(row.sequence) ?? []), row]);
  }
  const rows = [...groups.values()].flat();
  const deliveries = await readDeliveriesChunked(session, rows.map((r) => r.idempotency_key));

  const storeIds = [...new Set(rows.flatMap((r) => (r.reseller_id ? [r.reseller_id] : [])))];
  const names = new Map<string, string>();
  for (let i = 0; i < storeIds.length; i += KEY_CHUNK) {
    const stores = await session
      .from('crm_portal_resellers')
      .select('reseller_id, name')
      .in('reseller_id', storeIds.slice(i, i + KEY_CHUNK));
    if (stores.error) throw new Error(`Butikerna gick inte att läsa: ${stores.error.message}`);
    for (const st of (stores.data ?? []) as { reseller_id: string; name: string }[]) names.set(st.reseller_id, st.name);
  }

  return [...groups.values()].map((group) => {
    // Den gemensamma listan först, sedan butikerna efter namn.
    const lists: PricelistPublicationList[] = group
      .map((r) => ({
        resellerId: r.reseller_id,
        storeName: r.reseller_id ? (names.get(r.reseller_id) ?? null) : null,
        code: r.price_list_code,
        contentHash: r.content_hash,
        articleCount: r.article_count,
        idempotencyKey: r.idempotency_key,
        delivery: deliveries.get(r.idempotency_key) ?? NOT_QUEUED,
      }))
      .sort((a, b) =>
        a.resellerId === null ? -1 : b.resellerId === null ? 1 : (a.storeName ?? a.resellerId).localeCompare(b.storeName ?? b.resellerId, 'sv'),
      );
    const head = group.find((r) => r.reseller_id === null) ?? group[0];
    const shared = lists[0];
    const worst = lists.reduce((w, l) => (DELIVERY_SEVERITY[l.delivery.status] > DELIVERY_SEVERITY[w.delivery.status] ? l : w), shared);
    return {
      id: head.id,
      sequence: head.sequence,
      validFrom: head.valid_from,
      contentHash: shared.contentHash,
      idempotencyKey: shared.idempotencyKey,
      articleCount: shared.articleCount,
      publishedByName: head.published_by_name,
      createdAt: head.created_at,
      delivery: worst.delivery,
      lists,
    };
  });
}

// ---------------------------------------------------------------------------------------------------- publiceringen

export type PublishedList = {
  resellerId: string | null;
  code: string;
  articleCount: number;
  idempotencyKey: string;
  /** null = statusen gick inte att läsa efter utskicket; publiceringen och händelsen finns. */
  delivery: PricelistDelivery | null;
};

export type PublishPricelistResult =
  | { kind: 'integration_off'; message: string }
  | { kind: 'invalid_valid_from' }
  | { kind: 'source_error'; message: string }
  | { kind: 'empty' }
  /** Ett kort eller en lista gick inte att läsa: ingenting publiceras, inte heller lista 160. */
  | { kind: 'blocked'; problems: string[] }
  | { kind: 'changed' }
  | { kind: 'forbidden' }
  | { kind: 'db_error'; message: string }
  | {
      kind: 'published';
      created: boolean;
      /** Den gemensamma listans nyckel, antal och utskick. */
      idempotencyKey: string;
      articleCount: number;
      delivery: PricelistDelivery | null;
      /** Alla listor i publiceringen, den gemensamma först. */
      lists: PublishedList[];
    };

/** Ett första utskick direkt efter publiceringen: kort tid, så att knappen svarar snabbt. Resten går med kön. */
const PUBLISH_DISPATCH = { minLimit: 5, maxLimit: 25, budgetMs: 15_000 };

type LatestRow = { reseller_id: string | null; content_hash: string; valid_from: string; idempotency_key: string };

/** Är den senaste publiceringen samma publicering: samma datum och samma listor till samma butiker? */
function sameBatch(rows: LatestRow[], items: PricelistBatchItem[], validFrom: string): boolean {
  if (rows.length !== items.length) return false;
  const want = new Set(items.map((i) => `${i.resellerId ?? ''}|${i.hash}`));
  return rows.every((r) => r.valid_from === validFrom && want.has(`${r.reseller_id ?? ''}|${r.content_hash}`));
}

/**
 * Publicerar listorna som de ser ut NU: lista 160 och butikernas egna (10b2), med samma datum. Allt byggs om här, inte ur
 * klientens kropp, och `expectedHash` är hashen på förhandsvisningen som användaren såg: har något ändrats sedan dess
 * blir det `changed` och inget sparas. Med bara lista 160 är allt som före 10b2: samma hash, nyckel och kropp.
 *
 * Samma publicering eller en ny? Samma datum och samma listor till samma butiker som den SENASTE publiceringen, där ingen
 * lista nekats, är samma publicering: ett dubbelklick eller ett nytt tryck efter ett avbrott gör ingenting nytt. Allt
 * annat är en ny publicering med nästa löpnummer, också samma listor som en tidigare (X, sedan Y, sedan X igen): då ska
 * X ut igen, annars räknar butikerna på Y. Och en nekad lista (4xx) kan skickas igen.
 *
 * Ordningen, och varför den tål ett avbrott var som helst:
 *   1. publiceringens rader sparas i ett anrop (sessionen; samma nyckel en gång till = samma rad),
 *   2. varje lista köas (service-rollen; samma nyckel = samma händelse), den gemensamma i sin ordning och varje butiks
 *      egna i butikens,
 *   3. ett första utskick. Det som inte hinner eller inte går fram ligger kvar i kön.
 * Dör anropet efter 1 eller mitt i 2 är publiceringen den senaste och inte nekad, så samma publicering igen köar resten.
 */
export async function publishPricelist(
  deps: {
    session: SupabaseClient;
    admin: SupabaseClient;
    env: Record<string, string | undefined>;
    /** Lista 160, butikernas listor och historiken (pricelistBatchSources.ts). */
    loadBatch: () => Promise<PricelistBatchLoad>;
    today: string;
    actor: { id: string; name: string | null };
    fetchImpl?: typeof fetch;
  },
  input: { validFrom: string; expectedHash: string },
): Promise<PublishPricelistResult> {
  // Avstängd integration: ingenting köas, så att en gammal lista inte går iväg den dag hemligheten sätts.
  const target = resolvePortalTarget(deps.env);
  if (!target.ok) return { kind: 'integration_off', message: target.message };
  if (!isAllowedValidFrom(input.validFrom, deps.today)) return { kind: 'invalid_valid_from' };

  let load: PricelistBatchLoad;
  try {
    load = await deps.loadBatch();
  } catch (e) {
    return { kind: 'source_error', message: describeSourceError(e) };
  }
  const { shared, batch } = load;
  if (shared.articles.length === 0) return { kind: 'empty' };
  if (batch.problems.length > 0) return { kind: 'blocked', problems: batch.problems.map((p) => `${p.what}: ${p.message}`) };
  if (batch.hash !== input.expectedHash) return { kind: 'changed' };

  const latestRead = await deps.session
    .from('crm_portal_pricelist_publications')
    .select('sequence')
    .order('sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRead.error) return { kind: 'db_error', message: latestRead.error.message };
  const latestSequence = (latestRead.data as { sequence: number } | null)?.sequence ?? null;

  // Samma publicering som den senaste: dess nycklar, per butik.
  let reuse: Map<string, string> | null = null;
  if (latestSequence !== null) {
    const rowsRead = await deps.session
      .from('crm_portal_pricelist_publications')
      .select('reseller_id, content_hash, valid_from, idempotency_key')
      .eq('sequence', latestSequence);
    if (rowsRead.error) return { kind: 'db_error', message: rowsRead.error.message };
    const rows = (rowsRead.data ?? []) as LatestRow[];
    if (sameBatch(rows, batch.items, input.validFrom)) {
      let deliveries: Map<string, PricelistDelivery>;
      try {
        deliveries = await readDeliveriesChunked(deps.admin, rows.map((r) => r.idempotency_key));
      } catch (e) {
        return { kind: 'db_error', message: e instanceof Error ? e.message : 'Utskickens status gick inte att läsa.' };
      }
      if (rows.every((r) => deliveries.get(r.idempotency_key)?.status !== 'dead')) {
        reuse = new Map(rows.map((r) => [r.reseller_id ?? '', r.idempotency_key]));
      }
    }
  }
  const sequence = reuse ? latestSequence! : (latestSequence ?? 0) + 1;

  const planned = batch.items.map((item) => {
    const idempotencyKey =
      reuse?.get(item.resellerId ?? '') ?? pricelistIdempotencyKey(input.validFrom, item.hash, sequence, item.resellerId);
    const payload: PricelistPayload = { validFrom: input.validFrom, resellerId: item.resellerId, articles: item.articles };
    return { item, idempotencyKey, payload };
  });

  const inserted = await deps.session
    .from('crm_portal_pricelist_publications')
    .upsert(
      planned.map(({ item, idempotencyKey, payload }) => ({
        valid_from: input.validFrom,
        content_hash: item.hash,
        sequence,
        idempotency_key: idempotencyKey,
        payload,
        article_count: item.articles.length,
        published_by: deps.actor.id,
        published_by_name: deps.actor.name ? deps.actor.name.slice(0, 200) : null,
        reseller_id: item.resellerId,
        price_list_code: item.code,
      })),
      // ON CONFLICT DO NOTHING: sessionen har ingen update, och publiceringen ska aldrig skrivas om.
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) {
    if (inserted.error.code === '42501') return { kind: 'forbidden' };
    return { kind: 'db_error', message: inserted.error.message };
  }
  const created = (inserted.data ?? []).length > 0;

  try {
    for (const { item, idempotencyKey, payload } of planned) {
      await enqueuePortalEvent(deps.admin, {
        idempotencyKey,
        path: PRICELIST_PATH,
        payload,
        orderingKey: pricelistOrderingKey(item.resellerId),
      });
    }
  } catch (e) {
    return { kind: 'db_error', message: e instanceof Error ? e.message : 'Publiceringen kunde inte köas.' };
  }

  try {
    const limit = Math.min(PUBLISH_DISPATCH.maxLimit, Math.max(PUBLISH_DISPATCH.minLimit, planned.length));
    await dispatchPortalOutbox(deps.admin, { env: deps.env, limit, budgetMs: PUBLISH_DISPATCH.budgetMs, fetchImpl: deps.fetchImpl });
  } catch (e) {
    // Händelserna ligger i kön; utskicket görs om med "Skicka väntande nu" (och av utskicket i fas 4b).
    console.error('[portal-pricelist] första utskicket misslyckades', e instanceof Error ? e.message : e);
  }

  let deliveries: Map<string, PricelistDelivery> | null = null;
  try {
    deliveries = await readDeliveriesChunked(deps.admin, planned.map((p) => p.idempotencyKey));
  } catch (e) {
    console.error('[portal-pricelist] status efter utskicket', e instanceof Error ? e.message : e);
  }
  const lists: PublishedList[] = planned.map(({ item, idempotencyKey }) => ({
    resellerId: item.resellerId,
    code: item.code,
    articleCount: item.articles.length,
    idempotencyKey,
    delivery: deliveries ? (deliveries.get(idempotencyKey) ?? NOT_QUEUED) : null,
  }));
  return {
    kind: 'published',
    created,
    idempotencyKey: lists[0].idempotencyKey,
    articleCount: lists[0].articleCount,
    delivery: lists[0].delivery,
    lists,
  };
}
