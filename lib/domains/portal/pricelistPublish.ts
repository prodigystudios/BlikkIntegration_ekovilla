import type { SupabaseClient } from '@supabase/supabase-js';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { listFortnoxPriceListPrices, RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import type { PortalArticleFields } from './articleFields';
import { listPortalArticleFields } from './articleFieldsStore';
import { resolvePortalTarget } from './config';
import { dispatchPortalOutbox, enqueuePortalEvent } from './outbox';
import { NOT_QUEUED, readOutboxDeliveries, type OutboxDelivery } from './outboxDelivery';
import {
  PRICELIST_ORDERING_KEY,
  PRICELIST_PATH,
  buildPricelistDraft,
  isAllowedValidFrom,
  pricelistIdempotencyKey,
  type ListPrice,
  type PricelistDraft,
  type PricelistPayload,
  type RegisterArticle,
} from './pricelist';

/**
 * Publiceringen av prislistan (RESELLER_PORTAL_CRM_PLAN.md fas 2b): läser källorna, sparar publiceringen, köar den och
 * gör ett första utskick. Reglerna för innehållet bor i ./pricelist.ts.
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

/** Utkastet som det ser ut nu: portalfälten, lista 160 ur Fortnox och registret för artiklarna på någon av dem. */
export async function loadPricelistDraft(sources: PricelistSources): Promise<PricelistDraft> {
  const [fields, prices] = await Promise.all([sources.fields(), sources.prices()]);
  const numbers = [...new Set([...fields.map((f) => f.article_number), ...prices.map((p) => p.articleNumber)])].sort();
  const register = await sources.register(numbers);
  return buildPricelistDraft({ fields, register, prices });
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

export type PricelistPublication = {
  id: string;
  validFrom: string;
  contentHash: string;
  idempotencyKey: string;
  articleCount: number;
  publishedByName: string | null;
  createdAt: string;
  delivery: PricelistDelivery;
};

/** De senaste publiceringarna med utskickets status. Sessionsklienten: båda tabellerna kräver crm.portal.manage. */
export async function listPricelistPublications(session: SupabaseClient, limit = 10): Promise<PricelistPublication[]> {
  const { data, error } = await session
    .from('crm_portal_pricelist_publications')
    .select('id, valid_from, content_hash, idempotency_key, article_count, published_by_name, created_at')
    .order('sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Publiceringarna gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    valid_from: string;
    content_hash: string;
    idempotency_key: string;
    article_count: number;
    published_by_name: string | null;
    created_at: string;
  }[];
  const deliveries = await readOutboxDeliveries(session, rows.map((r) => r.idempotency_key));
  return rows.map((r) => ({
    id: r.id,
    validFrom: r.valid_from,
    contentHash: r.content_hash,
    idempotencyKey: r.idempotency_key,
    articleCount: r.article_count,
    publishedByName: r.published_by_name,
    createdAt: r.created_at,
    delivery: deliveries.get(r.idempotency_key) ?? NOT_QUEUED,
  }));
}

// ---------------------------------------------------------------------------------------------------- publiceringen

export type PublishPricelistResult =
  | { kind: 'integration_off'; message: string }
  | { kind: 'invalid_valid_from' }
  | { kind: 'source_error'; message: string }
  | { kind: 'empty' }
  | { kind: 'changed' }
  | { kind: 'forbidden' }
  | { kind: 'db_error'; message: string }
  | {
      kind: 'published';
      created: boolean;
      idempotencyKey: string;
      articleCount: number;
      /** null = statusen gick inte att läsa efter utskicket; publiceringen och händelsen finns. */
      delivery: PricelistDelivery | null;
    };

/** Ett första utskick direkt efter publiceringen: få händelser och kort tid, så att knappen svarar snabbt. */
const PUBLISH_DISPATCH = { limit: 5, budgetMs: 15_000 };

/**
 * Publicerar prislistan som den ser ut NU. Utkastet byggs om här, inte ur klientens kropp, och `expectedHash` är
 * hashen på förhandsvisningen som användaren såg: har något ändrats sedan dess blir det `changed` och inget sparas.
 *
 * Samma publicering eller en ny? Samma innehåll och datum som den SENASTE publiceringen, som portalen inte nekat, är
 * samma publicering: ett dubbelklick eller ett nytt tryck efter ett avbrott gör ingenting nytt. Allt annat är en ny
 * publicering med nästa löpnummer, också samma lista som en tidigare (X, sedan Y, sedan X igen): då ska X ut igen,
 * annars räknar butikerna på Y. Och en nekad lista (4xx) kan skickas igen, till exempel när portalen fått sin
 * mottagare.
 *
 * Ordningen, och varför den tål ett avbrott var som helst:
 *   1. publiceringen sparas (sessionen; samma nyckel en gång till = samma rad),
 *   2. händelsen köas (service-rollen; samma nyckel = samma händelse),
 *   3. ett första utskick. Det som inte hinner eller inte går fram ligger kvar i kön.
 * Dör anropet efter 1 står publiceringen som "inte köad" och är den senaste, så samma publicering igen köar den.
 */
export async function publishPricelist(
  deps: {
    session: SupabaseClient;
    admin: SupabaseClient;
    env: Record<string, string | undefined>;
    sources: PricelistSources;
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

  let draft: PricelistDraft;
  try {
    draft = await loadPricelistDraft(deps.sources);
  } catch (e) {
    return { kind: 'source_error', message: describeSourceError(e) };
  }
  if (draft.articles.length === 0) return { kind: 'empty' };
  if (draft.hash !== input.expectedHash) return { kind: 'changed' };

  const payload: PricelistPayload = { validFrom: input.validFrom, resellerId: null, articles: draft.articles };

  const latestRead = await deps.session
    .from('crm_portal_pricelist_publications')
    .select('sequence, valid_from, content_hash, idempotency_key')
    .order('sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRead.error) return { kind: 'db_error', message: latestRead.error.message };
  const latest = latestRead.data as { sequence: number; valid_from: string; content_hash: string; idempotency_key: string } | null;

  let idempotencyKey: string | null = null;
  if (latest && latest.valid_from === input.validFrom && latest.content_hash === draft.hash) {
    let latestStatus: PricelistDelivery['status'];
    try {
      latestStatus = ((await readOutboxDeliveries(deps.admin, [latest.idempotency_key])).get(latest.idempotency_key) ?? NOT_QUEUED).status;
    } catch (e) {
      return { kind: 'db_error', message: e instanceof Error ? e.message : 'Utskickets status gick inte att läsa.' };
    }
    if (latestStatus !== 'dead') idempotencyKey = latest.idempotency_key;
  }
  const sequence = (latest?.sequence ?? 0) + 1;
  idempotencyKey ??= pricelistIdempotencyKey(input.validFrom, draft.hash, sequence);

  const inserted = await deps.session
    .from('crm_portal_pricelist_publications')
    .upsert(
      {
        valid_from: input.validFrom,
        content_hash: draft.hash,
        sequence: idempotencyKey === latest?.idempotency_key ? latest.sequence : sequence,
        idempotency_key: idempotencyKey,
        payload,
        article_count: draft.articles.length,
        published_by: deps.actor.id,
        published_by_name: deps.actor.name ? deps.actor.name.slice(0, 200) : null,
      },
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
    await enqueuePortalEvent(deps.admin, {
      idempotencyKey,
      path: PRICELIST_PATH,
      payload,
      orderingKey: PRICELIST_ORDERING_KEY,
    });
  } catch (e) {
    return { kind: 'db_error', message: e instanceof Error ? e.message : 'Publiceringen kunde inte köas.' };
  }

  try {
    await dispatchPortalOutbox(deps.admin, { env: deps.env, ...PUBLISH_DISPATCH, fetchImpl: deps.fetchImpl });
  } catch (e) {
    // Händelsen ligger i kön; utskicket görs om med "Skicka väntande nu" (och av utskicket i fas 4b).
    console.error('[portal-pricelist] första utskicket misslyckades', e instanceof Error ? e.message : e);
  }

  let delivery: PricelistDelivery | null = null;
  try {
    delivery = (await readOutboxDeliveries(deps.admin, [idempotencyKey])).get(idempotencyKey) ?? NOT_QUEUED;
  } catch (e) {
    console.error('[portal-pricelist] status efter utskicket', e instanceof Error ? e.message : e);
  }
  return { kind: 'published', created, idempotencyKey, articleCount: draft.articles.length, delivery };
}
