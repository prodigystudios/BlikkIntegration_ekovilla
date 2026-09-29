import { describe, it, expect, vi } from 'vitest';
import {
  cancelStoreOrder,
  invoiceStoreOrder,
  markStoreOrderDelivered,
  type StoreOrderFortnoxOrderState,
  type StoreOrderFulfilmentDeps,
} from '@/lib/domains/portal/storeOrderFulfilment';
import { fortnoxInvoiceReference, pickStoreOrderFortnoxMatches, pickStoreOrderFortnoxMatch } from '@/lib/domains/portal/storeOrderFortnox';
import {
  isStoreOrderDeliveredOnAllowed,
  storeOrderCanBeCancelled,
  storeOrderDeliveredOnBounds,
  storeOrderHasStep,
  type StoreOrderStatus,
} from '@/lib/domains/portal/storeOrders';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Levererad, Fakturera och Makulera (fas 8b2). Det som skyddas:
 *   - varje steg bara i sitt läge, och som säljaren såg beställningen (makuleringen: statusen och versionen);
 *   - 🧨 Makulera landar aldrig medan en push pågår: orderns claim, och Fortnox-ordern makuleras FÖRST;
 *   - Levererad tar samma claim, så att den inte landar mitt i en makulering;
 *   - fakturan skapas en gång: fakturans claim, och en faktura som redan finns i Fortnox kopplas bara;
 *   - Fortnox "0" är ingen faktura (uppmätt).
 *
 * Fortnox spelas av `fakeFortnox`, med testbolagets svar (2026-09-29): createinvoice på en fakturerad order 400
 * "redan fakturerad", makulering av en fakturerad 400 "Är låst", en makulerad igen 400 "Är redan makulerad".
 */

const ID = '55555555-5555-4555-8555-555555555555';
const SELLER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-29T10:00:00.000Z');
const RECEIVED_AT = '2026-09-27T08:00:00.000Z';
const fresh = () => new Date().toISOString();
/** En annans färska claim: en annan stämpel än den stegen själva tar. */
const othersClaim = () => new Date(Date.now() + 5_000).toISOString();
const isUpdate = (call: { op: string; values?: unknown }, key: string, value: unknown) =>
  call.op === 'update' && (call.values as Record<string, unknown>)[key] === value;
const stale = () => new Date(Date.now() - 10 * 60_000).toISOString();

function storeOrder(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    order_id: CONTRACT_STORE_ORDER.orderId,
    order_number: CONTRACT_STORE_ORDER.orderNumber,
    status: 'confirmed',
    store_version: 2,
    received_at: RECEIVED_AT,
    fortnox_order_number: '58',
    fortnox_order_sync_status: 'synced',
    fortnox_order_claimed_at: null,
    fortnox_next_attempt_at: null,
    fortnox_invoice_number: null,
    fortnox_invoice_sync_status: 'not_synced',
    fortnox_invoice_claimed_at: null,
    delivered_on: null,
    invoiced_on: null,
    cancelled_at: null,
    cancel_reason: null,
    ...extra,
  };
}

function db(order: Record<string, unknown> = storeOrder(), options: Parameters<typeof memoryAdmin>[1] = {}) {
  return memoryAdmin({ crm_store_orders: [order], profiles: [{ id: SELLER, full_name: 'Anna Berg' }] }, options);
}

const row = (m: ReturnType<typeof memoryAdmin>) => m.tables.crm_store_orders[0];
const actor = { id: SELLER };

/** Fortnox testbolag i minnet: ordrarna, med testbolagets svar. `searchable` är det sökningen på märkningen hittar. */
function fakeFortnox(orders: Record<string, Partial<StoreOrderFortnoxOrderState>> = { '58': {} }, searchable: string[] = []) {
  const state: Record<string, StoreOrderFortnoxOrderState> = {};
  for (const [n, o] of Object.entries(orders)) state[n] = { cancelled: false, invoiceNumber: null, ...o };
  let nextInvoice = 23;
  const get = (n: string) => {
    const o = state[n];
    if (!o) throw new FortnoxApiError(404, `Fortnox GET /orders/${n} misslyckades (404)`);
    return o;
  };
  const deps = {
    readOrder: vi.fn(async (n: string) => ({ ...get(n) })),
    cancel: vi.fn(async (n: string) => {
      const o = get(n);
      if (o.cancelled) throw new FortnoxApiError(400, 'Är redan makulerad.', 2001279, 'Är redan makulerad.');
      if (o.invoiceNumber) throw new FortnoxApiError(400, 'Är låst och kan inte makuleras.', 2001383, 'Är låst och kan inte makuleras.');
      o.cancelled = true;
    }),
    createInvoice: vi.fn(async (n: string): Promise<string | null> => {
      const o = get(n);
      if (o.cancelled) throw new FortnoxApiError(400, `Ordernummer ${n} är makulerad och kan inte behandlas.`, 2000397);
      if (o.invoiceNumber) throw new FortnoxApiError(400, `Ordernummer ${n} är redan fakturerad och kan inte behandlas.`, 2000496);
      o.invoiceNumber = String(nextInvoice++);
      return o.invoiceNumber;
    }),
    findOpen: vi.fn(async (_reference: string) => searchable.filter((n) => !state[n]?.cancelled)),
    now: () => NOW,
  } satisfies StoreOrderFulfilmentDeps;
  return { deps, state };
}

// ------------------------------------------------------------------------------------------------------ rena delar

