import type { SupabaseClient } from '@supabase/supabase-js';
import { FortnoxNotConnectedError, fortnoxPut } from '@/lib/domains/fortnox/client';
import { claimFortnoxPush } from '@/lib/domains/fortnox/helpers';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { planPortalFortnoxRetry } from './jobFortnoxRetry';
import { errorText, settle } from './settle';
import {
  cancelFortnoxOrder,
  readStoreOrderFortnoxOrder,
  searchStoreOrderFortnoxOrders,
  type StoreOrderActor,
  type StoreOrderFortnoxOrderState,
} from './storeOrderActions';
import { fortnoxInvoiceReference, pickStoreOrderFortnoxMatches, storeOrderFortnoxReference } from './storeOrderFortnox';
import { isStoreOrderDeliveredOnAllowed, storeOrderCanBeCancelled, storeOrderDeliveredOnBounds, type StoreOrderStatus } from './storeOrders';
import { readProfileName } from './storeOrdersStore';

/**
 * Ekovillas steg efter bekräftelsen (RESELLER_PORTAL_CRM_PLAN.md fas 8b2): Levererad, Fakturera och Makulera.
 *
 * Besluten (William 2026-09-29):
 *   - Levererad: en knapp med datum (svensk dag), bara när Fortnox-ordern finns. Varorna har kommit fram, så dagen
 *     ligger mellan dagen beställningen kom in och i dag. En Fortnox-order som makulerats för hand i Fortnox nekar
 *     Levererad: den hade inte gått att fakturera, och efter Levererad går beställningen inte att makulera.
 *   - Fakturera: `createinvoice` på Fortnox-ordern. En faktura som redan finns i Fortnox kopplas bara (InvoiceReference).
 *     Fakturan är ett utkast, som ekonomi bokför och skickar i Fortnox, som för arbetsordrarna.
 *   - Makulera: bara före Levererad, med ett skäl som butiken ser. Fortnox-ordern makuleras först.
 *
 * SERVICE-ROLLEN, som i ./storeOrderActions.ts: routerna frågar först, med sessionen, crm_store_order_can_manage().
 *
 * 🧨 CLAIMEN. Makulera får aldrig landa medan en push pågår: pushen hade skrivit numret på en makulerad beställning, och
 * Fortnox-ordern hade stått kvar. Makulera på en bekräftad beställning tar därför orderns claim (samma som pushen,
 * `fortnox_order_sync_status`), och svarar `busy` när en push håller den. Pushen sparar i sin tur sitt nummer bara på en
 * beställning som fortfarande är bekräftad, och makulerar annars sin egen order (storeOrderActions.ts): det täcker en
 * push vars claim blivit gammal (två minuter) medan dess POST fortfarande pågick. Levererad tar samma claim, kort och
 * utan Fortnox-anrop: annars kunde den landa mellan Makuleras makulering i Fortnox och dess skrivning här, och en
 * levererad beställning hade haft en makulerad Fortnox-order, som inte går att fakturera.
 * Fakturan har en egen claim (`fortnox_invoice_sync_status`), mot två samtidiga tryck.
 *
 * 🧨 STÄMPELN. Den delade claimen (`claimFortnoxPush`) säger inte vems den är, och en push vars claim blivit gammal
 * släpper den när den sparar sitt nummer, vems den än är. Stegen här läser därför claimens tid direkt efter att de tagit
 * den (`takeClaim`: ingen annan kan ta den förrän den är två minuter gammal), och släpper och skriver bara med den.
 * Makulera prövar i varje varv att claimen fortfarande är dess egen, och tar den igen annars.
 *
 * Fortnox svar, uppmätta i testbolaget 2026-09-29 (ordrar 71 och 72):
 *   - `createinvoice` svarar med ORDERN, med InvoiceReference satt, inte med fakturan. En ofakturerad order har
 *     InvoiceReference "0" (`fortnoxInvoiceReference`).
 *   - `createinvoice` igen: 400 2000496 "redan fakturerad". På en makulerad order: 400 2000397.
 *   - Makulera igen: 400 2001279 "Är redan makulerad". En fakturerad order: 400 2001383 "Är låst och kan inte makuleras".
 *   Koderna läses inte: efter ett nej läses ordern, och dess tillstånd avgör.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

const TABLE = 'crm_store_orders';

type ClaimColumns = readonly [status: string, claimedAt: string];
const ORDER_CLAIM: ClaimColumns = ['fortnox_order_sync_status', 'fortnox_order_claimed_at'];
const INVOICE_CLAIM: ClaimColumns = ['fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at'];

const claim = (admin: SupabaseClient, id: string, [status, claimedAt]: ClaimColumns) =>
  claimFortnoxPush(admin, TABLE, id, status, claimedAt);

/**
 * Tar claimen och läser dess stämpel (tiden den togs). null: någon annan håller den. Går stämpeln inte att läsa släpps
 * claimen, bara om den togs efter anropet (ingen annan kan ta den förrän om två minuter), till `dropValue`: synkläget som
 * det var. Steget görs då inte.
 */
