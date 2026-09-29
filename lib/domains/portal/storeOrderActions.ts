import type { SupabaseClient } from '@supabase/supabase-js';
import { FortnoxApiError, FortnoxNotConnectedError, fortnoxGet, fortnoxPost, fortnoxPut, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { claimFortnoxPush, documentOrganisationNumber } from '@/lib/domains/fortnox/helpers';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import {
  PORTAL_FORTNOX_LEASE_MS,
  PORTAL_FORTNOX_RETRY_WINDOW_MS,
  PORTAL_FORTNOX_SAFETY_NET_MS,
  planPortalFortnoxRetry,
  portalFortnoxSafetyNet,
  type PortalFortnoxOutcome,
  type PortalFortnoxRetrySummary,
} from './jobFortnoxRetry';
import {
  STORE_ORDER_FREIGHT_ARTICLE,
  buildStoreOrderFortnoxOrder,
  decideStoreOrderConfirm,
  pickStoreOrderFortnoxMatch,
  storeOrderFortnoxReference,
  type StoreOrderConfirmBlocker,
  type StoreOrderConfirmExpected,
  type StoreOrderConfirmRow,
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

/**
 * Får sessionen göra Ekovillas steg på beställningen? En beställning som sessionen ser (RLS, crm.access), och regeln
 * crm_store_order_can_manage() (den ansvarige eller admin, med crm.workorder.write), frågade parallellt. Samma regel som
 * sidan frågar. Kastar när databasen inte svarar.
 */
export async function storeOrderManageAccess(session: SupabaseClient, id: string): Promise<'allowed' | 'not_found' | 'forbidden'> {
  const [seen, allowed] = await Promise.all([
    session.from('crm_store_orders').select('id').eq('id', id).maybeSingle(),
    session.rpc('crm_store_order_can_manage', { p_id: id }),
  ]);
  if (seen.error) throw new Error(`Beställningen gick inte att läsa: ${seen.error.message}`);
  if (!seen.data) return 'not_found';
  if (allowed.error) throw new Error(`Behörigheten gick inte att pröva: ${allowed.error.message}`);
  return allowed.data === true ? 'allowed' : 'forbidden';
}

async function readStatus(admin: SupabaseClient, id: string): Promise<StoreOrderStatus | null> {
  const { data, error } = await admin.from('crm_store_orders').select('status').eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return ((data as { status: StoreOrderStatus } | null) ?? null)?.status ?? null;
}

// ----------------------------------------------------------------------------------------------------------- frakten

export type StoreOrderFreightInput = { mode: 'none' } | { mode: 'charged'; price: number };

export type SetStoreOrderFreightResult =
  | { kind: 'saved' }
  | { kind: 'not_received' }
  | { kind: 'not_found' }
  /** Frakten är inte längre den säljaren såg: någon annan sparade under tiden. Ingenting sparat; läs om. */
  | { kind: 'freight_changed' };

/**
 * Frakten, eller "Ingen frakt", medan beställningen är mottagen. Vakten i databasen nekar den efter det. Sparas bara mot
 * frakten säljaren såg (`expectedSetAt`, null = inte satt), så att en annans nyare frakt aldrig skrivs över tyst.
 */
export async function setStoreOrderFreight(
  admin: SupabaseClient,
  id: string,
  freight: StoreOrderFreightInput,
  actor: StoreOrderActor,
  expectedSetAt: string | null,
  now: () => Date = () => new Date(),
): Promise<SetStoreOrderFreightResult> {
  const name = await readProfileName(admin, actor.id);
  const base = admin
    .from('crm_store_orders')
    .update({
      freight_mode: freight.mode,
      freight_price: freight.mode === 'charged' ? freight.price : null,
      freight_set_by: actor.id,
      freight_set_by_name: name,
      freight_set_at: now().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'received');
  const saved = await (expectedSetAt === null ? base.is('freight_set_at', null) : base.eq('freight_set_at', expectedSetAt)).select('id');
  if (saved.error) throw new Error(`Frakten kunde inte sparas: ${saved.error.message}`);
  if ((saved.data ?? []).length > 0) return { kind: 'saved' };
  const status = await readStatus(admin, id);
  if (!status) return { kind: 'not_found' };
  return status === 'received' ? { kind: 'freight_changed' } : { kind: 'not_received' };
}

// ------------------------------------------------------------------------------------------------------------ kunden

export type LinkStoreOrderCustomerResult =
  /**
   * `storeLink`: butikens koppling. `linked` sparad; `kept` butiken hade redan en, som står kvar; `failed` gick inte att
   * spara (sägs); `not_applicable` ett byte, som bara gäller beställningen.
   */
  | { kind: 'linked'; storeLink: 'linked' | 'kept' | 'failed' | 'not_applicable' }
  | { kind: 'not_found' }
  | { kind: 'not_received' }
  /** Kunden är inte längre den säljaren såg (butikens ändring, eller en annan hos Ekovilla). Ingenting sparat; läs om. */
  | { kind: 'customer_changed' }
  | { kind: 'customer_not_found' }
  /** Butiken är ett företag (som kopplingen i 3c). */
  | { kind: 'not_business' }
  /** Kortet har inget kundnummer i Fortnox, så ordern hade inte kunnat skapas. */
  | { kind: 'customer_not_in_fortnox' };

type LinkCard = { id: string; customer_type: string; fortnox_customer_id: string | null };

/**
 * Butikens kundkort på beställningen, medan den är mottagen. Kom beställningen utan kund, och saknar butiken en koppling,
 * sparas kopplingen också på butiken (som fas 3c) och gäller då butikens nästa jobb och beställning när portalens nummer
 * saknas eller är okänt. Ett byte, eller en butik som redan är kopplad, gäller bara beställningen.
 */
export async function linkStoreOrderCustomer(
  session: SupabaseClient,
  admin: SupabaseClient,
  /** `expectedCustomerId`: kunden säljaren såg på beställningen (null = ingen). */
  input: { id: string; customerId: string; expectedCustomerId: string | null; actor: StoreOrderActor },
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

  // Bara om kunden fortfarande är den säljaren såg: en butiksändring (changeStoreOrder) eller en annan hos Ekovilla kan
  // ha kopplat ett kort under tiden, och då skrivs varken den eller butikens koppling över.
  const hadCustomer = input.expectedCustomerId !== null;
  const base = admin
    .from('crm_store_orders')
    .update({ customer_id: card.id })
    .eq('id', input.id)
    .eq('status', 'received');
  const conditioned = hadCustomer ? base.eq('customer_id', input.expectedCustomerId as string) : base.is('customer_id', null);
  const saved = await conditioned.select('id, reseller_id');
  if (saved.error) throw new Error(`Kunden kunde inte kopplas: ${saved.error.message}`);
  const row = (saved.data ?? [])[0] as { id: string; reseller_id: string } | undefined;
  if (!row) {
    const status = await readStatus(admin, input.id);
    if (!status) return { kind: 'not_found' };
    return status === 'received' ? { kind: 'customer_changed' } : { kind: 'not_received' };
  }

  // Ett byte gäller bara den här beställningen: butikens koppling (som gäller nästa jobb och beställning) sätts bara när
  // beställningen kom utan kund, som i fas 3c. Ett byte hade annars flyttat butiken till ett kort som valts för en order.
  if (hadCustomer) return { kind: 'linked', storeLink: 'not_applicable' };

  // Butikens koppling för hand, bara om butiken saknar en (`customer_linked_at`): en som gjorts sedan beställningen kom
  // (ett jobb, 3c) flyttas aldrig av en beställning. En koppling via kundnumret räknas inte, eftersom intaget bara läser
  // den för hand när numret saknas eller är okänt (manualCustomerLink). Beställningen är redan kopplad här: ett fel
  // loggas och sägs, men stoppar inget.
  const store = await admin
    .from('crm_portal_resellers')
    .update({ customer_id: card.id, customer_linked_by: input.actor.id, customer_linked_at: now().toISOString() })
    .eq('reseller_id', row.reseller_id)
    .is('customer_linked_at', null)
    .select('reseller_id');
  if (store.error) {
    console.error('[portal-store-orders] butikens koppling sparades inte', { resellerId: row.reseller_id, error: store.error.message });
    return { kind: 'linked', storeLink: 'failed' };
  }
  // Ingen rad: butiken hade redan en koppling för hand, som står kvar.
  return { kind: 'linked', storeLink: (store.data ?? []).length > 0 ? 'linked' : 'kept' };
}

// ------------------------------------------------------------------------------------------------------ Fortnox-ordern

export type StoreOrderFortnoxDeps = {
  post: (path: string, body: unknown) => Promise<{ Order?: { DocumentNumber?: string | number } }>;
  /** Makulerar en Fortnox-order: den här pushens egen, när ett annat försök hann spara sitt nummer först. */
  cancel: (orderNumber: string) => Promise<void>;
  /** Fortnox-ordern som redan bär märkningen, eller null. Kastar när Fortnox inte svarar: då skickas ingenting. */
  findExisting: (reference: string) => Promise<string | null>;
  articles: (articleNumbers: string[]) => Promise<StoreOrderRegisterArticle[]>;
  now: () => Date;
};

type FortnoxOrderList = { Orders?: { DocumentNumber?: string | number | null; ExternalInvoiceReference1?: string | null }[] };

export function storeOrderFortnoxDeps(admin: SupabaseClient): StoreOrderFortnoxDeps {
  return {
    post: (path, body) => fortnoxPost(path, body),
    cancel: async (orderNumber) => {
      await fortnoxPut(`/orders/${encodeURIComponent(orderNumber)}/cancel`);
    },
    findExisting: async (reference) => {
      const found = await fortnoxGet<FortnoxOrderList>('/orders', { externalinvoicereference1: reference });
      return pickStoreOrderFortnoxMatch(found.Orders ?? [], reference);
    },
    // Hela registret för numren, också inaktiva: namnet och enheten gäller ändå raden.
    articles: async (numbers) => {
      const { data, error } = await admin.from('fortnox_articles_cache').select('article_number, description, unit').in('article_number', numbers);
      if (error) throw new Error(`Artikelregistret gick inte att läsa: ${error.message}`);
      return (data ?? []) as StoreOrderRegisterArticle[];
    },
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

/**
 * En ny titt om 5 min, med ett fönster som räcker för den: har fönstret gått ut (eller finns inget) börjar ett nytt på
 * 24 h, som planPortalFortnoxRetry gör. Annars hade cron gett upp tittens försök direkt (planerat efter fönstret), och
 * en order som skapats men inte kopplats aldrig tagits över.
 */
function revisitColumns(row: Pick<PushRow, 'fortnox_retry_until'>, now: Date) {
  const next = new Date(now.getTime() + PORTAL_FORTNOX_SAFETY_NET_MS).toISOString();
  const open = row.fortnox_retry_until && new Date(row.fortnox_retry_until).getTime() > now.getTime() + PORTAL_FORTNOX_SAFETY_NET_MS;
  if (open) return { fortnox_next_attempt_at: next };
  // Ett nytt fönster räknar från noll, som jobbens regel: annars kom nästa försök efter en timme i stället för 5 min.
  return {
    fortnox_next_attempt_at: next,
    fortnox_retry_until: new Date(now.getTime() + PORTAL_FORTNOX_RETRY_WINDOW_MS).toISOString(),
    fortnox_attempts: 0,
  };
}

/** Utfallet och omförsöken på raden, och claimen släppt. */
async function finishPush(
  admin: SupabaseClient,
  row: Pick<PushRow, 'id' | 'fortnox_attempts' | 'fortnox_retry_until'>,
  outcome: PortalFortnoxOutcome,
  values: Record<string, unknown>,
  now: Date,
  /**
   * Ett misslyckande bokförs bara på en beställning som fortfarande saknar nummer: ett långsamt försök (claimen blev
   * gammal) hade annars skrivit sitt fel och sin plan över ett annat försöks lyckade order.
   */
  options: { withoutNumber?: boolean } = {},
): Promise<boolean> {
  const plan = planPortalFortnoxRetry({ outcome, attempts: row.fortnox_attempts ?? 0, retryUntil: row.fortnox_retry_until, now });
  const update = admin.from('crm_store_orders').update({ ...values, ...plan }).eq('id', row.id);
  const saved = await (options.withoutNumber ? update.is('fortnox_order_number', null) : update).select('id');
  if (saved.error) throw new Error(`Fortnox-försöket kunde inte bokföras: ${saved.error.message}`);
  const written = (saved.data ?? []).length > 0;
  if (written && outcome === 'failed' && plan.fortnox_next_attempt_at === null) {
    console.warn('[portal-store-orders] Fortnox-försöken ges upp; bara för hand nu', { id: row.id, attempts: plan.fortnox_attempts });
  }
  return written;
}

/** Ett annat försök hann spara sitt nummer: den här pushens fel gäller inte längre, ordern finns. */
async function numberSavedMeanwhile(admin: SupabaseClient, id: string): Promise<StoreOrderPushResult | null> {
  const current = await readPushRow(admin, id);
  return current?.fortnox_order_number ? { outcome: 'exists', fortnoxOrderNumber: current.fortnox_order_number, error: null } : null;
}

/**
 * Omförsök bara efter ett tekniskt fel (jobbens regel, fas 4b): Fortnox nere eller inte anslutet, behörigheten, en
 * tidsgräns (429), nätet. Ett 400 är Fortnox besked om själva ordern (en artikel som saknas, ett fält som inte godtas)
 * och kommer igen likadant: det kräver en människa, som rättar och trycker Skicka till Fortnox.
 */
export function storeOrderFortnoxFailure(e: unknown): 'failed' | 'blocked' {
  return e instanceof FortnoxApiError && e.status === 400 ? 'blocked' : 'failed';
}

/**
 * Skapar Fortnox-ordern för en bekräftad beställning, en gång. Claimen (samma som arbetsordern) hindrar två samtidiga
 * försök, och numret sparas direkt efter POST:en: /orders har ingen dubblettspärr hos Fortnox, så ett nummer som inte
 * sparats hade gett en order till vid nästa försök. Kastar bara när databasen inte svarar.
 */
export async function pushStoreOrderToFortnox(
  admin: SupabaseClient,
  id: string,
  deps: StoreOrderFortnoxDeps = storeOrderFortnoxDeps(admin),
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
    // Bara om statusen står kvar: en bekräftelse som kommer i samma stund har satt sitt skyddsnät, som inte får nollas.
    const plan = planPortalFortnoxRetry({ outcome: 'skipped', attempts: first.fortnox_attempts ?? 0, retryUntil: first.fortnox_retry_until, now: deps.now() });
    const closed = await admin.from('crm_store_orders').update(plan).eq('id', id).eq('status', first.status);
    if (closed.error) throw new Error(`Fortnox-försöket kunde inte bokföras: ${closed.error.message}`);
    return { outcome: 'skipped', fortnoxOrderNumber: null, error: null };
  }

  if (!(await claimFortnoxPush(admin, 'crm_store_orders', id, 'fortnox_order_sync_status', 'fortnox_order_claimed_at'))) {
    // Den som har claimen bokför sitt eget utfall. Här bara en ny titt om 5 min, och bara om inget är planerat och ingen
    // order finns: räknaren och ett planerat försök är den andras.
    const revisit = await admin
      .from('crm_store_orders')
      .update(revisitColumns(first, deps.now()))
      .eq('id', id)
      .is('fortnox_next_attempt_at', null)
      .is('fortnox_order_number', null);
    if (revisit.error) throw new Error(`Fortnox-försöket kunde inte bokföras: ${revisit.error.message}`);
    return { outcome: 'in_progress', fortnoxOrderNumber: null, error: null };
  }

  try {
    // Skyddsnätet, också för "Skicka till Fortnox" när inget är planerat: dör processen efter POST:en tar cron över
    // ordern på märkningen om 5 min. Utfallet sätter planen efteråt.
    const net = await admin
      .from('crm_store_orders')
      .update(revisitColumns(first, deps.now()))
      .eq('id', id)
      .is('fortnox_next_attempt_at', null);
    if (net.error) throw new Error(`Skyddsnätet kunde inte sättas: ${net.error.message}`);
    return await pushWithClaim(admin, id, deps);
  } catch (e) {
    // Ett fel som inte bokförts (databasen): claimen släpps, annars svarar knappen "skapas redan" i två minuter.
    await admin
      .from('crm_store_orders')
      .update({ fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null })
      .eq('id', id)
      .eq('fortnox_order_sync_status', 'pending')
      .then(
        (r) => r.error && console.error('[portal-store-orders] claimen kunde inte släppas', { id, error: r.error.message }),
        (err: unknown) => console.error('[portal-store-orders] claimen kunde inte släppas', { id, error: err instanceof Error ? err.message : String(err) }),
      );
    throw e;
  }
}

/** Resten av pushen, med claimen tagen. Kastar bara när databasen inte svarar; anroparen släpper då claimen. */
async function pushWithClaim(admin: SupabaseClient, id: string, deps: StoreOrderFortnoxDeps): Promise<StoreOrderPushResult> {
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
    const written = await finishPush(admin, row, 'blocked', { fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null, fortnox_error: error }, deps.now(), { withoutNumber: true });
    if (!written) return (await numberSavedMeanwhile(admin, id)) ?? { outcome: 'blocked', fortnoxOrderNumber: null, error };
    return { outcome: 'blocked', fortnoxOrderNumber: null, error };
  }

  const reference = storeOrderFortnoxReference(row.id);
  let number: string;
  let adopted = false;
  try {
    // En order som redan finns tas över: ett försök som dog efter POST:en, ett nummer som inte gick att spara, eller ett
    // svar utan nummer. Utan sökningen hade nästa försök skapat en order till.
    // En sökning som inte går är alltid ett tekniskt fel (nytt försök), också ett 4xx: utan svaret vet vi inte om ordern
    // redan finns, och det rättar ingen människa.
    const existing = await deps.findExisting(reference).catch((err: unknown) => {
      // Ett 4xx på sökningen hade annars kunnat klassas som ett stopp; "inte ansluten" och 5xx behåller sin egen klass och
      // text.
      if (err instanceof FortnoxApiError && err.status >= 400 && err.status < 500) {
        throw new Error(`Sökningen efter en befintlig order gick inte: ${err.message}`);
      }
      throw err;
    });
    if (existing) {
      console.warn('[portal-store-orders] Fortnox-ordern fanns redan; den tas över', { id, fortnoxOrderNumber: existing });
      number = existing;
      adopted = true;
    } else {
      const numbers = [...new Set([...row.payload.lines.map((l) => l.articleNumber), STORE_ORDER_FREIGHT_ARTICLE])];
      const register = new Map((await deps.articles(numbers)).map((a) => [a.article_number, a]));
      const body = buildStoreOrderFortnoxOrder({
        reference,
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
    }
  } catch (e) {
    const outcome = storeOrderFortnoxFailure(e);
    const error =
      e instanceof FortnoxNotConnectedError
        ? friendlyFortnoxMessage(e)
        : e instanceof FortnoxApiError
          ? `Fortnox svarade: ${friendlyFortnoxMessage(e)}`
          : // Vårt eget fel (databasen, registret, sökningen): texten stannar i loggen.
            'Fortnox-ordern kunde inte skapas just nu. Står felet kvar: tryck Skicka till Fortnox om en stund.';
    console.error('[portal-store-orders] Fortnox-ordern kunde inte skapas', { id, outcome, error: e instanceof Error ? e.message : String(e) });
    const written = await finishPush(
      admin,
      row,
      outcome,
      {
        fortnox_order_sync_status: e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed',
        fortnox_order_claimed_at: null,
        fortnox_error: error,
      },
      deps.now(),
      { withoutNumber: true },
    );
    // Ingen rad: ett annat försök hann skapa och spara ordern medan det här väntade. Då är det klart, inget fel.
    if (!written) return (await numberSavedMeanwhile(admin, id)) ?? { outcome, fortnoxOrderNumber: null, error };
    return { outcome, fortnoxOrderNumber: null, error };
  }

  // Numret direkt, i samma skrivning som utfallet: vakten skriver det en gång.
  try {
    await finishPush(
      admin,
      row,
      adopted ? 'exists' : 'created',
      { fortnox_order_number: number, fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null, fortnox_error: null },
      deps.now(),
    );
  } catch (e) {
    // 🧨 Ett annat försök kan ha sparat sitt nummer medan det här pågick: claimen räknas som gammal efter två minuter,
    // och ett anrop till Fortnox har ingen tidsgräns, så ett långsamt cron-försök och "Skicka till Fortnox" kan båda
    // ha skickat, innan någon av ordrarna fanns att söka fram. Vakten skriver numret en gång. Står ett annat nummer på
    // beställningen makuleras vår egen order, så att bara en finns kvar.
    const current = await readPushRow(admin, id).catch(() => null);
    // Ett annat försök tog över just vår order (sökningen) och sparade den: allt är kopplat.
    if (current?.fortnox_order_number === number) return { outcome: 'created', fortnoxOrderNumber: number, error: null };
    if (current?.fortnox_order_number && current.fortnox_order_number !== number) {
      try {
        await deps.cancel(number);
        console.warn('[portal-store-orders] 🧨 två försök skickade samtidigt; vår order makulerades', { id, kept: current.fortnox_order_number, cancelled: number });
      } catch (cancelError) {
        console.error('[portal-store-orders] 🧨 två Fortnox-ordrar för samma beställning; den extra kunde inte makuleras', {
          id,
          kept: current.fortnox_order_number,
          extra: number,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        });
      }
      return { outcome: 'exists', fortnoxOrderNumber: current.fortnox_order_number, error: null };
    }
    // Ordern finns i Fortnox men inte hos oss. Nästa försök hittar den på märkningen och tar över den, i stället för
    // att skapa en till; numret står i loggen och i svaret. Ett försök planeras om det går (databasen kan vara nere).
    console.error('[portal-store-orders] 🧨 Fortnox-ordern skapades men numret sparades inte', {
      id,
      fortnoxOrderNumber: number,
      error: e instanceof Error ? e.message : String(e),
    });
    // Claimen släpps också, så att knappen inte svarar "skapas redan" i två minuter, och numret står i felet på raden, så
    // att sidan visar det efter en omläsning (ingen ska lägga upp ordern för hand i Fortnox).
    const unsaved = `Fortnox-order ${number} skapades, men numret kunde inte sparas här. Tryck Skicka till Fortnox om några minuter, så kopplas den; ingen ny order skapas.`;
    const revisit = await admin
      .from('crm_store_orders')
      .update({ ...revisitColumns(row, deps.now()), fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null, fortnox_error: unsaved })
      .eq('id', id)
      .is('fortnox_order_number', null)
      .then((r) => r, (err: unknown) => ({ error: { message: err instanceof Error ? err.message : String(err) } }));
    if (revisit.error) console.error('[portal-store-orders] nytt försök kunde inte planeras', { id, error: revisit.error.message });
    // `failed`, inte `blocked`: ett nytt försök är planerat och tar över ordern, ingen människa behövs.
    return { outcome: 'failed', fortnoxOrderNumber: number, error: unsaved };
  }
  return { outcome: adopted ? 'exists' : 'created', fortnoxOrderNumber: number, error: null };
}

// ------------------------------------------------------------------------------------------------------ bekräftelsen

export type ConfirmStoreOrderResult =
  | { kind: 'blocked'; reason: StoreOrderConfirmBlocker }
  | { kind: 'not_found' }
  | { kind: 'confirmed'; push: StoreOrderPushResult };

async function readConfirmRow(admin: SupabaseClient, id: string): Promise<StoreOrderConfirmRow | null> {
  const { data, error } = await admin
    .from('crm_store_orders')
    .select('status, store_version, freight_mode, freight_set_at, customer_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as StoreOrderConfirmRow | null) ?? null;
}

/**
 * Bekräftar beställningen som säljaren såg den och skapar Fortnox-ordern. Låsningen är en villkorad UPDATE: mottagen,
 * samma version, samma frakt (sparad när) och samma kund. Hann butiken ändra eller dra tillbaka, eller någon annan byta
 * frakt, kund eller bekräfta, ändras ingenting och svaret säger varför. Skyddsnätet (ett försök om 5 min) sätts i samma
 * skrivning, så att en process som dör före Fortnox-anropet ändå ger en order.
 */
export async function confirmStoreOrder(
  admin: SupabaseClient,
  input: { id: string; expected: StoreOrderConfirmExpected; actor: StoreOrderActor },
  deps: StoreOrderFortnoxDeps = storeOrderFortnoxDeps(admin),
): Promise<ConfirmStoreOrderResult> {
  const row = await readConfirmRow(admin, input.id);
  if (!row) return { kind: 'not_found' };
  const decision = decideStoreOrderConfirm(row, input.expected, await readPushCard(admin, row.customer_id));
  if (!decision.ok) return { kind: 'blocked', reason: decision.reason };

  const now = deps.now();
  const name = await readProfileName(admin, input.actor.id);
  const locked = await admin
    .from('crm_store_orders')
    .update({
      status: 'confirmed',
      confirmed_at: now.toISOString(),
      confirmed_by: input.actor.id,
      confirmed_by_name: name,
      confirmed_version: input.expected.version,
      fortnox_error: null,
      ...portalFortnoxSafetyNet(now),
    })
    .eq('id', input.id)
    .eq('status', 'received')
    .eq('store_version', input.expected.version)
    .eq('customer_id', input.expected.customerId)
    .eq('freight_set_at', row.freight_set_at as string)
    .not('freight_mode', 'is', null)
    .select('id');
  if (locked.error) throw new Error(`Beställningen kunde inte bekräftas: ${locked.error.message}`);
  if ((locked.data ?? []).length === 0) {
    // Något hann före. Beslutet tas om på raden som den står nu, så att svaret säger vad.
    const again = await readConfirmRow(admin, input.id);
    if (!again) return { kind: 'not_found' };
    const retry = decideStoreOrderConfirm(again, input.expected, await readPushCard(admin, again.customer_id));
    return { kind: 'blocked', reason: retry.ok ? 'changed' : retry.reason };
  }

  // Bekräftad här. Kastar Fortnox-försöket (databasen) är beställningen ändå bekräftad, och skyddsnätet gör om det.
  try {
    return { kind: 'confirmed', push: await pushStoreOrderToFortnox(admin, input.id, deps) };
  } catch (e) {
    console.error('[portal-store-orders] Fortnox-försöket efter bekräftelsen föll', { id: input.id, error: e instanceof Error ? e.message : String(e) });
    return {
      kind: 'confirmed',
      push: { outcome: 'failed', fortnoxOrderNumber: null, error: 'Fortnox-ordern kunde inte skapas just nu. Står felet kvar: tryck Skicka till Fortnox om en stund.' },
    };
  }
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
  const deps = options.deps ?? storeOrderFortnoxDeps(admin);
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
    // Ett försök som planerades inom fönstret görs, också när det plockas upp sent (ett per varv, andra före i kön), och
    // också när det är ett lån som tagits nära slutet (lånet ligger upp till tio minuter efter). Bara ett som planerats
    // längre bort än så ges upp.
    const expired =
      order.fortnox_retry_until !== null &&
      new Date(order.fortnox_next_attempt_at).getTime() > new Date(order.fortnox_retry_until).getTime() + PORTAL_FORTNOX_LEASE_MS;
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
    // Efter fönstret (ett lån som togs nära slutet): ett sista försök. Faller det öppnar planen ett nytt fönster (som för
    // ett nytt fel dagar senare), men här är det samma fel, och omförsöken ska ta slut efter 24 h.
    const late = order.fortnox_retry_until !== null && at.getTime() > new Date(order.fortnox_retry_until).getTime();
    try {
      const result = await pushStoreOrderToFortnox(admin, order.id, deps);
      // Ett försök räknas bara när något gjordes mot Fortnox; en makulerad eller en som någon annan håller hoppas över.
      if (result.outcome === 'skipped' || result.outcome === 'in_progress') summary.skipped += 1;
      else summary.attempted += 1;
      // Men inte när ordern skapades och bara numret inte kunde sparas: då behövs försöket som tar över den.
      if (late && result.outcome === 'failed' && result.fortnoxOrderNumber === null) {
        const done = await admin
          .from('crm_store_orders')
          .update({ fortnox_next_attempt_at: null, fortnox_retry_until: order.fortnox_retry_until })
          .eq('id', order.id)
          .is('fortnox_order_number', null);
        if (done.error) throw new Error(`Omförsöken kunde inte avslutas: ${done.error.message}`);
        summary.gaveUp += 1;
        console.warn('[portal-store-orders] Fortnox-försöken ges upp; bara för hand nu', { id: order.id });
      }
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-store-orders] Fortnox-försöket föll', { id: order.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
