import type { SupabaseClient } from '@supabase/supabase-js';
import { getFortnoxCustomerPriceList } from '@/lib/domains/fortnox/customers';
import { listFortnoxPriceListPrices, RESELLER_PRICE_LIST_CODE } from '@/lib/domains/fortnox/priceLists';
import { resolvePortalTarget } from './config';
import { listFromPublished } from './invitePricelist';
import { enqueuePortalEvent } from './outbox';
import { readOutboxDeliveries, type OutboxDelivery } from './outboxDelivery';
import { chunkIds } from '@/lib/domains/planning/pagedRead';
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
 * Ordningen, och varför den tål ett avbrott var som helst och en publicering i samma stund:
 *   1. butikens rad i den senaste publiceringen (samma nyckel en gång till = samma rad; löpnumret och butiken är unika:
 *      ett annat varv som hann före ger en krock, och dess rad gäller),
 *   2. listan köas (samma nyckel = samma händelse),
 *   3. EFTER köandet: är publiceringen fortfarande den senaste? Kom en nyare emellan ska den vinna. Väntar vår lista
 *      fortfarande i kön stoppas den, och raden tas bort om vi lade in den; har den redan börjat gå gick den före den
 *      nyare, i butikens ordning. Sedan prövas butiken mot den nyare: den kan sakna butiken (förhandsvisningen lästes
 *      innan inbjudan gick fram), och då läggs listan där,
 *   4. inbjudan markeras klar.
 * Dör varvet efter 1 eller 2 finns raden i den senaste publiceringen men inbjudan är inte klar: nästa varv köar raden
 * om den inte redan är köad, och markerar.
 *
 * Service-rollen: steget körs utan session, som resten av cron, och kön skrivs bara av service_role.
 */

/** Ett försök som föll görs om tidigast så här mycket senare: kortet och listan läses i Fortnox. */
export const INVITE_PRICELIST_RETRY_MS = 15 * 60 * 1000;
/**
 * Hur många obehandlade inbjudningar ett varv läser, de nyaste först. En inbjudan som aldrig går fram blir aldrig klar;
 * de nyaste först gör att sådana inte kan tränga ut en ny.
 */
export const INVITE_PRICELIST_CANDIDATE_LIMIT = 500;
/** Hur många nya senaste publiceringar en butik prövas mot inom ett varv. */
const MAX_PUBLICATION_RACES = 3;

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

/** Nycklarna står i adressen (`in.(…)`): i portioner, som publiceringens. */
async function readDeliveries(admin: SupabaseClient, keys: string[]): Promise<Map<string, OutboxDelivery>> {
  const out = new Map<string, OutboxDelivery>();
  for (const chunk of chunkIds(keys)) for (const [key, delivery] of await readOutboxDeliveries(admin, chunk)) out.set(key, delivery);
  return out;
}

function enqueueList(admin: SupabaseClient, idempotencyKey: string, payload: PricelistPayload, resellerId: string) {
  return enqueuePortalEvent(admin, { idempotencyKey, path: PRICELIST_PATH, payload, orderingKey: pricelistOrderingKey(resellerId) });
}

/**
 * Steg 2 och 3 för butikens rad i publiceringen `sequence`. `queued`: listan köades och publiceringen är fortfarande den
 * senaste. `settled`: listan var redan köad (publiceringen eller ett annat varv). `newer`: en nyare publicering kom; vår
 * lista är stoppad om den fortfarande väntade, och butiken ska prövas mot den nyare.
 */
async function queueInLatest(
  admin: SupabaseClient,
  row: Pick<PublicationRow, 'idempotency_key' | 'payload'>,
  sequence: number,
  resellerId: string,
  created: boolean,
): Promise<'queued' | 'settled' | 'newer'> {
  const delivery = (await readOutboxDeliveries(admin, [row.idempotency_key])).get(row.idempotency_key);
  if (delivery && delivery.status !== 'not_queued') return 'settled';
  await enqueueList(admin, row.idempotency_key, row.payload, resellerId);

  // Steg 3, efter köandet: en publicering som köar butikens nyare lista före oss syns här, och vår lista står då bakom
  // den i butikens ordning och kan inte ha gått. En som köar efter oss går efter vår, som den ska.
  if ((await readLatestSequence(admin)) === sequence) return 'queued';
  const stopped = await admin
    .from('portal_outbound_events')
    .update({ status: 'superseded' })
    .eq('idempotency_key', row.idempotency_key)
    .eq('status', 'pending')
    .select('id');
  if (stopped.error) throw new Error(`Listan kunde inte stoppas: ${stopped.error.message}`);
  if ((stopped.data ?? []).length > 0 && created) {
    const removed = await admin.from('crm_portal_pricelist_publications').delete().eq('idempotency_key', row.idempotency_key);
    if (removed.error) throw new Error(`Listan kunde inte tas bort: ${removed.error.message}`);
  }
  return 'newer';
}