describe('fortnoxInvoiceReference', () => {
  it('🧨 "0" (en ofakturerad order, uppmätt) är ingen faktura; ett nummer är det', () => {
    for (const none of ['0', 0, '00', '', '  ', null, undefined, {}]) expect(fortnoxInvoiceReference(none)).toBeNull();
    expect(fortnoxInvoiceReference('23')).toBe('23');
    expect(fortnoxInvoiceReference(23)).toBe('23');
    expect(fortnoxInvoiceReference(' 230 ')).toBe('230');
  });
});

describe('pickStoreOrderFortnoxMatches', () => {
  it('varje order med exakt märkningen som inte är makulerad; början av värdet räcker inte', () => {
    const reference = `crm-store-order:${ID}`;
    const orders = [
      { DocumentNumber: 57, ExternalInvoiceReference1: reference },
      { DocumentNumber: 58, ExternalInvoiceReference1: `${reference}-x` },
      { DocumentNumber: 59, ExternalInvoiceReference1: reference, Cancelled: true },
      { DocumentNumber: 60, ExternalInvoiceReference1: ` ${reference} ` },
      { DocumentNumber: null, ExternalInvoiceReference1: reference },
    ];
    expect(pickStoreOrderFortnoxMatches(orders, reference)).toEqual(['57', '60']);
    expect(pickStoreOrderFortnoxMatch(orders, reference)).toBe('57');
    expect(pickStoreOrderFortnoxMatch([], reference)).toBeNull();
  });
});

describe('leveransdagens gränser', () => {
  it('från den svenska dagen beställningen kom in till och med den svenska dagen i dag', () => {
    // 22:30 UTC den 28:e är 00:30 den 29:e i Stockholm (sommartid).
    expect(storeOrderDeliveredOnBounds('2026-09-28T22:30:00.000Z', new Date('2026-10-01T21:59:00.000Z'))).toEqual({ min: '2026-09-29', max: '2026-10-01' });
    expect(storeOrderDeliveredOnBounds('2026-09-28T21:59:00.000Z', new Date('2026-10-01T22:00:00.000Z'))).toEqual({ min: '2026-09-28', max: '2026-10-02' });
  });

  it('gränserna räknas med', () => {
    const bounds = { min: '2026-09-27', max: '2026-09-29' };
    expect(['2026-09-27', '2026-09-28', '2026-09-29'].map((d) => isStoreOrderDeliveredOnAllowed(d, bounds))).toEqual([true, true, true]);
    expect(['2026-09-26', '2026-09-30', ''].map((d) => isStoreOrderDeliveredOnAllowed(d, bounds))).toEqual([false, false, false]);
  });
});

describe('stegen per läge', () => {
  it('ett steg på mottagen, bekräftad och levererad; makulera bara före Levererad', () => {
    const all: StoreOrderStatus[] = ['received', 'withdrawn', 'confirmed', 'delivered', 'invoiced', 'cancelled'];
    expect(all.filter((status) => storeOrderHasStep({ status }))).toEqual(['received', 'confirmed', 'delivered']);
    expect(all.filter(storeOrderCanBeCancelled)).toEqual(['received', 'confirmed']);
  });
});

// ---------------------------------------------------------------------------------------------------------- Levererad

