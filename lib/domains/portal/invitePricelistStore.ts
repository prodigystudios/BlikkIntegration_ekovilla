import type { SupabaseClient } from '@supabase/supabase-js';
import { getFortnoxCustomerPriceList } from '@/lib/domains/fortnox/customers';
import { listFortnoxPriceListPrices, RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { resolvePortalTarget } from './config';
import { listFromPublished } from './invitePricelist';
import { enqueuePortalEvent } from './outbox';
import { readOutboxDeliveries } from './outboxDelivery';
import { partnerListCode } from './partnerPricelists';
import {
  PRICELIST_PATH,
  pricelistIdempotencyKey,
  pricelistOrderingKey,
  type ListPrice,
  type PricelistArticle,
  type PricelistPayload,
} from './pricelist';

/**
 * Steget i portalens cron som ger en ny butik dess egen lista när inbjudan gått fram (RESELLER_PORTAL_CRM_PLAN.md 10b3).
 * Körs också av "Skicka väntande nu": testmiljön har ingen cron.
 *
 * Williams beslut 2026-10-01:
 *   - EFTER att inbjudan gått fram, inte vid inbjudan: företaget finns då i portalen, och listan går i butikens egen
 *     ordning i kön (`pricelist:<id>`), samma som publiceringens. Två ordningar för samma butiks listor hade låtit en sen
 *     lista gå fram efter en nyare, och "Skicka om" ser bara senare händelser i samma ordning.
 *   - I den SENASTE publiceringen: samma löpnummer och datum, en rad till. En publicering är fortfarande alla listor.
 *   - Byggd på den publicerade lista 160 med kortets grundpriser ovanpå (invitePricelist.ts).
 *
 * En gång per butik: inbjudans `pricelist_settled_at` sätts när butiken är klar, så att kortet bara läses i Fortnox en
 * gång. Klar är också "inget att göra": ingen publicering än (den första tar med butiken), butiken redan med i den
 * senaste, eller kortet på den gemensamma listan. Ett försök som faller görs om tidigast 15 minuter senare.
 *
 * Ordningen, och varför den tål ett avbrott var som helst:
 *   1. butikens rad i den senaste publiceringen (samma nyckel en gång till = samma rad; löpnumret och butiken är unika),
 *   2. finns en nyare publicering nu, har den butiken (inbjudan har gått fram): raden tas bort, inget köas,
 *   3. listan köas (samma nyckel = samma händelse),
 *   4. inbjudan markeras klar.
 * Dör varvet efter 1 eller 3 finns raden i den senaste publiceringen men inbjudan är inte klar: nästa varv köar raden
 * om den inte redan är köad, och markerar.
 *
 * Service-rollen: steget körs utan session, som resten av cron, och kön skrivs bara av service_role.
 */

/** Ett försök som föll görs om tidigast så här mycket senare: kortet och listan läses i Fortnox. */
export const INVITE_PRICELIST_RETRY_MS = 15 * 60 * 1000;
/** Hur många obehandlade inbjudningar ett varv läser. Fler än så finns inte; de flesta blir klara direkt. */
const CANDIDATE_LIMIT = 500;

export type InvitePricelistSources = {
  /** Kortets prislista i Fortnox, som Fortnox skriver den (null = ingen). */
  cardPriceList: (customerNumber: string) => Promise<string | null>;
  /** En listas priser i Fortnox. */
  listPrices: (code: string) => Promise<ListPrice[]>;
};

export function invitePricelistSources(): InvitePricelistSources {
  return { cardPriceList: getFortnoxCustomerPriceList, listPrices: listFortnoxPriceListPrices };
}

export type InvitePricelistSweepSummary = {
  /** Butiker vars inbjudan gått fram och som inte är klara. */
  candidates: number;
  /** Butiker som fick sin lista köad. */
  queued: number;
  /** Butiker som var klara utan någon lista (ingen publicering än, redan med, den gemensamma listan). */
  settled: number;
  /** Butiker där något föll; görs om om 15 minuter. */
  failed: number;
  /** Butiker som väntar till ett senare varv: gränsen per varv, eller ett försök som nyss föll. */
  deferred: number;
};

type InviteRow = {
  reseller_id: string;
  idempotency_key: string;
  invited_by: string | null;
  invited_by_name: string | null;
  pricelist_attempted_at: string | null;
};

type PublicationRow = {
  sequence: number;
  valid_from: string;
  reseller_id: string | null;
  content_hash: string;
  idempotency_key: string;
  payload: PricelistPayload;
};

type LatestPublication = { sequence: number; validFrom: string; rows: PublicationRow[] };

async function readLatestSequence(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin
    .from('crm_portal_pricelist_publications')
    .select('sequence')
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Publiceringarna gick inte att läsa: ${error.message}`);
  return (data as { sequence: number } | null)?.sequence ?? null;
}

async function readLatestPublication(admin: SupabaseClient): Promise<LatestPublication | null> {
  const sequence = await readLatestSequence(admin);
  if (sequence === null) return null;
  const { data, error } = await admin
    .from('crm_portal_pricelist_publications')
    .select('sequence, valid_from, reseller_id, content_hash, idempotency_key, payload')
    .eq('sequence', sequence);
  if (error) throw new Error(`Publiceringen gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as PublicationRow[];
  const shared = rows.find((r) => r.reseller_id === null);
  if (!shared) throw new Error(`Publiceringen ${sequence} saknar den gemensamma listan.`);
  return { sequence, validFrom: shared.valid_from, rows };
}

/** Butikens kort i Fortnox. null = butiken har inget kort med ett kundnummer, och får den gemensamma listan. */
async function readStoreCustomerNumber(admin: SupabaseClient, resellerId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('crm_portal_resellers')
    .select('reseller_id, customer:crm_customers(fortnox_customer_id)')
    .eq('reseller_id', resellerId)
    .maybeSingle();
  if (error) throw new Error(`Företaget gick inte att läsa: ${error.message}`);
  const row = data as { customer: { fortnox_customer_id: string | null } | null } | null;
  return row?.customer?.fortnox_customer_id?.trim() || null;
}

/** Har butiken haft en egen lista? Då får den alltid en egen (10b2): 160 som egen lista om kortet gått tillbaka. */
async function hadOwnList(admin: SupabaseClient, resellerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('crm_portal_pricelist_publications')
    .select('id')
    .eq('reseller_id', resellerId)
    .limit(1);
  if (error) throw new Error(`Publiceringarna gick inte att läsa: ${error.message}`);
  return (data ?? []).length > 0;
}

function enqueueList(admin: SupabaseClient, idempotencyKey: string, payload: PricelistPayload, resellerId: string) {
  return enqueuePortalEvent(admin, { idempotencyKey, path: PRICELIST_PATH, payload, orderingKey: pricelistOrderingKey(resellerId) });
}

/** Butikens rad finns redan i den senaste publiceringen: köa den om ingen gjort det (ett varv som dog före köandet). */
async function ensureQueued(admin: SupabaseClient, row: PublicationRow, resellerId: string): Promise<'queued' | 'settled'> {
  const delivery = (await readOutboxDeliveries(admin, [row.idempotency_key])).get(row.idempotency_key);
  if (delivery && delivery.status !== 'not_queued') return 'settled';
  await enqueueList(admin, row.idempotency_key, row.payload, resellerId);
  return 'queued';
}

/** Steg 1–3 för en butik. `queued` = en lista köades; `settled` = inget att köa. Kastar när något föll. */
async function settleStore(
  admin: SupabaseClient,
  resellerId: string,
  invite: InviteRow,
  sources: InvitePricelistSources,
): Promise<'queued' | 'settled'> {
  const latest = await readLatestPublication(admin);
  // Ingen publicering än: den första tar med butiken, eftersom inbjudan har gått fram.
  if (!latest) return 'settled';

  // Redan med i den senaste: publicerad efter att inbjudan gick fram, eller ett tidigare varv som dog före köandet.
  const existing = latest.rows.find((r) => r.reseller_id === resellerId);
  if (existing) return ensureQueued(admin, existing, resellerId);

  const shared = latest.rows.find((r) => r.reseller_id === null)!;
  const customerNumber = await readStoreCustomerNumber(admin, resellerId);
  if (!customerNumber) return 'settled';

  const code = partnerListCode(await sources.cardPriceList(customerNumber));
  let list: { code: string; articles: PricelistArticle[]; hash: string };
  if (code) {
    list = { code, ...listFromPublished(shared.payload.articles, await sources.listPrices(code)) };
  } else if (await hadOwnList(admin, resellerId)) {
    list = { code: RESELLER_PRICE_LIST_CODE, articles: shared.payload.articles, hash: shared.content_hash };
  } else {
    // Kortet har den gemensamma listan: den gäller redan butiken i portalen.
    return 'settled';
  }

  // Steg 1.
  const idempotencyKey = pricelistIdempotencyKey(latest.validFrom, list.hash, latest.sequence, resellerId);
  const payload: PricelistPayload = { validFrom: latest.validFrom, resellerId, articles: list.articles };
  const inserted = await admin
    .from('crm_portal_pricelist_publications')
    .upsert(
      {
        valid_from: latest.validFrom,
        content_hash: list.hash,
        sequence: latest.sequence,
        idempotency_key: idempotencyKey,
        payload,
        article_count: list.articles.length,
        // Den som bjöd in: det var inbjudan som skickade listan.
        published_by: invite.invited_by,
        published_by_name: invite.invited_by_name ? invite.invited_by_name.slice(0, 200) : null,
        reseller_id: resellerId,
        price_list_code: list.code,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) {
    // Löpnumret och butiken är unika: ett annat varv lade in butiken i samma stund. Dess rad gäller; köa den om det
    // varvet dog innan det hann.
    if (inserted.error.code === '23505') {
      const raced = (await readLatestPublication(admin))?.rows.find((r) => r.reseller_id === resellerId && r.sequence === latest.sequence);
      if (!raced) throw new Error('Listan krockade men gick inte att läsa.');
      return ensureQueued(admin, raced, resellerId);
    }
    throw new Error(`Listan kunde inte sparas: ${inserted.error.message}`);
  }
  const created = (inserted.data ?? []).length > 0;

  // Steg 2. En nyare publicering har butiken, och vår lista får inte gå fram efter den.
  if ((await readLatestSequence(admin)) !== latest.sequence) {
    if (created) {
      const removed = await admin.from('crm_portal_pricelist_publications').delete().eq('idempotency_key', idempotencyKey);
      if (removed.error) throw new Error(`Listan kunde inte tas bort: ${removed.error.message}`);
    }
    return 'settled';
  }

  // Steg 3.
  await enqueueList(admin, idempotencyKey, payload, resellerId);
  return 'queued';
}

/**
 * Ett varv: butiker vars inbjudan gått fram och som inte är klara, högst `limit` stycken. Avstängd integration: ingenting
 * köas, så att ingen lista går iväg den dag hemligheten sätts (samma som publiceringen).
 */
export async function sweepInvitePricelists(
  admin: SupabaseClient,
  options: { now: () => Date; env: Record<string, string | undefined>; sources: InvitePricelistSources; limit?: number },
): Promise<InvitePricelistSweepSummary> {
  const summary: InvitePricelistSweepSummary = { candidates: 0, queued: 0, settled: 0, failed: 0, deferred: 0 };
  if (!resolvePortalTarget(options.env).ok) return summary;

  const read = await admin
    .from('crm_portal_reseller_invites')
    .select('reseller_id, idempotency_key, invited_by, invited_by_name, pricelist_attempted_at')
    .is('pricelist_settled_at', null)
    .order('created_at')
    .limit(CANDIDATE_LIMIT);
  if (read.error) throw new Error(`Inbjudningarna gick inte att läsa: ${read.error.message}`);
  const invites = (read.data ?? []) as InviteRow[];
  if (invites.length === 0) return summary;

  // Bara de som gått fram: före det finns företaget inte i portalen.
  const deliveries = await readOutboxDeliveries(admin, invites.map((i) => i.idempotency_key));
  const stores = new Map<string, InviteRow[]>();
  for (const invite of invites) {
    if (deliveries.get(invite.idempotency_key)?.status !== 'sent') continue;
    stores.set(invite.reseller_id, [...(stores.get(invite.reseller_id) ?? []), invite]);
  }
  summary.candidates = stores.size;

  const now = options.now();
  const retryAfter = now.getTime() - INVITE_PRICELIST_RETRY_MS;
  const limit = options.limit ?? 10;
  let handled = 0;
  for (const [resellerId, storeInvites] of stores) {
    const failedRecently = storeInvites.some((i) => i.pricelist_attempted_at && new Date(i.pricelist_attempted_at).getTime() > retryAfter);
    if (failedRecently || handled >= limit) {
      summary.deferred += 1;
      continue;
    }
    handled += 1;
    try {
      const outcome = await settleStore(admin, resellerId, storeInvites[0], options.sources);
      // Steg 4. Alla butikens inbjudningar som inte är klara: ett senare försök ska inte göra om det.
      const done = await admin
        .from('crm_portal_reseller_invites')
        .update({ pricelist_settled_at: now.toISOString(), pricelist_error: null })
        .eq('reseller_id', resellerId)
        .is('pricelist_settled_at', null);
      if (done.error) throw new Error(`Inbjudan kunde inte markeras: ${done.error.message}`);
      summary[outcome] += 1;
    } catch (e) {
      summary.failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error('[portal-invite-pricelist] butikens lista föll', { resellerId, error: message });
      const marked = await admin
        .from('crm_portal_reseller_invites')
        .update({ pricelist_attempted_at: now.toISOString(), pricelist_error: message.slice(0, 500) })
        .eq('reseller_id', resellerId)
        .is('pricelist_settled_at', null);
      if (marked.error) console.error('[portal-invite-pricelist] försöket kunde inte markeras', { resellerId, error: marked.error.message });
    }
  }
  return summary;
}