/** Butikens lista i publiceringen: kortets egen, 160 som egen lista, eller null (den gemensamma gäller redan). */
async function storeList(
  admin: SupabaseClient,
  latest: LatestPublication,
  resellerId: string,
  sources: InvitePricelistSources,
): Promise<{ code: string; articles: PricelistArticle[]; hash: string } | null> {
  const shared = latest.rows.find((r) => r.reseller_id === null)!;
  const customerNumber = await readStoreCustomerNumber(admin, resellerId);
  const code = customerNumber ? partnerListCode(await sources.cardPriceList(customerNumber)) : null;
  if (code) return { code, ...listFromPublished(shared.payload.articles, await sources.listPrices(code)) };
  // Som publiceringen (pricelistBatch.ts): en butik som haft en egen lista får 160 som egen, också utan kort.
  if (await hadOwnList(admin, resellerId)) {
    return { code: RESELLER_PRICE_LIST_CODE, articles: shared.payload.articles, hash: shared.content_hash };
  }
  return null;
}

/** Steg 1–3 för en butik. `queued` = en lista köades; `settled` = inget att köa. Kastar när något föll. */
async function settleStore(
  admin: SupabaseClient,
  resellerId: string,
  invite: InviteRow,
  sources: InvitePricelistSources,
): Promise<'queued' | 'settled'> {
  // En lista som hann börja gå före en nyare publicering räknas: butiken fick den.
  let queued = false;
  const done = (outcome: 'queued' | 'settled') => (queued || outcome === 'queued' ? 'queued' : 'settled');

  for (let round = 0; round < MAX_PUBLICATION_RACES; round++) {
    const latest = await readLatestPublication(admin);
    // Ingen publicering än: den första tar med butiken, eftersom inbjudan har gått fram.
    if (!latest) return done('settled');

    // Redan med i den senaste: publicerad efter att inbjudan gick fram, eller ett tidigare varv som dog före köandet.
    const existing = latest.rows.find((r) => r.reseller_id === resellerId);
    if (existing) {
      const outcome = await queueInLatest(admin, existing, latest.sequence, resellerId, false);
      if (outcome !== 'newer') return done(outcome);
      continue;
    }

    const list = await storeList(admin, latest, resellerId, sources);
    if (!list) return done('settled');

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
      // Löpnumret och butiken är unika: ett annat varv lade in butiken i samma stund. Läs om; dess rad gäller.
      if (inserted.error.code === '23505') continue;
      throw new Error(`Listan kunde inte sparas: ${inserted.error.message}`);
    }

    const outcome = await queueInLatest(admin, { idempotency_key: idempotencyKey, payload }, latest.sequence, resellerId, (inserted.data ?? []).length > 0);
    if (outcome !== 'newer') return done(outcome);
    // Stoppades den inte hann den börja gå, före den nyare.
    const event = (await readOutboxDeliveries(admin, [idempotencyKey])).get(idempotencyKey);
    if (event && event.status !== 'superseded') queued = true;
  }
  throw new Error('Publiceringarna ändrades medan listan köades. Försöker igen senare.');
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
    .order('created_at', { ascending: false })
    .limit(INVITE_PRICELIST_CANDIDATE_LIMIT);
  if (read.error) throw new Error(`Inbjudningarna gick inte att läsa: ${read.error.message}`);
  const invites = (read.data ?? []) as InviteRow[];
  if (invites.length === 0) return summary;

  // Bara de som gått fram: före det finns företaget inte i portalen.
  const deliveries = await readDeliveries(admin, invites.map((i) => i.idempotency_key));
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