async function takeClaim(admin: SupabaseClient, id: string, columns: ClaimColumns, dropValue: string): Promise<string | null> {
  const [status, claimedAt] = columns;
  // En millisekund före: claimen stämplas med samma klocka (claimFortnoxPush), och en stämpel i samma millisekund räknas.
  const since = new Date(Date.now() - 1).toISOString();
  if (!(await claim(admin, id, columns))) return null;
  const read = await settle(admin.from(TABLE).select(claimedAt).eq('id', id).maybeSingle());
  const stamp = (read.data as Record<string, unknown> | null)?.[claimedAt];
  if (!read.error && typeof stamp === 'string') return stamp;
  // Ingen stämpel: claimen hann släppas (en push vars claim blivit gammal släpper den när den sparar sitt nummer). Någon
  // annan har den kanske nu: upptagen, som när claimen inte gick att ta.
  if (!read.error) return null;
  const dropped = await settle(
    admin.from(TABLE).update({ [status]: dropValue, [claimedAt]: null }).eq('id', id).eq(status, 'pending').gt(claimedAt, since),
  );
  if (dropped.error) console.error('[portal-store-orders] claimen kunde inte släppas', { id, claim: status, error: dropped.error.message });
  throw new Error(`Claimen gick inte att läsa: ${read.error?.message ?? 'ingen stämpel'}`);
}

/** Släpper claimen, bara om den fortfarande är den egna (stämpeln). Ett fel loggas bara: den blir gammal efter två minuter. */
async function release(admin: SupabaseClient, id: string, [status, claimedAt]: ClaimColumns, stamp: string, value: string): Promise<void> {
  const released = await settle(admin.from(TABLE).update({ [status]: value, [claimedAt]: null }).eq('id', id).eq(claimedAt, stamp));
  if (released.error) console.error('[portal-store-orders] claimen kunde inte släppas', { id, claim: status, error: released.error.message });
}

// ------------------------------------------------------------------------------------------------------------ Fortnox

export type { StoreOrderFortnoxOrderState };

export type StoreOrderFulfilmentDeps = {
  /** GET /orders/{n}. Kastar när Fortnox inte svarar. */
  readOrder: (orderNumber: string) => Promise<StoreOrderFortnoxOrderState>;
  /** PUT /orders/{n}/cancel. */
  cancel: (orderNumber: string) => Promise<void>;
  /** PUT /orders/{n}/createinvoice: fakturans nummer ur svaret, eller null när svaret inte bär det. */
  createInvoice: (orderNumber: string) => Promise<string | null>;
  /** Ordrarna som bär märkningen och inte är makulerade. Kastar när Fortnox inte svarar. */
  findOpen: (reference: string) => Promise<string[]>;
  now: () => Date;
};

type FortnoxOrderResponse = {
  Order?: { Cancelled?: boolean | null; InvoiceReference?: string | number | null };
  Invoice?: { DocumentNumber?: string | number | null };
};