describe('markStoreOrderDelivered', () => {
  const deliver = (m: ReturnType<typeof memoryAdmin>, deliveredOn = '2026-09-29') =>
    markStoreOrderDelivered(m.admin, { id: ID, deliveredOn, actor }, fakeFortnox().deps);

  it('bekräftad med Fortnox-order: levererad den dagen, med vem och när, och claimen släppt', async () => {
    const m = db();
    expect(await deliver(m, '2026-09-28')).toEqual({ kind: 'delivered' });
    expect(row(m)).toMatchObject({
      status: 'delivered',
      delivered_on: '2026-09-28',
      delivered_at: NOW.toISOString(),
      delivered_by: SELLER,
      delivered_by_name: 'Anna Berg',
      fortnox_order_sync_status: 'synced',
      fortnox_order_claimed_at: null,
    });
  });

  it('dagen: före dagen den kom in, eller efter i dag, nekas och ingenting sparas; gränserna går', async () => {
    const m = db();
    expect(await deliver(m, '2026-09-26')).toEqual({ kind: 'date_out_of_range', min: '2026-09-27', max: '2026-09-29' });
    expect(await deliver(m, '2026-09-30')).toEqual({ kind: 'date_out_of_range', min: '2026-09-27', max: '2026-09-29' });
    expect(row(m).status).toBe('confirmed');
    expect(await deliver(db(), '2026-09-27')).toEqual({ kind: 'delivered' });
    expect(await deliver(db(), '2026-09-29')).toEqual({ kind: 'delivered' });
  });

  it('bara en bekräftad med Fortnox-order; okänd not_found. Ingen claim tas och ingenting skrivs då', async () => {
    for (const status of ['received', 'delivered', 'invoiced', 'cancelled', 'withdrawn']) {
      const m = db(storeOrder({ status }));
      expect(await deliver(m)).toEqual({ kind: 'not_confirmed' });
      expect(row(m)).toMatchObject({ status, fortnox_order_sync_status: 'synced' });
      expect(m.calls.filter((c) => c.op === 'update')).toEqual([]);
    }
    const without = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }));
    expect(await deliver(without)).toEqual({ kind: 'fortnox_order_missing' });
    expect(row(without)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'failed' });
    expect(await markStoreOrderDelivered(db().admin, { id: '66666666-6666-4666-8666-666666666666', deliveredOn: '2026-09-29', actor }, fakeFortnox().deps)).toEqual({
      kind: 'not_found',
    });
  });

  it('🧨 en makulering eller en push håller claimen: busy, ingenting sparat och claimen den andras', async () => {
    const claimedAt = fresh();
    const m = db(storeOrder({ fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: claimedAt }));
    expect(await deliver(m)).toEqual({ kind: 'busy' });
    expect(row(m)).toMatchObject({ status: 'confirmed', delivered_on: null, fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: claimedAt });
  });

  it('🧨 Fortnox-ordern är makulerad i Fortnox (för hand): nekas, ingenting sparat, och claimen släpps', async () => {
    const m = db();
    const { deps } = fakeFortnox({ '58': { cancelled: true } });
    expect(await markStoreOrderDelivered(m.admin, { id: ID, deliveredOn: '2026-09-29', actor }, deps)).toEqual({ kind: 'fortnox_order_cancelled', orderNumber: '58' });
    expect(deps.readOrder).toHaveBeenCalledWith('58');
    expect(row(m)).toMatchObject({ status: 'confirmed', delivered_on: null, fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('en order som fakturerats för hand i Fortnox kan levereras (Fakturera kopplar fakturan sedan)', async () => {
    const { deps } = fakeFortnox({ '58': { invoiceNumber: '19' } });
    expect(await markStoreOrderDelivered(db().admin, { id: ID, deliveredOn: '2026-09-29', actor }, deps)).toEqual({ kind: 'delivered' });
  });

  it('Fortnox svarar inte: kastar, ingenting sparat, claimen släppt', async () => {
    const m = db();
    const { deps } = fakeFortnox();
    deps.readOrder.mockImplementationOnce(async () => {
      throw new FortnoxNotConnectedError();
    });
    await expect(markStoreOrderDelivered(m.admin, { id: ID, deliveredOn: '2026-09-29', actor }, deps)).rejects.toBeInstanceOf(FortnoxNotConnectedError);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('en claim som blivit gammal (en död process) spärrar inte för alltid', async () => {
    const m = db(storeOrder({ fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: stale() }));
    expect(await deliver(m)).toEqual({ kind: 'delivered' });
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('🧨 makulerad mellan läsningen och skrivningen: ingenting sparat, "not_confirmed"', async () => {
    const m = db(storeOrder(), {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && (call.values as Record<string, unknown>).status === 'delivered') {
          Object.assign(tables.crm_store_orders[0], { status: 'cancelled', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
        }
      },
    });
    expect(await deliver(m)).toEqual({ kind: 'not_confirmed' });
    expect(row(m)).toMatchObject({ status: 'cancelled', delivered_on: null, fortnox_order_sync_status: 'synced' });
  });

  it('🧨 claimen togs av ett annat steg mellan claimen och skrivningen: busy, och den andras claim står kvar', async () => {
    const other = othersClaim();
    const m = db(storeOrder(), {
      beforeExecute: (call, tables) => {
        if (isUpdate(call, 'status', 'delivered')) Object.assign(tables.crm_store_orders[0], { fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
      },
    });
    expect(await deliver(m)).toEqual({ kind: 'busy' });
    expect(row(m)).toMatchObject({ status: 'confirmed', delivered_on: null, fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
  });

  it('claimens stämpel går inte att läsa: kastar, ingenting sparat, och claimen släpps', async () => {
    let selects = 0;
    const m = db();
    // Första läsningen är raden, den andra stämpeln.
    m.failOn((c) => c.op === 'select' && c.table === 'crm_store_orders' && ++selects === 2, { message: 'nere' });
    await expect(deliver(m)).rejects.toThrow('Claimen gick inte att läsa');
    // Släppt till synkläget som det var: Fortnox-ordern finns.
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('statusen ändrades utan claimen (t.ex. för hand i databasen): ingenting sparat, "not_confirmed"', async () => {
    const m = db(storeOrder(), {
      beforeExecute: (call, tables) => {
        if (isUpdate(call, 'status', 'delivered')) tables.crm_store_orders[0].status = 'cancelled';
      },
    });
    expect(await deliver(m)).toEqual({ kind: 'not_confirmed' });
    expect(row(m)).toMatchObject({ status: 'cancelled', delivered_on: null });
  });

  it('en fråga som kastar (nätet) i stället för att svara med ett fel: samma väg, och claimen släpps', async () => {
    const m = db(storeOrder(), {
      beforeExecute: (call) => {
        if (isUpdate(call, 'status', 'delivered')) throw new Error('fetch failed');
      },
    });
    await expect(deliver(m)).rejects.toThrow('Leveransen kunde inte sparas: fetch failed');
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('databasen svarar inte på skrivningen: kastar, och claimen släpps', async () => {
    const m = db();
    m.failOn((c) => c.op === 'update' && (c.values as Record<string, unknown>).status === 'delivered', { message: 'nere' });
    await expect(deliver(m)).rejects.toThrow('Leveransen kunde inte sparas');
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });
});

// ---------------------------------------------------------------------------------------------------------- Fakturera

describe('invoiceStoreOrder', () => {
  const delivered = (extra: Record<string, unknown> = {}) => storeOrder({ status: 'delivered', delivered_on: '2026-09-28', ...extra });
  const invoice = (m: ReturnType<typeof memoryAdmin>, deps: StoreOrderFulfilmentDeps) => invoiceStoreOrder(m.admin, { id: ID, actor }, deps);

  it('levererad: fakturan skapas ur Fortnox-ordern, och beställningen fakturerad med numret, dagen och vem', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox();
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '23', source: 'created' });
    expect(deps.createInvoice).toHaveBeenCalledWith('58');
    expect(row(m)).toMatchObject({
      status: 'invoiced',
      fortnox_invoice_number: '23',
      fortnox_invoice_sync_status: 'synced',
      fortnox_invoice_claimed_at: null,
      invoiced_on: '2026-09-29',
      invoiced_at: NOW.toISOString(),
      invoiced_by: SELLER,
      invoiced_by_name: 'Anna Berg',
    });
  });

  it('dagen är den svenska: 23:30 UTC är nästa dag i Stockholm', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox();
    await invoice(m, { ...deps, now: () => new Date('2026-09-29T22:30:00.000Z') });
    expect(row(m).invoiced_on).toBe('2026-09-30');
  });

  it('🧨 en faktura som redan finns i Fortnox (gjord för hand, eller ett svar som aldrig kom fram) kopplas bara', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox({ '58': { invoiceNumber: '19' } });
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '19', source: 'adopted' });
    expect(deps.createInvoice).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'invoiced', fortnox_invoice_number: '19' });
  });

  it('🧨 Fortnox nekar createinvoice för att ett annat försök hann: ordern läses, och den fakturan kopplas', async () => {
    const m = db(delivered());
    const { deps, state } = fakeFortnox();
    // Läsningen före sa "ingen faktura"; sedan hann ett annat försök.
    deps.readOrder.mockImplementationOnce(async () => ({ cancelled: false, invoiceNumber: null }));
    state['58'].invoiceNumber = '31';
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '31', source: 'adopted' });
    expect(deps.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('svaret bär inget nummer: ordern säger vilken faktura den fick; inget där heller är ett fel', async () => {
    const m = db(delivered());
    const { deps, state } = fakeFortnox();
    deps.createInvoice.mockImplementationOnce(async () => ((state['58'].invoiceNumber = '40'), null));
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '40', source: 'created' });

    const none = db(delivered());
    const empty = fakeFortnox();
    empty.deps.createInvoice.mockImplementationOnce(async () => null);
    await expect(invoice(none, empty.deps)).rejects.toThrow('utan fakturanummer');
    expect(row(none)).toMatchObject({ status: 'delivered', fortnox_invoice_sync_status: 'failed', fortnox_invoice_claimed_at: null });
  });

  it('Fortnox nekar av ett annat skäl: kastar, ingenting sparat, claimen släppt som failed', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox();
    deps.createInvoice.mockImplementationOnce(async () => {
      throw new FortnoxApiError(503, 'Fortnox PUT misslyckades (503)');
    });
    await expect(invoice(m, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_invoice_number: null, fortnox_invoice_sync_status: 'failed', fortnox_invoice_claimed_at: null });
  });

  it('🧨 ett annat försök tog över fakturans claim (den blev gammal) medan Fortnox svarade: vårt fel släpper inte dess claim', async () => {
    const other = othersClaim();
    const m = db(delivered());
    const { deps } = fakeFortnox();
    deps.createInvoice.mockImplementationOnce(async () => {
      Object.assign(row(m), { fortnox_invoice_sync_status: 'pending', fortnox_invoice_claimed_at: other });
      throw new FortnoxApiError(503, 'Fortnox PUT misslyckades (503)');
    });
    await expect(invoice(m, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_invoice_sync_status: 'pending', fortnox_invoice_claimed_at: other });
  });

  it('Fortnox inte anslutet: kastar, claimen släppt som not_synced', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox();
    deps.readOrder.mockImplementationOnce(async () => {
      throw new FortnoxNotConnectedError();
    });
    await expect(invoice(m, deps)).rejects.toBeInstanceOf(FortnoxNotConnectedError);
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_invoice_sync_status: 'not_synced', fortnox_invoice_claimed_at: null });
  });

  it('Fortnox-ordern är makulerad i Fortnox: ingen faktura, och det sägs', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox({ '58': { cancelled: true } });
    expect(await invoice(m, deps)).toEqual({ kind: 'fortnox_order_cancelled', orderNumber: '58' });
    expect(deps.createInvoice).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_invoice_sync_status: 'not_synced', fortnox_invoice_claimed_at: null });
  });

  it('redan fakturerad här: numret, utan Fortnox; inte levererad eller okänd: ingenting görs', async () => {
    const { deps } = fakeFortnox();
    expect(await invoice(db(storeOrder({ status: 'invoiced', fortnox_invoice_number: '23' })), deps)).toEqual({
      kind: 'invoiced',
      invoiceNumber: '23',
      source: 'already',
    });
    for (const status of ['confirmed', 'received', 'cancelled']) {
      const m = db(storeOrder({ status }));
      expect(await invoice(m, deps)).toEqual({ kind: 'not_delivered' });
      expect(row(m).fortnox_invoice_sync_status).toBe('not_synced');
    }
    expect(await invoiceStoreOrder(db().admin, { id: '66666666-6666-4666-8666-666666666666', actor }, deps)).toEqual({ kind: 'not_found' });
    expect(deps.readOrder).not.toHaveBeenCalled();
    expect(deps.createInvoice).not.toHaveBeenCalled();
  });

  it('🧨 ett annat tryck skapar fakturan just nu (färsk claim): busy, och Fortnox anropas inte', async () => {
    const m = db(delivered({ fortnox_invoice_sync_status: 'pending', fortnox_invoice_claimed_at: fresh() }));
    const { deps } = fakeFortnox();
    expect(await invoice(m, deps)).toEqual({ kind: 'busy' });
    expect(deps.readOrder).not.toHaveBeenCalled();
    expect(row(m).status).toBe('delivered');
  });

  it('🧨 fakturerad av ett annat försök mellan första läsningen och claimen: numret, utan Fortnox', async () => {
    let reads = 0;
    const m = db(delivered(), {
      beforeExecute: (call, tables) => {
        if (call.op === 'select' && call.table === 'crm_store_orders' && ++reads === 2) {
          Object.assign(tables.crm_store_orders[0], { status: 'invoiced', fortnox_invoice_number: '23', invoiced_on: '2026-09-29' });
        }
      },
    });
    const { deps } = fakeFortnox();
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '23', source: 'already' });
    expect(deps.readOrder).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ fortnox_invoice_sync_status: 'synced', fortnox_invoice_claimed_at: null });
  });

  it('🧨 numret gick inte att spara: svaret säger det, och nästa tryck kopplar fakturan i stället för att skapa en till', async () => {
    const m = db(delivered());
    const { deps } = fakeFortnox();
    m.failOn((c) => c.op === 'update' && (c.values as Record<string, unknown>).status === 'invoiced', { message: 'nere' });
    expect(await invoice(m, deps)).toEqual({ kind: 'unsaved', invoiceNumber: '23' });
    expect(row(m)).toMatchObject({ status: 'delivered', fortnox_invoice_sync_status: 'failed', fortnox_invoice_claimed_at: null });

    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '23', source: 'adopted' });
    expect(deps.createInvoice).toHaveBeenCalledTimes(1);
    expect(row(m)).toMatchObject({ status: 'invoiced', fortnox_invoice_number: '23' });
  });

  it('ett annat försök tog över fakturans claim men har inte sparat än: vi sparar ändå (samma faktura, Fortnox ger bara en)', async () => {
    const other = othersClaim();
    const m = db(delivered());
    const { deps } = fakeFortnox();
    deps.createInvoice.mockImplementationOnce(async (n: string) => {
      Object.assign(row(m), { fortnox_invoice_sync_status: 'pending', fortnox_invoice_claimed_at: other });
      return (await fakeFortnox({ [n]: {} }).deps.createInvoice(n)) as string;
    });
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '23', source: 'created' });
    expect(row(m)).toMatchObject({ status: 'invoiced', fortnox_invoice_number: '23' });
  });

  it('ingen rad skrevs för att ett annat försök hann spara samma faktura: klart, och den andras bokföring står kvar', async () => {
    const m = db(delivered(), {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && (call.values as Record<string, unknown>).status === 'invoiced') {
          Object.assign(tables.crm_store_orders[0], { status: 'invoiced', fortnox_invoice_number: '23', invoiced_by: 'annan', invoiced_by_name: 'Bo Ek' });
        }
      },
    });
    const { deps } = fakeFortnox();
    expect(await invoice(m, deps)).toEqual({ kind: 'invoiced', invoiceNumber: '23', source: 'created' });
    expect(row(m)).toMatchObject({ invoiced_by: 'annan', invoiced_by_name: 'Bo Ek' });
  });
});

