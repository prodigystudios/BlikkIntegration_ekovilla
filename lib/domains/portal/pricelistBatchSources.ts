import type { SupabaseClient } from '@supabase/supabase-js';
import { readOutboxDeliveries } from './outboxDelivery';
import {
  buildPartnerPricelists,
  partnerPricelistSources,
  readPartnerPricelists,
  type PartnerPricelistSources,
  type PartnerPricelistsPreview,
} from './partnerPricelistSources';
import { buildPricelistBatch, type PricelistBatchDraft } from './pricelistBatch';
import { buildPricelistDraft, type PricelistDraft } from './pricelist';
import { loadPricelistInputs, pricelistSources, type PricelistInputs, type PricelistSources } from './pricelistPublish';

/**
 * Allt en publicering läser (RESELLER_PORTAL_CRM_PLAN.md 10b2): lista 160, butikernas egna listor och historiken. Samma
 * läsning ger förhandsvisningen och publiceringen, så att förhandsvisningens hash betyder samma sak i båda.
 *
 * Sessionsklienten: publiceringarna, butikerna, inbjudningarna och köns status är läsbara för crm.portal.manage.
 */

export type PricelistHistory = {
  /** Butiker som har haft en egen lista och finns kvar. */
  everOwn: Set<string>;
  /** Butiker som bjudits in från CRM:et men vars inbjudan aldrig gått fram: företaget finns inte i portalen än. */
  notInPortal: Set<string>;
};

export type PricelistBatchSources = {
  pricelist: PricelistSources;
  partner: PartnerPricelistSources;
  history: () => Promise<PricelistHistory>;
};

/** PostgREST kapar ett svar vid 1000 rader utan att säga till. Sida för sida, med en unik sista ordning. */
const PAGE = 1000;
const KEY_CHUNK = 100;

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${what} gick inte att läsa: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE) return out;
  }
}

export async function readPricelistHistory(session: SupabaseClient): Promise<PricelistHistory> {
  const [own, stores, invites] = await Promise.all([
    readAll<{ reseller_id: string }>(
      (from, to) =>
        session
          .from('crm_portal_pricelist_publications')
          .select('id, reseller_id')
          .not('reseller_id', 'is', null)
          .order('id')
          .range(from, to),
      'Publiceringarna',
    ),
    readAll<{ reseller_id: string }>(
      (from, to) => session.from('crm_portal_resellers').select('reseller_id').order('reseller_id').range(from, to),
      'Butikerna',
    ),
    readAll<{ reseller_id: string; idempotency_key: string }>(
      (from, to) => session.from('crm_portal_reseller_invites').select('id, reseller_id, idempotency_key').order('id').range(from, to),
      'Inbjudningarna',
    ),
  ]);

  const existing = new Set(stores.map((s) => s.reseller_id));
  const everOwn = new Set(own.map((r) => r.reseller_id).filter((id) => existing.has(id)));

  const keys = invites.map((i) => i.idempotency_key);
  const sent = new Set<string>();
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    for (const [key, delivery] of await readOutboxDeliveries(session, keys.slice(i, i + KEY_CHUNK))) {
      if (delivery.status === 'sent') sent.add(key);
    }
  }
  const delivered = new Set(invites.filter((i) => sent.has(i.idempotency_key)).map((i) => i.reseller_id));
  const notInPortal = new Set(invites.map((i) => i.reseller_id).filter((id) => !delivered.has(id)));
  return { everOwn, notInPortal };
}

export function pricelistBatchSources(session: SupabaseClient): PricelistBatchSources {
  return {
    pricelist: pricelistSources(session),
    partner: partnerPricelistSources(session),
    history: () => readPricelistHistory(session),
  };
}

export type PricelistBatchLoad = {
  inputs: PricelistInputs;
  shared: PricelistDraft;
  partner: PartnerPricelistsPreview;
  batch: PricelistBatchDraft;
};

/** Lista 160, butikernas listor och historiken, samtidigt. Ett fel i lista 160 eller databasen kastas. */
export async function loadPricelistBatch(sources: PricelistBatchSources): Promise<PricelistBatchLoad> {
  const [inputs, reads, history] = await Promise.all([
    loadPricelistInputs(sources.pricelist),
    readPartnerPricelists(sources.partner),
    sources.history(),
  ]);
  const shared = buildPricelistDraft(inputs);
  const partner = buildPartnerPricelists(reads, inputs, shared);
  return { inputs, shared, partner, batch: buildPricelistBatch({ shared, partner, ...history }) };
}