export function storeOrderFulfilmentDeps(): StoreOrderFulfilmentDeps {
  const path = (orderNumber: string) => `/orders/${encodeURIComponent(orderNumber)}`;
  return {
    readOrder: readStoreOrderFortnoxOrder,
    cancel: cancelFortnoxOrder,
    createInvoice: async (orderNumber) => {
      const response = await fortnoxPut<FortnoxOrderResponse>(`${path(orderNumber)}/createinvoice`);
      return fortnoxInvoiceReference(response.Order?.InvoiceReference) ?? fortnoxInvoiceReference(response.Invoice?.DocumentNumber);
    },
    findOpen: async (reference) => pickStoreOrderFortnoxMatches(await searchStoreOrderFortnoxOrders(reference), reference),
    now: () => new Date(),
  };
}

// ---------------------------------------------------------------------------------------------------------- Levererad

export type MarkStoreOrderDeliveredResult =
  | { kind: 'delivered' }
  | { kind: 'not_found' }
  /** Inte bekräftad (mottagen, tillbakadragen, makulerad), eller redan levererad. */
  | { kind: 'not_confirmed' }
  /** Fortnox-ordern finns inte än: butiken ska ha fått sitt ordernummer före leveransen. */
  | { kind: 'fortnox_order_missing' }
  | { kind: 'date_out_of_range'; min: string; max: string }
  /** Fortnox-ordern är makulerad i Fortnox (för hand). Ingenting sparat. */
  | { kind: 'fortnox_order_cancelled'; orderNumber: string }
  /** Ett annat steg arbetar mot Fortnox-ordern just nu (claimen): en makulering eller en push. Ingenting sparat. */
  | { kind: 'busy' };

type DeliverRow = { status: StoreOrderStatus; fortnox_order_number: string | null; received_at: string };