// ----------------------------------------------------------------------------------------------------------- Makulera

describe('cancelStoreOrder', () => {
  const REASON = 'Artikeln går inte att leverera före jul';
  const cancel = (
    m: ReturnType<typeof memoryAdmin>,
    deps: StoreOrderFulfilmentDeps,
    expected: { status: StoreOrderStatus; version: number } = { status: 'confirmed', version: 2 },
  ) => cancelStoreOrder(m.admin, { id: ID, reason: REASON, expected, actor }, deps);

  it('mottagen: makulerad med skälet, vem och när; Fortnox anropas inte och claimen rörs inte', async () => {
    const m = db(storeOrder({ status: 'received', fortnox_order_number: null, fortnox_order_sync_status: 'not_synced' }));
    const { deps } = fakeFortnox();
    expect(await cancel(m, deps, { status: 'received', version: 2 })).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: [] });
    expect(row(m)).toMatchObject({
      status: 'cancelled',
      cancel_reason: REASON,
      cancelled_at: NOW.toISOString(),
      cancelled_by: SELLER,
      cancelled_by_name: 'Anna Berg',
      fortnox_order_sync_status: 'not_synced',
    });
    expect(deps.findOpen).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('🧨 inte som säljaren såg den: butiken ändrade (versionen), eller någon bekräftade: ingenting görs', async () => {
    const { deps } = fakeFortnox();
    const changed = db(storeOrder({ status: 'received', store_version: 3, fortnox_order_number: null }));
    expect(await cancel(changed, deps, { status: 'received', version: 2 })).toEqual({ kind: 'changed' });
    expect(row(changed).status).toBe('received');
    // Beslutet tas på läsningen: ingen skrivning försöks.
    expect(changed.calls.filter((c) => c.op === 'update')).toEqual([]);

    const confirmed = db(storeOrder());
    expect(await cancel(confirmed, deps, { status: 'received', version: 2 })).toEqual({ kind: 'changed' });
    expect(row(confirmed)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced' });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('🧨 Bekräfta låste mellan läsningen och skrivningen: ingenting makulerat, "changed"', async () => {
    const m = db(storeOrder({ status: 'received', fortnox_order_number: null }), {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && (call.values as Record<string, unknown>).status === 'cancelled') tables.crm_store_orders[0].status = 'confirmed';
      },
    });
    expect(await cancel(m, fakeFortnox().deps, { status: 'received', version: 2 })).toEqual({ kind: 'changed' });
    expect(row(m)).toMatchObject({ status: 'confirmed', cancel_reason: null });
  });

  it('🧨 butiken ändrade mellan läsningen och skrivningen: ingenting makulerat, "changed"', async () => {
    const m = db(storeOrder({ status: 'received', fortnox_order_number: null }), {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && (call.values as Record<string, unknown>).status === 'cancelled') tables.crm_store_orders[0].store_version = 3;
      },
    });
    expect(await cancel(m, fakeFortnox().deps, { status: 'received', version: 2 })).toEqual({ kind: 'changed' });
    expect(row(m)).toMatchObject({ status: 'received', cancel_reason: null });
  });

  it('🧨 en Levererad tog över en gammal claim medan Fortnox-ordern makulerades: beställningen skrivs inte över, och det loggas', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = db(storeOrder(), {
      beforeExecute: (call, tables) => {
        if (call.op === 'update' && (call.values as Record<string, unknown>).status === 'cancelled') {
          Object.assign(tables.crm_store_orders[0], { status: 'delivered', delivered_on: '2026-09-29' });
        }
      },
    });
    const { deps } = fakeFortnox();
    expect(await cancel(m, deps)).toEqual({ kind: 'not_cancellable' });
    expect(row(m)).toMatchObject({ status: 'delivered', cancel_reason: null, fortnox_order_claimed_at: null });
    expect(error.mock.calls.some(([message]) => String(message).includes('hann ändras här'))).toBe(true);
    error.mockRestore();
  });

  it('levererad, fakturerad, tillbakadragen eller redan makulerad: kan inte makuleras; okänd not_found', async () => {
    const { deps } = fakeFortnox();
    for (const status of ['delivered', 'invoiced', 'withdrawn', 'cancelled']) {
      const m = db(storeOrder({ status }));
      expect(await cancel(m, deps, { status: 'confirmed', version: 2 })).toEqual({ kind: 'not_cancellable' });
      expect(row(m).status).toBe(status);
    }
    expect(await cancelStoreOrder(db().admin, { id: '66666666-6666-4666-8666-666666666666', reason: REASON, expected: { status: 'confirmed', version: 2 }, actor }, deps)).toEqual({
      kind: 'not_found',
    });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('bekräftad med Fortnox-order: ordern makuleras FÖRST, sedan beställningen; omförsöken stängs och claimen släpps', async () => {
    const m = db(storeOrder({ fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z' }));
    const { deps, state } = fakeFortnox();
    deps.cancel.mockImplementation(async (n: string) => {
      // När Fortnox-ordern makuleras står beställningen fortfarande som bekräftad.
      expect(row(m).status).toBe('confirmed');
      state[n].cancelled = true;
    });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
    expect(deps.cancel).toHaveBeenCalledWith('58');
    expect(deps.cancel).toHaveBeenCalledTimes(1);
    // Sökningen görs ändå: en dubblett från två samtidiga försök ska också makuleras.
    expect(row(m)).toMatchObject({
      status: 'cancelled',
      cancel_reason: REASON,
      fortnox_order_number: '58',
      fortnox_order_sync_status: 'synced',
      fortnox_order_claimed_at: null,
      fortnox_next_attempt_at: null,
    });
  });

  it('🧨 bekräftad utan nummer: varje order som bär märkningen makuleras, och den första skrivs på beställningen', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z' }));
    const { deps, state } = fakeFortnox({ '57': {}, '59': {} }, ['57', '59']);
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['57', '59'] });
    expect(deps.findOpen).toHaveBeenCalledWith(`crm-store-order:${ID}`);
    expect(state['57'].cancelled && state['59'].cancelled).toBe(true);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '57', fortnox_order_sync_status: 'synced', fortnox_next_attempt_at: null });
  });

  it('🧨 raden har ett nummer, och en dubblett med märkningen står öppen (två försök skickade): båda makuleras', async () => {
    const m = db();
    const { deps, state } = fakeFortnox({ '58': {}, '72': {} }, ['58', '72']);
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58', '72'] });
    expect(state['58'].cancelled && state['72'].cancelled).toBe(true);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '58' });
  });

  it('makuleringen faller i Fortnox efter att sökningens order kopplats: synkläget följer numret', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }));
    const { deps } = fakeFortnox({ '123': {} }, ['123']);
    deps.cancel.mockImplementation(async () => {
      throw new FortnoxApiError(500, 'Fortnox PUT misslyckades (500)');
    });
    deps.readOrder.mockImplementation(async (n: string) => {
      if (deps.cancel.mock.calls.length > 0) throw new FortnoxApiError(503, 'Fortnox GET misslyckades (503)');
      return { cancelled: false, invoiceNumber: n === 'x' ? 'x' : null };
    });
    await expect(cancel(m, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_number: '123', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('🧨 sökningen går inte fast raden har ett nummer: ingenting makuleras (dubbletterna vore okända)', async () => {
    const m = db();
    const { deps } = fakeFortnox();
    deps.findOpen.mockImplementation(async () => {
      throw new FortnoxApiError(503, 'Fortnox GET /orders misslyckades (503)');
    });
    await expect(cancel(m, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('🧨 före Fortnox kopplas sökningens order och omförsöken stängs: dör makuleringen efter det skapar ingen push en ny order', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z' }));
    const { deps, state } = fakeFortnox({ '71': {} }, ['71']);
    deps.cancel.mockImplementation(async (n: string) => {
      // När Fortnox-ordern makuleras är den redan kopplad, och inget försök är planerat.
      expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_number: '71', fortnox_next_attempt_at: null });
      state[n].cancelled = true;
    });
    // Processen "dör" på sista skrivningen.
    m.failOn((c) => isUpdate(c, 'status', 'cancelled'), { message: 'nere' });
    await expect(cancel(m, deps)).rejects.toThrow('kunde inte makuleras');
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_number: '71', fortnox_next_attempt_at: null, fortnox_order_claimed_at: null });
    // Levererad nekar nu (ordern är makulerad i Fortnox), och ett nytt tryck på Makulera går igenom.
    expect(await markStoreOrderDelivered(m.admin, { id: ID, deliveredOn: '2026-09-29', actor }, deps)).toEqual({ kind: 'fortnox_order_cancelled', orderNumber: '71' });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['71'] });
  });

  it('🧨 en push sparade sitt nummer mitt i förberedelsen: inget skrivs över, och båda ordrarna makuleras', async () => {
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && call.op === 'update' && 'fortnox_next_attempt_at' in (call.values as Record<string, unknown>) && !('status' in (call.values as Record<string, unknown>))) {
          first = false;
          tables.crm_store_orders[0].fortnox_order_number = '801';
        }
      },
    });
    const { deps, state } = fakeFortnox({ '71': {}, '801': {} }, ['71']);
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['801', '71'] });
    expect(state['71'].cancelled && state['801'].cancelled).toBe(true);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '801' });
  });

  it('🧨 claimen togs av ett annat steg mitt i förberedelsen: ingenting kopplas eller makuleras, busy', async () => {
    const other = othersClaim();
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && call.op === 'update' && 'fortnox_next_attempt_at' in (call.values as Record<string, unknown>) && !('status' in (call.values as Record<string, unknown>))) {
          first = false;
          Object.assign(tables.crm_store_orders[0], { fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
        }
      },
    });
    const { deps, state } = fakeFortnox({ '71': {} }, ['71']);
    expect(await cancel(m, deps)).toEqual({ kind: 'busy' });
    expect(state['71'].cancelled).toBe(false);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_number: null, fortnox_order_claimed_at: other });
  });

  it('bekräftad utan nummer och ingen order i Fortnox: makulerad utan nummer', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }));
    const { deps } = fakeFortnox({});
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: [] });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: null, fortnox_order_sync_status: 'not_synced', fortnox_order_claimed_at: null });
  });

  it('🧨 en push håller claimen (färsk): busy, Fortnox rörs inte och beställningen står kvar', async () => {
    const claimedAt = fresh();
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: claimedAt }));
    const { deps } = fakeFortnox({}, ['57']);
    expect(await cancel(m, deps)).toEqual({ kind: 'busy' });
    expect(deps.findOpen).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: claimedAt });
  });

  it('en claim som blivit gammal tas över: makuleringen går igenom', async () => {
    const m = db(storeOrder({ fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: stale() }));
    expect(await cancel(m, fakeFortnox().deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_claimed_at: null });
  });

  it('🧨 en push vars claim blivit gammal sparade ett nummer efter sökningen: ett varv till makulerar det', async () => {
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && call.op === 'update' && (call.values as Record<string, unknown>).status === 'cancelled') {
          first = false;
          tables.crm_store_orders[0].fortnox_order_number = '801';
        }
      },
    });
    const { deps, state } = fakeFortnox({ '801': {} });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['801'] });
    expect(state['801'].cancelled).toBe(true);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '801' });
  });

  it('🧨 en push sparade sitt nummer efter sökningen och släppte claimen: den tas igen, och ordern makuleras', async () => {
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && isUpdate(call, 'status', 'cancelled')) {
          first = false;
          Object.assign(tables.crm_store_orders[0], { fortnox_order_number: '801', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
        }
      },
    });
    const { deps, state } = fakeFortnox({ '801': {} });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['801'] });
    expect(state['801'].cancelled).toBe(true);
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_order_number: '801', fortnox_order_claimed_at: null });
  });

  it('🧨 ... och ett annat steg (Levererad) hann ta claimen: busy, ingenting makuleras och dess claim står kvar', async () => {
    const other = othersClaim();
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && isUpdate(call, 'status', 'cancelled')) {
          first = false;
          Object.assign(tables.crm_store_orders[0], { fortnox_order_number: '801', fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
        }
      },
    });
    const { deps, state } = fakeFortnox({ '801': {} });
    expect(await cancel(m, deps)).toEqual({ kind: 'busy' });
    expect(state['801'].cancelled).toBe(false);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
  });

  it('🧨 claimen togs av ett annat steg efter att sökningens order makulerats: busy, och det loggas', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = othersClaim();
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (isUpdate(call, 'status', 'cancelled')) Object.assign(tables.crm_store_orders[0], { fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: other });
      },
    });
    const { deps } = fakeFortnox({ '57': {} }, ['57']);
    expect(await cancel(m, deps)).toEqual({ kind: 'busy' });
    expect(error.mock.calls.some(([message]) => String(message).includes('hann tas av ett annat steg'))).toBe(true);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_claimed_at: other });
    error.mockRestore();
  });

  it('🧨 sökningen gav två ordrar och den andra är fakturerad: nekas innan något makuleras eller kopplas', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed', fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z' }));
    const { deps, state } = fakeFortnox({ '57': {}, '59': { invoiceNumber: '30' } }, ['57', '59']);
    expect(await cancel(m, deps)).toEqual({ kind: 'fortnox_order_invoiced', orderNumber: '59', invoiceNumber: '30' });
    expect(state['57'].cancelled).toBe(false);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({
      status: 'confirmed',
      fortnox_order_number: null,
      fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z',
      fortnox_order_sync_status: 'failed',
      fortnox_order_claimed_at: null,
    });
  });

  it('ett andra varv (claimen släpptes av en push) läser inte om en order som första varvet redan makulerat', async () => {
    let first = true;
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }), {
      beforeExecute: (call, tables) => {
        if (first && isUpdate(call, 'status', 'cancelled')) {
          first = false;
          Object.assign(tables.crm_store_orders[0], { fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
        }
      },
    });
    const { deps } = fakeFortnox({ '71': {} }, ['71']);
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['71'] });
    expect(deps.readOrder.mock.calls.filter(([n]) => n === '71')).toHaveLength(1);
    expect(deps.cancel).toHaveBeenCalledTimes(1);
  });

  it('🧨 någon makulerade ordern i Fortnox mellan läsningen och vår makulering: räknas som klar', async () => {
    const m = db();
    const { deps, state } = fakeFortnox();
    deps.cancel.mockImplementationOnce(async (n: string) => {
      state[n].cancelled = true;
      throw new FortnoxApiError(400, 'Är redan makulerad.', 2001279, 'Är redan makulerad.');
    });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
    expect(row(m).status).toBe('cancelled');
  });

  it('🧨 den andra ordern fakturerades i Fortnox mellan läsningen och vår makulering: nekas, claimen släpps, och att den första makulerades loggas', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }));
    const { deps, state } = fakeFortnox({ '57': {}, '59': {} }, ['57', '59']);
    const cancelInFake = deps.cancel.getMockImplementation()!;
    deps.cancel.mockImplementation(async (n: string) => {
      if (n === '59') {
        state['59'].invoiceNumber = '30';
        throw new FortnoxApiError(400, 'Är låst och kan inte makuleras.', 2001383, 'Är låst och kan inte makuleras.');
      }
      return cancelInFake(n);
    });
    expect(await cancel(m, deps)).toEqual({ kind: 'fortnox_order_invoiced', orderNumber: '59', invoiceNumber: '30' });
    expect(state['57'].cancelled).toBe(true);
    expect(error.mock.calls.some(([message]) => String(message).includes('makulerades inte'))).toBe(true);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_number: '57', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
    error.mockRestore();
  });

  it('en order som redan är makulerad i Fortnox makuleras inte igen (ingen PUT), och räknas som klar', async () => {
    const m = db();
    const { deps } = fakeFortnox({ '58': { cancelled: true } });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('🧨 makuleringen tog över en push vars claim blivit gammal: ett svep planeras (pushens POST kan vara på väg)', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'pending', fortnox_order_claimed_at: stale() }));
    expect(await cancel(m, fakeFortnox({}).deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: [] });
    expect(row(m)).toMatchObject({ status: 'cancelled', fortnox_next_attempt_at: '2026-09-29T10:05:00.000Z', fortnox_attempts: 1 });
  });

  it('en claim som hann släppas före läsningen av stämpeln: upptagen, inte ett fel', async () => {
    let selects = 0;
    const m = db(storeOrder(), {
      beforeExecute: (call, tables) => {
        // Första läsningen är raden, den andra stämpeln: precis före den släpper en push claimen.
        if (call.op === 'select' && call.table === 'crm_store_orders' && ++selects === 2) {
          Object.assign(tables.crm_store_orders[0], { fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
        }
      },
    });
    expect(await markStoreOrderDelivered(m.admin, { id: ID, deliveredOn: '2026-09-29', actor }, fakeFortnox().deps)).toEqual({ kind: 'busy' });
    expect(row(m).status).toBe('confirmed');
  });

  it('Fortnox-ordern var redan makulerad (i Fortnox): räknas som klar', async () => {
    const m = db();
    const { deps } = fakeFortnox({ '58': { cancelled: true } });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
    expect(row(m).status).toBe('cancelled');
  });

  it('🧨 Fortnox-ordern är redan fakturerad: ingenting makuleras, det sägs, och claimen släpps', async () => {
    const m = db();
    const { deps } = fakeFortnox({ '58': { invoiceNumber: '23' } });
    expect(await cancel(m, deps)).toEqual({ kind: 'fortnox_order_invoiced', orderNumber: '58', invoiceNumber: '23' });
    expect(row(m)).toMatchObject({ status: 'confirmed', cancel_reason: null, fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('🧨 Fortnox nekar makuleringen (nere): ingenting makulerat här, claimen släpps, felet kastas', async () => {
    const m = db();
    const { deps } = fakeFortnox();
    deps.cancel.mockImplementation(async () => {
      throw new FortnoxApiError(503, 'Fortnox PUT misslyckades (503)');
    });
    await expect(cancel(m, deps)).rejects.toBeInstanceOf(FortnoxApiError);
    expect(row(m)).toMatchObject({ status: 'confirmed', cancel_reason: null, fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
  });

  it('🧨 sökningen går inte: ingenting görs (utan den vet vi inte om en order finns)', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'failed' }));
    const { deps } = fakeFortnox();
    deps.findOpen.mockImplementation(async () => {
      throw new FortnoxNotConnectedError();
    });
    await expect(cancel(m, deps)).rejects.toBeInstanceOf(FortnoxNotConnectedError);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'failed', fortnox_order_claimed_at: null });
  });

  it('synkläget lämnas som det var när ingenting ändrades (Fortnox inte anslutet på en utan nummer)', async () => {
    const m = db(storeOrder({ fortnox_order_number: null, fortnox_order_sync_status: 'not_synced' }));
    const { deps } = fakeFortnox();
    deps.findOpen.mockImplementation(async () => {
      throw new FortnoxNotConnectedError();
    });
    await expect(cancel(m, deps)).rejects.toBeInstanceOf(FortnoxNotConnectedError);
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'not_synced', fortnox_order_claimed_at: null });
  });

  it('databasen svarar inte på sista skrivningen: kastar och släpper claimen (ett nytt tryck räknar den makulerade ordern som klar)', async () => {
    const m = db();
    const { deps } = fakeFortnox();
    m.failOn((c) => c.op === 'update' && (c.values as Record<string, unknown>).status === 'cancelled', { message: 'nere' });
    await expect(cancel(m, deps)).rejects.toThrow('kunde inte makuleras');
    expect(row(m)).toMatchObject({ status: 'confirmed', fortnox_order_sync_status: 'synced', fortnox_order_claimed_at: null });
    expect(await cancel(m, deps)).toEqual({ kind: 'cancelled', fortnoxOrderNumbers: ['58'] });
  });
});
