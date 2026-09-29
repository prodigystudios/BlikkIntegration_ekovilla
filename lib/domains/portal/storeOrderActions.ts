import type { SupabaseClient } from '@supabase/supabase-js';
import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';
import { FortnoxNotConnectedError, fortnoxPost, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { claimFortnoxPush, documentOrganisationNumber } from '@/lib/domains/fortnox/helpers';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import {
  PORTAL_FORTNOX_LEASE_MS,
  planPortalFortnoxRetry,
  portalFortnoxSafetyNet,
  type PortalFortnoxOutcome,
  type PortalFortnoxRetrySummary,
} from './jobFortnoxRetry';
import {
  STORE_ORDER_FREIGHT_ARTICLE,
  buildStoreOrderFortnoxOrder,
  decideStoreOrderConfirm,
  type StoreOrderConfirmBlocker,
  type StoreOrderRegisterArticle,
} from './storeOrderFortnox';
import { storeOrderFreightFromRow, type StoreOrderBody, type StoreOrderStatus } from './storeOrders';
import { readProfileName } from './storeOrdersStore';

/**
 * Ekovillas steg på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b): frakten, kunden, bekräftelsen och
 * Fortnox-ordern, med omförsöken.
 *
 * SERVICE-ROLLEN: tabellen skrivs bara av servern (se migreringen 20260929065116 och "Reviewed elevations" i
 * SUPABASE_CONVENTIONS.md). Routerna frågar först, med sessionen, crm_store_order_can_manage(): den ansvarige eller en
 * admin, med crm.workorder.write. Kundkortet läses med sessionen, så att bara ett kort som den inloggade ser kan kopplas.
 *
 * Bekräftelsen låser beställningen först och skapar Fortnox-ordern sedan (William 2026-09-29): en Fortnox-order skapas
 * aldrig för en version som butiken hunnit ändra. Går Fortnox inte görs nya försök (jobbens schema, jobFortnoxRetry.ts),
 * och butiken får "bekräftad" först när numret finns (fas 8b3), eftersom kontraktet kräver det.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

export type StoreOrderActor = { id: string };

async function actorName(admin: SupabaseClient, actor: StoreOrderActor): Promise<string | null> {
  return readProfileName(admin, actor.id);
}

async function readStatus(admin: SupabaseClient, id: string): Promise<StoreOrderStatus | null> {
  const { data, error } = await admin.from('crm_store_orders').select('status').eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return ((data as { status: StoreOrderStatus } | null) ?? null)?.status ?? null;
}

// ----------------------------------------------------------------------------------------------------------- frakten

export type StoreOrderFreightInput = { mode: 'none' } | { mode: 'charged'; price: number };

export type SetStoreOrderFreightResult = { kind: 'saved' } | { kind: 'not_received' } | { kind: 'not_found' };

/** Frakten, eller "Ingen frakt", medan beställningen är mottagen. Vakten i databasen nekar den efter det. */
export async function setStoreOrderFreight(
  admin: SupabaseClient,
  id: string,
  freight: StoreOrderFreightInput,
  actor: StoreOrderActor,
  now: () => Date = () => new Date(),
): Promise<SetStoreOrderFreightResult> {
  const name = await actorName(admin, actor);
  const saved = await admin
    .from('crm_store_orders')
    .update({
      freight_mode: freight.mode,
      freight_price: freight.mode === 'charged' ? freight.price : null,
      freight_set_by: actor.id,
      freight_set_by_name: name,
      freight_set_at: now().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'received')
    .select('id');
  if (saved.error) throw new Error(`Frakten kunde inte sparas: ${saved.error.message}`);
  if ((saved.data ?? []).length > 0) return { kind: 'saved' };
  return (await readStatus(admin, id)) ? { kind: 'not_received' } : { kind: 'not_found' };
}

// ------------------------------------------------------------------------------------------------------------ kunden

export type LinkStoreOrderCustomerResult =
  | { kind: 'linked'; storeLinked: boolean }
  | { kind: 'not_found' }
  | { kind: 'not_received' }
  | { kind: 'customer_not_found' }
  /** Butiken är ett företag (som kopplingen i 3c). */
  | { kind: 'not_business' }
  /** Kortet har inget kundnummer i Fortnox, så ordern hade inte kunnat skapas. */
  | { kind: 'customer_not_in_fortnox' };

type LinkCard = { id: string; customer_type: string; fortnox_customer_id: string | null };

/**
 * Butikens kundkort på beställningen, medan den är mottagen. Kopplingen sparas också på butiken, som i fas 3c, och gäller
 * då butikens nästa jobb och beställning när portalens nummer saknas eller är okänt.
 */
export async function linkStoreOrderCustomer(
  session: SupabaseClient,
  admin: SupabaseClient,
  input: { id: string; customerId: string; actor: StoreOrderActor },
  now: () => Date = () => new Date(),
): Promise<LinkStoreOrderCustomerResult> {
  const cardRead = await session
    .from('crm_customers')
    .select('id, customer_type, fortnox_customer_id')
    .eq('id', input.customerId)
    .maybeSingle();
  if (cardRead.error) throw new Error(`Kundkortet gick inte att läsa: ${cardRead.error.message}`);
  const card = cardRead.data as LinkCard | null;
  if (!card) return { kind: 'customer_not_found' };
  if (card.customer_type !== 'business') return { kind: 'not_business' };
  if (!card.fortnox_customer_id?.trim()) return { kind: 'customer_not_in_fortnox' };

  const saved = await admin
    .from('crm_store_orders')
    .update({ customer_id: card.id })
    .eq('id', input.id)
    .eq('status', 'received')
    .select('id, reseller_id');
  if (saved.error) throw new Error(`Kunden kunde inte kopplas: ${saved.error.message}`);
  const row = (saved.data ?? [])[0] as { id: string; reseller_id: string } | undefined;
  if (!row) return (await readStatus(admin, input.id)) ? { kind: 'not_received' } : { kind: 'not_found' };

  // Butikens koppling. Beställningen är redan kopplad här: ett fel loggas och sägs, men stoppar inget.
  const store = await admin
    .from('crm_portal_resellers')
    .update({ customer_id: card.id, customer_linked_by: input.actor.id, customer_linked_at: now().toISOString() })
    .eq('reseller_id', row.reseller_id)
    .select('reseller_id');
  const storeLinked = !store.error && (store.data ?? []).length > 0;
  if (!storeLinked) {
    console.error('[portal-store-orders] butikens koppling sparades inte', { resellerId: row.reseller_id, error: store.error?.message });
  }
  return { kind: 'linked', storeLinked };
}

// ------------------------------------------------------------------------------------------------------ Fortnox-ordern

export type StoreOrderFortnoxDeps = {
  post: (path: string, body: unknown) => Promise<{ Order?: { DocumentNumber?: string | number } }>;
  articles: (articleNumbers: string[]) => Promise<StoreOrderRegisterArticle[]>;
  now: () => Date;
};

export function storeOrderFortnoxDeps(): StoreOrderFortnoxDeps {
  return {
    post: (path, body) => fortnoxPost(path, body),
    // Hela registret för numren, också inaktiva: namnet och enheten gäller ändå raden.
    articles: (numbers) => listCachedFortnoxArticles({ activeOnly: false, numbers }),
    now: () => new Date(),
  };
}

export type StoreOrderPushResult = {
  outcome: PortalFortnoxOutcome;
  fortnoxOrderNumber: string | null;
  /** Varför ordern inte skapades, som säljaren läser det. */
  error: string | null;
};

type PushRow = {
  id: string;
  status: StoreOrderStatus;
  order_number: string;
  payload: StoreOrderBody;
  freight_mode: string | null;
  freight_price: number | string | null;
  customer_id: string | null;
  assigned_to_name: string | null;
  fortnox_order_number: string | null;
  fortnox_attempts: number | null;
  fortnox_retry_until: string | null;
};

const PUSH_SELECT =
  'id, status, order_number, payload, freight_mode, freight_price, customer_id, assigned_to_name, fortnox_order_number, fortnox_attempts, fortnox_retry_until';

async function readPushRow(admin: SupabaseClient, id: string): Promise<PushRow | null> {
  const { data, error } = await admin.from('crm_store_orders').select(PUSH_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as PushRow | null) ?? null;
}

type PushCard = {
  fortnox_customer_id: string | null;
  customer_type: 'business' | 'private';
  organization_number: string | null;
  personal_number: string | null;
};

async function readPushCard(admin: SupabaseClient, customerId: string | null): Promise<PushCard | null> {
  if (!customerId) return null;
  const { data, error } = await admin
    .from('crm_customers')
    .select('fortnox_customer_id, customer_type, organization_number, personal_number')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(`Kundkortet gick inte att läsa: ${error.message}`);
  return (data as PushCard | null) ?? null;
}

/** Utfallet och omförsöken på raden, och claimen släppt. */
async function finishPush(
  admin: SupabaseClient,
  row: Pick<PushRow, 'id' | 'fortnox_attempts' | 'fortnox_retry_until'>,
  outcome: PortalFortnoxOutcome,
  values: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const plan = planPortalFortnoxRetry({ outcome, attempts: row.fortnox_attempts ?? 0, retryUntil: row.fortnox_retry_until, now });
  const saved = await admin.from('crm_store_orders').update({ ...values, ...plan }).eq('id', row.id);
  if (saved.error) throw new Error(`Fortnox-försöket kunde inte bokföras: ${saved.error.message}`);
  if (outcome === 'failed' && plan.fortnox_next_attempt_at === null) {
    console.warn('[portal-store-orders] Fortnox-försöken ges upp; bara för hand nu', { id: row.id, attempts: plan.fortnox_attempts });
  }
}

/**
 * Skapar Fortnox-ordern för en bekräftad beställning, en gång. Claimen (samma som arbetsordern) hindrar två samtidiga
 * försök, och numret sparas direkt efter POST:en: /orders har ingen dubblettspärr hos Fortnox, så ett nummer som inte
 * sparats hade gett en order till vid nästa försök. Kastar bara när databasen inte svarar.
 */
export async function pushStoreOrderToFortnox(
  admin: SupabaseClient,
  id: string,
  deps: StoreOrderFortnoxDeps = storeOrderFortnoxDeps(),
): Promise<StoreOrderPushResult> {
  const first = await readPushRow(admin, id);
  if (!first) return { outcome: 'skipped', fortnoxOrderNumber: null, error: null };
  // Inget att göra. Planen stängs ändå, så att cron inte tar beställningen igen: en som makulerades efter bekräftelsen
  // bär fortfarande skyddsnätet.
  if (first.fortnox_order_number) {
    await finishPush(admin, first, 'exists', {}, deps.now());
    return { outcome: 'exists', fortnoxOrderNumber: first.fortnox_order_number, error: null };
  }
  // Bara en bekräftad: levererad kräver numret, och en makulerad eller tillbakadragen ska aldrig till Fortnox.
  if (first.status !== 'confirmed') {
    await finishPush(admin, first, 'skipped', {}, deps.now());
    return { outcome: 'skipped', fortnoxOrderNumber: null, error: null };
  }

  if (!(await claimFortnoxPush(admin, 'crm_store_orders', id, 'fortnox_order_sync_status', 'fortnox_order_claimed_at'))) {
    await finishPush(admin, first, 'in_progress', {}, deps.now());
    return { outcome: 'in_progress', fortnoxOrderNumber: null, error: 'Fortnox-ordern skapas redan. Vänta en stund och ladda om sidan.' };
  }

  // Raden som den är med claimen: ett försök som hann före kan ha sparat numret, och en makulering kan ha kommit.
  const row = await readPushRow(admin, id);
  if (!row || row.fortnox_order_number || row.status !== 'confirmed') {
    const values = { fortnox_order_sync_status: row?.fortnox_order_number ? 'synced' : 'not_synced', fortnox_order_claimed_at: null };
    if (row) await finishPush(admin, row, row.fortnox_order_number ? 'exists' : 'skipped', values, deps.now());
    return row?.fortnox_order_number
      ? { outcome: 'exists', fortnoxOrderNumber: row.fortnox_order_number, error: null }
      : { outcome: 'skipped', fortnoxOrderNumber: null, error: null };
  }

  const card = await readPushCard(admin, row.customer_id);
  const customerNumber = card?.fortnox_customer_id?.trim();
  if (!customerNumber) {
    // Kortet togs bort, eller tappade numret, efter bekräftelsen. Kräver en människa: inga omförsök.
    const error = 'Kundkortet saknar kundnummer i Fortnox.';
    await finishPush(admin, row, 'blocked', { fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null, fortnox_error: error }, deps.now());
    return { outcome: 'blocked', fortnoxOrderNumber: null, error };
  }

  let number: string;
  try {
    const numbers = [...new Set([...row.payload.lines.map((l) => l.articleNumber), STORE_ORDER_FREIGHT_ARTICLE])];
    const register = new Map((await deps.articles(numbers)).map((a) => [a.article_number, a]));
    const body = buildStoreOrderFortnoxOrder({
      body: row.payload,
      freight: storeOrderFreightFromRow(row),
      customerNumber,
      organisationNumber: documentOrganisationNumber(card),
      ourReference: row.assigned_to_name,
      register,
      orderDate: stockholmTodayISO(deps.now()),
    });
    const response = await deps.post('/orders', body);
    const documentNumber = response.Order?.DocumentNumber;
    if (documentNumber === undefined || documentNumber === null || String(documentNumber).trim() === '') {
      throw new Error('Fortnox returnerade inget ordernummer.');
    }
    number = String(documentNumber);
  } catch (e) {
    const error = e instanceof FortnoxNotConnectedError ? friendlyFortnoxMessage(e) : `Fortnox svarade: ${friendlyFortnoxMessage(e)}`;
    console.error('[portal-store-orders] Fortnox-ordern kunde inte skapas', { id, error: e instanceof Error ? e.message : String(e) });
    await finishPush(
      admin,
      row,
      'failed',
      {
        fortnox_order_sync_status: e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed',
        fortnox_order_claimed_at: null,
        fortnox_error: error,
      },
      deps.now(),
    );
    return { outcome: 'failed', fortnoxOrderNumber: null, error };
  }

  // Numret direkt, i samma skrivning som utfallet: vakten skriver det en gång.
  try {
    await finishPush(
      admin,
      row,
      'created',
      { fortnox_order_number: number, fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null, fortnox_error: null },
      deps.now(),
    );
  } catch (e) {
    // Ordern finns i Fortnox men inte hos oss. Claimen står kvar (i två minuter), och numret står i loggen och i
    // svaret: ett nytt försök hade skapat en order till.
    console.error('[portal-store-orders] 🧨 Fortnox-ordern skapades men numret sparades inte', {
      id,
      fortnoxOrderNumber: number,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      outcome: 'blocked',
      fortnoxOrderNumber: number,
      error: `Fortnox-order ${number} skapades, men numret kunde inte sparas. Skicka inte igen; hör av dig till en admin.`,
    };
  }
  return { outcome: 'created', fortnoxOrderNumber: number, error: null };
}

// ------------------------------------------------------------------------------------------------------ bekräftelsen

export type ConfirmStoreOrderResult =
  | { kind: 'blocked'; reason: StoreOrderConfirmBlocker }
  | { kind: 'not_found' }
  | { kind: 'confirmed'; push: StoreOrderPushResult };

type ConfirmRow = {
  status: StoreOrderStatus;
  store_version: number;
  freight_mode: string | null;
  customer_id: string | null;
};

async function readConfirmRow(admin: SupabaseClient, id: string): Promise<ConfirmRow | null> {
  const { data, error } = await admin
    .from('crm_store_orders')
    .select('status, store_version, freight_mode, customer_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as ConfirmRow | null) ?? null;
}

async function readConfirmCard(admin: SupabaseClient, customerId: string | null) {
  if (!customerId) return null;
  const { data, error } = await admin.from('crm_customers').select('fortnox_customer_id').eq('id', customerId).maybeSingle();
  if (error) throw new Error(`Kundkortet gick inte att läsa: ${error.message}`);
  return (data as { fortnox_customer_id: string | null } | null) ?? null;
}

/**
 * Bekräftar versionen säljaren såg och skapar Fortnox-ordern. Låsningen är en villkorad UPDATE: mottagen, samma version,
 * samma kund och en beslutad frakt. Hann butiken ändra eller dra tillbaka, eller någon annan byta kund eller bekräfta,
 * ändras ingenting och svaret säger varför. Skyddsnätet (ett försök om 5 min) sätts i samma skrivning, så att en
 * process som dör före Fortnox-anropet ändå ger en order.
 */
export async function confirmStoreOrder(
  admin: SupabaseClient,
  input: { id: string; expectedVersion: number; actor: StoreOrderActor },
  deps: StoreOrderFortnoxDeps = storeOrderFortnoxDeps(),
): Promise<ConfirmStoreOrderResult> {
  const row = await readConfirmRow(admin, input.id);
  if (!row) return { kind: 'not_found' };
  const decision = decideStoreOrderConfirm(row, input.expectedVersion, await readConfirmCard(admin, row.customer_id));
  if (!decision.ok) return { kind: 'blocked', reason: decision.reason };

  const now = deps.now();
  const name = await actorName(admin, input.actor);
  let lock = admin
    .from('crm_store_orders')
    .update({
      status: 'confirmed',
      confirmed_at: now.toISOString(),
      confirmed_by: input.actor.id,
      confirmed_by_name: name,
      confirmed_version: input.expectedVersion,
      fortnox_error: null,
      ...portalFortnoxSafetyNet(now),
    })
    .eq('id', input.id)
    .eq('status', 'received')
    .eq('store_version', input.expectedVersion)
    .not('freight_mode', 'is', null);
  lock = row.customer_id ? lock.eq('customer_id', row.customer_id) : lock.is('customer_id', null);
  const locked = await lock.select('id');
  if (locked.error) throw new Error(`Beställningen kunde inte bekräftas: ${locked.error.message}`);
  if ((locked.data ?? []).length === 0) {
    // Något hann före. Beslutet tas om på raden som den står nu, så att svaret säger vad.
    const again = await readConfirmRow(admin, input.id);
    if (!again) return { kind: 'not_found' };
    const retry = decideStoreOrderConfirm(again, input.expectedVersion, await readConfirmCard(admin, again.customer_id));
    return { kind: 'blocked', reason: retry.ok ? 'changed' : retry.reason };
  }

  return { kind: 'confirmed', push: await pushStoreOrderToFortnox(admin, input.id, deps) };
}

// --------------------------------------------------------------------------------------------------------------- cron

/**
 * Försöker igen där det är dags, som jobbens omförsök (retryPortalFortnox): ett lån på tio minuter per beställning, så
 * att två samtidiga körningar aldrig gör samma push, och ett fönster som gått ut ger upp.
 */
export async function retryStoreOrderFortnox(
  admin: SupabaseClient,
  options: { deps?: StoreOrderFortnoxDeps; limit?: number; budgetMs?: number } = {},
): Promise<PortalFortnoxRetrySummary> {
  const deps = options.deps ?? storeOrderFortnoxDeps();
  const startedAt = deps.now().getTime();
  const summary: PortalFortnoxRetrySummary = { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 };

  const { data, error } = await admin
    .from('crm_store_orders')
    .select('id, fortnox_next_attempt_at, fortnox_retry_until')
    .lte('fortnox_next_attempt_at', deps.now().toISOString())
    .order('fortnox_next_attempt_at', { ascending: true })
    .limit(options.limit ?? 2);
  if (error) throw new Error(`Butiksbeställningarnas Fortnox-försök gick inte att läsa: ${error.message}`);
  const due = (data ?? []) as { id: string; fortnox_next_attempt_at: string; fortnox_retry_until: string | null }[];
  summary.due = due.length;

  for (const order of due) {
    if (options.budgetMs !== undefined && deps.now().getTime() - startedAt >= options.budgetMs) break;
    const at = deps.now();
    const expired = order.fortnox_retry_until !== null && at.getTime() > new Date(order.fortnox_retry_until).getTime();
    const lease = await admin
      .from('crm_store_orders')
      .update({ fortnox_next_attempt_at: expired ? null : new Date(at.getTime() + PORTAL_FORTNOX_LEASE_MS).toISOString() })
      .eq('id', order.id)
      .eq('fortnox_next_attempt_at', order.fortnox_next_attempt_at)
      .select('id');
    if (lease.error) {
      summary.errors += 1;
      console.error('[portal-store-orders] beställningen kunde inte tas', { id: order.id, error: lease.error.message });
      continue;
    }
    if ((lease.data ?? []).length === 0) {
      summary.skipped += 1; // en annan körning hann först
      continue;
    }
    if (expired) {
      summary.gaveUp += 1;
      console.warn('[portal-store-orders] Fortnox-försöken ges upp; bara för hand nu', { id: order.id });
      continue;
    }
    try {
      await pushStoreOrderToFortnox(admin, order.id, deps);
      summary.attempted += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-store-orders] Fortnox-försöket föll', { id: order.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