async function readDeliverRow(admin: SupabaseClient, id: string): Promise<DeliverRow | null> {
  const { data, error } = await admin.from(TABLE).select('status, fortnox_order_number, received_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as DeliverRow | null) ?? null;
}

function decideDeliver(row: DeliverRow | null, deliveredOn: string, now: Date): MarkStoreOrderDeliveredResult | null {
  if (!row) return { kind: 'not_found' };
  if (row.status !== 'confirmed') return { kind: 'not_confirmed' };
  if (!row.fortnox_order_number) return { kind: 'fortnox_order_missing' };
  const bounds = storeOrderDeliveredOnBounds(row.received_at, now);
  if (!isStoreOrderDeliveredOnAllowed(deliveredOn, bounds)) return { kind: 'date_out_of_range', ...bounds };
  return null;
}

/**
 * Levererad, med dagen (`YYYY-MM-DD`, svensk dag). En villkorad UPDATE: bekräftad och med Fortnox-order, med orderns
 * claim tagen, så att en makulering som pågår aldrig får en levererad beställning under sig. Med claimen läses också
 * Fortnox-ordern: en som makulerats i Fortnox nekar. Går inte att ångra (vakten släpper statusen bara framåt), och
 * butiken får den i 8b3. Kastar Fortnox fel (anslutningen, läsningen) och databasens.
 */
export async function markStoreOrderDelivered(
  admin: SupabaseClient,
  input: { id: string; deliveredOn: string; actor: StoreOrderActor },
  deps: Pick<StoreOrderFulfilmentDeps, 'readOrder' | 'now'> = storeOrderFulfilmentDeps(),
): Promise<MarkStoreOrderDeliveredResult> {
  const at = deps.now();
  const [first, name] = await Promise.all([readDeliverRow(admin, input.id), readProfileName(admin, input.actor.id)]);
  const blocked = decideDeliver(first, input.deliveredOn, at);
  if (blocked) return blocked;
  const orderNumber = (first as DeliverRow).fortnox_order_number as string;
  // Fortnox-ordern finns (bekräftad med nummer): synkad.
  const stamp = await takeClaim(admin, input.id, ORDER_CLAIM, 'synced');
  if (!stamp) return { kind: 'busy' };

  // Fortnox-ordern som den står, med claimen: ingen makulering här kan komma emellan.
  try {
    if ((await deps.readOrder(orderNumber)).cancelled) {
      await release(admin, input.id, ORDER_CLAIM, stamp, 'synced');
      return { kind: 'fortnox_order_cancelled', orderNumber };
    }
  } catch (e) {
    await release(admin, input.id, ORDER_CLAIM, stamp, 'synced');
    throw e;
  }

  // Statusen och dagen, och claimen släppt, i samma skrivning, och bara med den egna claimen.
  const saved = await settle(
    admin
      .from(TABLE)
      .update({
        status: 'delivered',
        delivered_on: input.deliveredOn,
        delivered_at: at.toISOString(),
        delivered_by: input.actor.id,
        delivered_by_name: name,
        fortnox_order_sync_status: 'synced',
        fortnox_order_claimed_at: null,
      })
      .eq('id', input.id)
      .eq('status', 'confirmed')
      .not('fortnox_order_number', 'is', null)
      .eq('fortnox_order_claimed_at', stamp)
      .select('id'),
  );
  if (!saved.error && (saved.data ?? []).length > 0) return { kind: 'delivered' };

  // Inte sparat: claimen släpps (Fortnox-ordern finns, alltså synkad), och svaret säger varför. Står beställningen kvar
  // som den var har claimen tappats till ett annat steg: busy.
  await release(admin, input.id, ORDER_CLAIM, stamp, 'synced');
  if (saved.error) throw new Error(`Leveransen kunde inte sparas: ${saved.error.message}`);
  return decideDeliver(await readDeliverRow(admin, input.id), input.deliveredOn, at) ?? { kind: 'busy' };
}

// ---------------------------------------------------------------------------------------------------------- Fakturera

export type InvoiceStoreOrderResult =
  /** `created` skapad nu, `adopted` fanns redan i Fortnox och kopplades, `already` redan fakturerad här. */
  | { kind: 'invoiced'; invoiceNumber: string; source: 'created' | 'adopted' | 'already' }
  | { kind: 'not_found' }
  /** Inte levererad (bekräftad, makulerad …). */
  | { kind: 'not_delivered' }
  /** Ett annat försök skapar fakturan just nu. */
  | { kind: 'busy' }
  /** Fortnox-ordern är makulerad i Fortnox, och en faktura kan inte skapas ur den. */
  | { kind: 'fortnox_order_cancelled'; orderNumber: string }
  /** Fakturan finns i Fortnox, men numret kunde inte sparas här. Nästa tryck kopplar den; ingen ny skapas. */
  | { kind: 'unsaved'; invoiceNumber: string };

type InvoiceRow = {
  status: StoreOrderStatus;
  fortnox_order_number: string | null;
  fortnox_invoice_number: string | null;
  fortnox_invoice_sync_status: string;
};

async function readInvoiceRow(admin: SupabaseClient, id: string): Promise<InvoiceRow | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select('status, fortnox_order_number, fortnox_invoice_number, fortnox_invoice_sync_status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as InvoiceRow | null) ?? null;
}

/** Ett svar utan att röra Fortnox: okänd, redan fakturerad, eller inte levererad. null = fakturan ska göras. */
function settledInvoice(row: InvoiceRow | null): InvoiceStoreOrderResult | null {
  if (!row) return { kind: 'not_found' };
  if (row.status === 'invoiced' && row.fortnox_invoice_number) return { kind: 'invoiced', invoiceNumber: row.fortnox_invoice_number, source: 'already' };
  if (row.status !== 'delivered' || !row.fortnox_order_number) return { kind: 'not_delivered' };
  return null;
}

type InvoiceOutcome = { kind: 'invoice'; number: string; source: 'created' | 'adopted' } | { kind: 'cancelled' };

/**
 * Fakturan ur Fortnox-ordern. Pekar ordern redan på en faktura kopplas den (ett tryck vars svar aldrig kom fram, eller en
 * faktura som gjorts för hand i Fortnox). Nekar Fortnox skapandet läses ordern igen: ett annat försök kan ha hunnit.
 */
async function createOrAdoptInvoice(orderNumber: string, deps: StoreOrderFulfilmentDeps): Promise<InvoiceOutcome> {
  const before = await deps.readOrder(orderNumber);
  if (before.invoiceNumber) return { kind: 'invoice', number: before.invoiceNumber, source: 'adopted' };
  if (before.cancelled) return { kind: 'cancelled' };
  let created: string | null;
  try {
    created = await deps.createInvoice(orderNumber);
  } catch (e) {
    const after = await deps.readOrder(orderNumber).catch(() => null);
    if (after?.invoiceNumber) return { kind: 'invoice', number: after.invoiceNumber, source: 'adopted' };
    throw e;
  }
  if (created) return { kind: 'invoice', number: created, source: 'created' };
  // Ett svar utan nummer: ordern säger vilken faktura den fick.
  const after = await deps.readOrder(orderNumber);
  if (after.invoiceNumber) return { kind: 'invoice', number: after.invoiceNumber, source: 'created' };
  throw new Error('Fortnox svarade utan fakturanummer.');
}

/**
 * Fakturera en levererad beställning: fakturan ur Fortnox-ordern (`createinvoice`), och beställningen fakturerad med
 * numret och dagen. Fakturans claim hindrar två samtidiga tryck, och Fortnox tar själv bara en faktura per order: ett
 * nummer som inte kunde sparas kopplas vid nästa tryck. Kastar Fortnox fel (anslutningen, ett nej) och databasens.
 */
export async function invoiceStoreOrder(
  admin: SupabaseClient,
  input: { id: string; actor: StoreOrderActor },
  deps: StoreOrderFulfilmentDeps = storeOrderFulfilmentDeps(),
): Promise<InvoiceStoreOrderResult> {
  const [first, name] = await Promise.all([readInvoiceRow(admin, input.id), readProfileName(admin, input.actor.id)]);
  const settled = settledInvoice(first);
  if (settled) return settled;
  // Synkläget som det var, om claimen måste släppas utan att något gjorts (en gammal claim räknas som ett fel).
  const before = (first as InvoiceRow).fortnox_invoice_sync_status;
  const stamp = await takeClaim(admin, input.id, INVOICE_CLAIM, before === 'pending' ? 'failed' : before);
  if (!stamp) return { kind: 'busy' };

  let invoice: { number: string; source: 'created' | 'adopted' };
  try {
    // Raden med claimen: ett försök som hann före kan ha fakturerat.
    const row = await readInvoiceRow(admin, input.id);
    const again = settledInvoice(row);
    if (again) {
      await release(admin, input.id, INVOICE_CLAIM, stamp, row?.fortnox_invoice_number ? 'synced' : 'not_synced');
      return again;
    }
    const orderNumber = (row as InvoiceRow).fortnox_order_number as string;
    const outcome = await createOrAdoptInvoice(orderNumber, deps);
    if (outcome.kind === 'cancelled') {
      await release(admin, input.id, INVOICE_CLAIM, stamp, 'not_synced');
      return { kind: 'fortnox_order_cancelled', orderNumber };
    }
    invoice = outcome;
  } catch (e) {
    await release(admin, input.id, INVOICE_CLAIM, stamp, e instanceof FortnoxNotConnectedError ? 'not_synced' : 'failed');
    throw e;
  }

  const at = deps.now();
  const saved = await settle(
    admin
      .from(TABLE)
      .update({
        status: 'invoiced',
        fortnox_invoice_number: invoice.number,
        fortnox_invoice_sync_status: 'synced',
        fortnox_invoice_claimed_at: null,
        invoiced_on: stockholmTodayISO(at),
        invoiced_at: at.toISOString(),
        invoiced_by: input.actor.id,
        invoiced_by_name: name,
      })
      .eq('id', input.id)
      // Utan stämpeln: har ett annat försök tagit över claimen (den blev gammal) är fakturan ändå samma, eftersom Fortnox ger
      // ordern bara en, och det andra försöket kopplar den.
      .eq('status', 'delivered')
      .select('id'),
  );
  if (!saved.error && (saved.data ?? []).length > 0) return { kind: 'invoiced', invoiceNumber: invoice.number, source: invoice.source };

  // Inte sparat. Ett annat försök (claimen blev gammal) kan ha sparat samma faktura: Fortnox ger ordern bara en.
  const current = await readInvoiceRow(admin, input.id).catch(() => null);
  if (current?.status === 'invoiced' && current.fortnox_invoice_number === invoice.number) {
    return { kind: 'invoiced', invoiceNumber: invoice.number, source: invoice.source };
  }
  console.error('[portal-store-orders] 🧨 fakturan skapades i Fortnox men numret sparades inte', {
    id: input.id,
    fortnoxInvoiceNumber: invoice.number,
    error: saved.error?.message ?? 'ingen rad',
  });
  await release(admin, input.id, INVOICE_CLAIM, stamp, 'failed');
  return { kind: 'unsaved', invoiceNumber: invoice.number };
}

// ----------------------------------------------------------------------------------------------------------- Makulera

export type CancelStoreOrderResult =
  /** Makulerad. `fortnoxOrderNumbers`: de Fortnox-ordrar som makulerades (eller redan var det). */
  | { kind: 'cancelled'; fortnoxOrderNumbers: string[] }
  | { kind: 'not_found' }
  /** Levererad, fakturerad, tillbakadragen eller redan makulerad. */
  | { kind: 'not_cancellable' }
  /** Inte längre som säljaren såg den: butiken ändrade den, eller någon bekräftade den. Ingenting gjort. */
  | { kind: 'changed' }
  /** En push håller orderns claim: Fortnox-ordern kan vara på väg. Ingenting gjort; försök igen om en stund. */
  | { kind: 'busy' }
  /** Fortnox-ordern är redan fakturerad i Fortnox och kan inte makuleras. Ingenting gjort. */
  | { kind: 'fortnox_order_invoiced'; orderNumber: string; invoiceNumber: string };

/** Det säljaren såg när hen tryckte: statusen och butikens version. */
export type StoreOrderCancelExpected = { status: StoreOrderStatus; version: number };

type CancelRow = {
  status: StoreOrderStatus;
  store_version: number;
  fortnox_order_number: string | null;
  fortnox_order_sync_status: string;
  fortnox_order_claimed_at: string | null;
};

async function readCancelRow(admin: SupabaseClient, id: string): Promise<CancelRow | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select('status, store_version, fortnox_order_number, fortnox_order_sync_status, fortnox_order_claimed_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as CancelRow | null) ?? null;
}

function decideCancel(row: CancelRow | null, expected: StoreOrderCancelExpected): CancelStoreOrderResult | null {
  if (!row) return { kind: 'not_found' };
  if (!storeOrderCanBeCancelled(row.status)) return { kind: 'not_cancellable' };
  if (row.status !== expected.status || row.store_version !== expected.version) return { kind: 'changed' };
  return null;
}

/**
 * Makulerar en Fortnox-order. En order som redan är makulerad räknas som klar; en som är fakturerad går inte, och det
 * sägs. Nekar Fortnox av något annat skäl kastas nejet.
 */
async function cancelInFortnox(orderNumber: string, deps: StoreOrderFulfilmentDeps): Promise<CancelStoreOrderResult | null> {
  try {
    await deps.cancel(orderNumber);
    return null;
  } catch (e) {
    const state = await deps.readOrder(orderNumber).catch(() => null);
    if (state?.cancelled) return null;
    if (state?.invoiceNumber) return { kind: 'fortnox_order_invoiced', orderNumber, invoiceNumber: state.invoiceNumber };
    throw e;
  }
}

/**
 * Makulera, med skälet till butiken, bara före Levererad och som säljaren såg beställningen (statusen och versionen).
 *
 *   mottagen    ingen Fortnox-order kan finnas (pushen görs bara på en bekräftad). En villkorad UPDATE: Bekräfta kräver
 *               också "mottagen", så bara en av dem går igenom.
 *   bekräftad   orderns claim först. Sedan, med claimen: numret kopplas (en order som sökningen hittade, om raden
 *               saknade nummer) och omförsöken stängs; Fortnox-ordrarna makuleras (numret och varje order som bär
 *               märkningen); sist beställningen, bara om den står som den lästes med claimen.
 *
 * Kastar Fortnox fel (anslutningen, sökningen, ett nej) och databasens; ingenting är då makulerat här.
 */
export async function cancelStoreOrder(
  admin: SupabaseClient,
  input: { id: string; reason: string; expected: StoreOrderCancelExpected; actor: StoreOrderActor },
  deps: StoreOrderFulfilmentDeps = storeOrderFulfilmentDeps(),
): Promise<CancelStoreOrderResult> {
  const [first, name] = await Promise.all([readCancelRow(admin, input.id), readProfileName(admin, input.actor.id)]);
  const blocked = decideCancel(first, input.expected);
  if (blocked) return blocked;
  const at = deps.now();
  const cancelled = {
    status: 'cancelled',
    cancelled_at: at.toISOString(),
    cancelled_by: input.actor.id,
    cancelled_by_name: name,
    cancel_reason: input.reason,
  };

  if ((first as CancelRow).status === 'received') {
    const saved = await admin
      .from(TABLE)
      .update(cancelled)
      .eq('id', input.id)
      .eq('status', 'received')
      .eq('store_version', input.expected.version)
      .select('id');
    if (saved.error) throw new Error(`Beställningen kunde inte makuleras: ${saved.error.message}`);
    if ((saved.data ?? []).length > 0) return { kind: 'cancelled', fortnoxOrderNumbers: [] };
    return decideCancel(await readCancelRow(admin, input.id), input.expected) ?? { kind: 'changed' };
  }

  // Synkläget som det var före claimen, när ingenting ändrades: en order som finns är synkad, annars det som stod.
  const before = (first as CancelRow).fortnox_order_sync_status;
  const restore = (current: CancelRow | null) =>
    current?.fortnox_order_number ? 'synced' : before === 'pending' || before === 'synced' ? 'failed' : before;
  let stamp = await takeClaim(admin, input.id, ORDER_CLAIM, restore(first));
  if (!stamp) return { kind: 'busy' };
  const done: string[] = [];
  // Fortnox-ordrar som makulerats men beställningen står kvar: bara möjligt när ett annat steg fått claimen emellan.
  const warnPartial = (status: StoreOrderStatus | null, why: string) => {
    if (done.length === 0) return;
    console.error(`[portal-store-orders] 🧨 Fortnox-ordern makulerades, men beställningen ${why}`, { id: input.id, cancelled: done, status });
  };
  let row: CancelRow | null = null;
  // Numret som förberedelsen kopplade i det här anropet: synkläget följer det, också om något efter det faller.
  let linkedHere: string | null = null;
  try {
    // Ett varv till bara om en push vars claim blivit gammal hann spara ett nummer efter sökningen: det makuleras då.
    for (let turn = 0; turn < 2; turn += 1) {
      row = await readCancelRow(admin, input.id);
      // Claimen kan ha släppts under oss: en push vars claim blivit gammal släpper den när den sparar sitt nummer. Den
      // tas igen, så att ingen Levererad landar medan Fortnox-ordern makuleras. Håller någon annan den nu: busy.
      if (row && row.fortnox_order_claimed_at !== stamp) {
        stamp = await takeClaim(admin, input.id, ORDER_CLAIM, restore(row));
        if (!stamp) {
          warnPartial(row.status, 'hann tas av ett annat steg');
          return { kind: 'busy' };
        }
        row = await readCancelRow(admin, input.id);
      }
      const again = decideCancel(row, input.expected);
      if (again) {
        await release(admin, input.id, ORDER_CLAIM, stamp, restore(row));
        warnPartial(row?.status ?? null, 'hann ändras här');
        return again;
      }
      const current = row as CancelRow;
      // Numret på raden och varje order som bär märkningen: en push som dog efter POST:en, ett nummer som inte gick att
      // spara, eller två försök som båda skickade. Går sökningen inte görs ingenting, eftersom vi då inte vet vilka som finns.
      const found = await deps.findOpen(storeOrderFortnoxReference(input.id));
      const numbers = [...new Set([...(current.fortnox_order_number ? [current.fortnox_order_number] : []), ...found])];
      const linked = current.fortnox_order_number ?? numbers[0] ?? null;

      // Varje order läses först: en som är fakturerad i Fortnox kan inte makuleras, och då ska ingen av dem makuleras och
      // ingenting kopplas (beställningen hade annars pekat på en makulerad order och en fakturerad utan koppling). En som
      // redan är makulerad (för hand, eller i ett tidigare varv) behöver ingen makulering.
      const open: string[] = [];
      for (const orderNumber of numbers) {
        if (done.includes(orderNumber)) continue;
        const state = await deps.readOrder(orderNumber);
        if (state.invoiceNumber) {
          await release(admin, input.id, ORDER_CLAIM, stamp, restore(current));
          warnPartial(current.status, 'makulerades inte: en annan order är fakturerad');
          return { kind: 'fortnox_order_invoiced', orderNumber, invoiceNumber: state.invoiceNumber };
        }
        if (state.cancelled) done.push(orderNumber);
        else open.push(orderNumber);
      }

      // 🧨 Före Fortnox, med claimen: numret kopplas om det saknades, och omförsöken stängs. Dör makuleringen efter det
      // skapar ingen push en ny order för en beställning som skulle makuleras (pushen ser numret, eller inget planerat),
      // och Levererad nekar en order som hunnit makuleras i Fortnox; ett nytt tryck räknar den som klar.
      // Hittades ingen order makuleras ingenting i Fortnox före sista skrivningen: då finns inget att skydda, och omförsöken
      // står kvar tills beställningen är makulerad (kortet lovar dem).
      if (!current.fortnox_order_number && linked) {
        const prepared = await admin
          .from(TABLE)
          .update({ fortnox_order_number: linked, fortnox_next_attempt_at: null })
          .eq('id', input.id)
          .eq('status', 'confirmed')
          .is('fortnox_order_number', null)
          .eq('fortnox_order_claimed_at', stamp)
          .select('id');
        if (prepared.error) throw new Error(`Beställningen kunde inte förberedas för makuleringen: ${prepared.error.message}`);
        // Ingen rad: ett nummer kom under tiden (en push), eller claimen tappades. Nästa varv läser om.
        if ((prepared.data ?? []).length === 0) continue;
        linkedHere = linked;
      }

      for (const orderNumber of open) {
        const refused = await cancelInFortnox(orderNumber, deps);
        if (refused) {
          await release(admin, input.id, ORDER_CLAIM, stamp, linked ? 'synced' : restore(current));
          warnPartial(current.status, 'makulerades inte: en annan order nekades');
          return refused;
        }
        if (!done.includes(orderNumber)) done.push(orderNumber);
      }

      const base = admin
        .from(TABLE)
        .update({
          ...cancelled,
          fortnox_order_sync_status: linked ? 'synced' : 'not_synced',
          fortnox_order_claimed_at: null,
          // Omförsöken stängs: cron hade annars tagit den igen (och hoppat över den). Utom när makuleringen tog över en
          // push vars claim blivit gammal: dess POST kan fortfarande vara på väg, så ett svep planeras (storeOrderActions).
          ...(before === 'pending'
            ? planPortalFortnoxRetry({ outcome: 'failed', attempts: 0, retryUntil: null, now: deps.now() })
            : { fortnox_next_attempt_at: null }),
        })
        .eq('id', input.id)
        .eq('status', 'confirmed')
        .eq('fortnox_order_claimed_at', stamp);
      const saved = await (linked ? base.eq('fortnox_order_number', linked) : base.is('fortnox_order_number', null)).select('id');
      if (saved.error) throw new Error(`Beställningen kunde inte makuleras: ${saved.error.message}`);
      if ((saved.data ?? []).length > 0) return { kind: 'cancelled', fortnoxOrderNumbers: done };
    }
    throw new Error('Beställningen ändrades medan den makulerades.');
  } catch (e) {
    if (stamp) await release(admin, input.id, ORDER_CLAIM, stamp, linkedHere ? 'synced' : restore(row));
    warnPartial(row?.status ?? null, `kunde inte makuleras här: ${errorText(e)}`);
    throw e;
  }
}
