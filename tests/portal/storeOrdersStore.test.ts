import { describe, it, expect, vi } from 'vitest';
import {
  STORE_ORDER_NOTICE_LEASE_MS,
  STORE_ORDER_NOTICES_PER_ROUND,
  changeStoreOrder,
  notifyStoreOrder,
  receiveStoreOrder,
  storeOrderIntakeDeps,
  sweepStoreOrderNotices,
  withdrawStoreOrder,
  type StoreOrderIntakeDeps,
  type StoreOrderNoticeDeps,
} from '@/lib/domains/portal/storeOrdersStore';
import { portalStoreOrderChangeSchema, portalStoreOrderSchema } from '@/lib/domains/portal/storeOrderIntake';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';
import { memoryAdmin, type Call } from './helpers/memoryAdmin';

/**
 * Butiksbeställningarnas intag mot databasen (fas 8). Det som skyddas:
 *   - en ny beställning sparas en gång, med den första kroppen som den kom och den tolkade som version; butiken uppdateras
 *     bara av en ny; fördelningen utan länet; en upprepning ger den befintliga, en annan första kropp en konflikt;
 *   - en ändring gäller bara en mottagen beställning med ett strikt nyare updatedAt, och en samtidig ändring eller
 *     bekräftelse gör att beslutet tas om på det som står nu;
 *   - tillbakadragningen, med samma villkor;
 *   - notisen: rätt sort till den ansvarige (annars reserven), ett lån, bokförd först när den gått iväg;
 *   - cron gör om de notiser som inte gick iväg, inom sina gränser.
 */

const NOW = new Date('2026-10-12T08:30:00.000Z');
const ORDER = portalStoreOrderSchema.parse(structuredClone(CONTRACT_STORE_ORDER));
const RAW = structuredClone(CONTRACT_STORE_ORDER) as unknown;

let seq = 0;
function db(initial: Record<string, Record<string, unknown>[]> = {}, options: Parameters<typeof memoryAdmin>[1] = {}) {
  return memoryAdmin(
    { crm_portal_settings: [{ id: true, fallback_user_id: 'reserven' }], ...initial },
    {
      ...options,
      defaults: (table, row) =>
        table === 'crm_store_orders'
          ? {
              id: `order-${++seq}`,
              status: 'received',
              store_version: 1,
              portal_updated_at: null,
              changed_at: null,
              withdrawn_at: null,
              notified_key: null,
              notify_claimed_at: null,
              received_at: NOW.toISOString(),
            }
          : {},
    },
  );
}

function intakeDeps(over: Partial<StoreOrderIntakeDeps> = {}): StoreOrderIntakeDeps {
  return {
    assign: vi.fn(async () => ({ kind: 'assigned' as const, userId: 'saljaren', source: 'reseller_seller' as const, county: null, skipped: [] })),
    profileName: vi.fn(async () => 'Sara Säljare'),
    now: () => NOW,
    ...over,
  };
}

const storeRow = (over: Record<string, unknown> = {}) => ({
  id: 'order-1',
  order_id: ORDER.orderId,
  order_number: ORDER.orderNumber,
  reseller_id: ORDER.store.resellerId,
  store_name: ORDER.store.name,
  status: 'received',
  store_version: 1,
  portal_updated_at: null,
  changed_at: null,
  withdrawn_at: null,
  received_at: '2026-10-12T08:00:00.000Z',
  assigned_to: 'saljaren',
  notified_key: null,
  notify_claimed_at: null,
  intake_payload: RAW,
  payload: ORDER,
  ...over,
});

// --------------------------------------------------------------------------------------------------------- ny

describe('receiveStoreOrder', () => {
  it('sparar en ny: första kroppen som den kom, den tolkade som version, kunden ur numret, den ansvarige med namn', async () => {
    const m = db({ crm_customers: [{ id: 'kund-1043', fortnox_customer_id: '1043' }] });
    const deps = intakeDeps();
    const result = await receiveStoreOrder(m.admin, ORDER, RAW, deps);
    expect(result).toEqual({ kind: 'created', id: expect.any(String) });
    const row = m.tables.crm_store_orders[0];
    expect(row).toMatchObject({
      order_id: 'so-b-2026-003',
      order_number: 'B-2026-003',
      reseller_id: 'res-norrbygg',
      store_name: 'Norrbygg AB',
      customer_id: 'kund-1043',
      assigned_to: 'saljaren',
      assigned_to_name: 'Sara Säljare',
      assignment_source: 'reseller_seller',
      intake_payload: RAW,
      payload: ORDER,
    });
    expect(deps.assign).toHaveBeenCalledWith({ resellerId: 'res-norrbygg', customerId: 'kund-1043' });
    // Butiken dyker upp vid första kontakten, med kortet.
    expect(m.tables.crm_portal_resellers[0]).toMatchObject({ reseller_id: 'res-norrbygg', customer_number: '1043', customer_id: 'kund-1043' });
  });

  it('en befintlig butik skrivs aldrig över av en beställning: den kan vara veckogammal i portalens kö', async () => {
    const store = { reseller_id: 'res-norrbygg', name: 'Norrbygg AB (nytt namn)', customer_number: '2000', customer_id: 'kund-2000', customer_linked_at: null };
    const m = db({ crm_portal_resellers: [store], crm_customers: [{ id: 'kund-1043', fortnox_customer_id: '1043' }] });
    await receiveStoreOrder(m.admin, ORDER, RAW, intakeDeps());
    expect(m.tables.crm_portal_resellers).toEqual([store]);
    // Beställningen får kortet som dess eget nummer pekar på.
    expect(m.tables.crm_store_orders[0].customer_id).toBe('kund-1043');
  });

  it('en tom kundnummersträng i den första kroppen sparas som den kom; den tolkade har null', async () => {
    const raw = { ...(structuredClone(CONTRACT_STORE_ORDER) as Record<string, any>) };
    raw.store.ekovillaCustomerNumber = '';
    const order = portalStoreOrderSchema.parse(raw);
    const m = db();
    await receiveStoreOrder(m.admin, order, raw, intakeDeps());
    const row = m.tables.crm_store_orders[0] as Record<string, any>;
    expect(row.intake_payload.store.ekovillaCustomerNumber).toBe('');
    expect(row.payload.store.ekovillaCustomerNumber).toBeNull();
    expect(row.customer_id).toBeNull();
  });

  it('butikens kort som kopplats för hand gäller när numret saknas', async () => {
    const m = db({
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', customer_id: 'kund-hand', customer_linked_at: '2026-10-01T00:00:00Z' }],
    });
    const order = portalStoreOrderSchema.parse({ ...(structuredClone(CONTRACT_STORE_ORDER) as object), store: { ...CONTRACT_STORE_ORDER.store, ekovillaCustomerNumber: null } });
    const deps = intakeDeps();
    await receiveStoreOrder(m.admin, order, RAW, deps);
    expect(m.tables.crm_store_orders[0].customer_id).toBe('kund-hand');
    expect(deps.assign).toHaveBeenCalledWith({ resellerId: 'res-norrbygg', customerId: 'kund-hand' });
  });

  it('samma första kropp igen: den befintliga, och butiken rörs inte', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    const deps = intakeDeps();
    expect(await receiveStoreOrder(m.admin, ORDER, structuredClone(RAW), deps)).toEqual({ kind: 'existing', id: 'order-1' });
    expect(deps.assign).not.toHaveBeenCalled();
    // Butiken skrivs bara av en NY beställning (läsas får den: kopplingen läses samtidigt som raden).
    expect(m.calls.some((c) => c.table === 'crm_portal_resellers' && c.op !== 'select')).toBe(false);
    expect(m.tables.crm_store_orders).toHaveLength(1);
  });

  it('samma orderId med en annan första kropp: konflikt, ingenting ändras', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    const other = { ...(structuredClone(CONTRACT_STORE_ORDER) as object), costTotal: 1 };
    expect(await receiveStoreOrder(m.admin, ORDER, other, intakeDeps())).toEqual({ kind: 'conflict' });
    expect(m.tables.crm_store_orders[0].intake_payload).toEqual(RAW);
  });

  it('en upprepning jämförs med den FÖRSTA kroppen, också när beställningen ändrats sedan', async () => {
    const m = db({ crm_store_orders: [storeRow({ store_version: 3, payload: { ...ORDER, costTotal: 99 } })] });
    expect(await receiveStoreOrder(m.admin, ORDER, structuredClone(RAW), intakeDeps())).toEqual({ kind: 'existing', id: 'order-1' });
  });

  it('ingen kan ta den: ingenting sparas, och svaret säger varför', async () => {
    const m = db();
    const none = { kind: 'none' as const, county: null, skipped: [] };
    const result = await receiveStoreOrder(m.admin, ORDER, RAW, intakeDeps({ assign: vi.fn(async () => none) }));
    expect(result).toEqual({ kind: 'no_assignee', assignment: none });
    expect(m.tables.crm_store_orders ?? []).toHaveLength(0);
  });

  it('ett samtidigt anrop hann först: dess rad gäller (samma kropp = befintlig, annan = konflikt)', async () => {
    for (const [raw, expected] of [
      [RAW, 'existing'],
      [{ other: true }, 'conflict'],
    ] as const) {
      const m = db({}, {
        beforeExecute: (call: Call, tables) => {
          if (call.table === 'crm_store_orders' && call.op === 'upsert' && !(tables.crm_store_orders ?? []).length) {
            (tables.crm_store_orders ??= []).push(storeRow({ id: 'order-först', intake_payload: raw }));
          }
        },
      });
      const result = await receiveStoreOrder(m.admin, ORDER, RAW, intakeDeps());
      expect(result.kind).toBe(expected);
      expect(m.tables.crm_store_orders).toHaveLength(1);
    }
  });

  it('fördelningen på riktigt: utan länet (ingen Nominatim, ingen länsregel), reserven sist', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const m = db({
      crm_portal_resellers: [{ reseller_id: 'res-norrbygg', seller_user_id: null }],
      crm_routing_rules: [{ county: 'Gävleborg', user_id: 'lanets', priority: 1 }],
      profiles: [{ id: 'reserven', role: 'admin', full_name: 'Rolf Reserv' }, { id: 'lanets', role: 'admin' }],
      role_permissions: [{ role: 'admin', permission_key: 'crm.workorder.write' }],
      user_permissions: [],
    });
    const deps = storeOrderIntakeDeps(m.admin);
    const assignment = await deps.assign({ resellerId: 'res-norrbygg', customerId: null });
    expect(assignment).toMatchObject({ kind: 'assigned', userId: 'reserven', source: 'fallback', county: null });
    expect(m.calls.some((c) => c.table === 'crm_routing_rules')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await deps.profileName('reserven')).toBe('Rolf Reserv');
    fetchSpy.mockRestore();
  });
});

// ----------------------------------------------------------------------------------------------------- ändrad

const CHANGE = portalStoreOrderChangeSchema.parse({ ...(structuredClone(CONTRACT_STORE_ORDER) as object), updatedAt: '2026-10-12T08:20:00.123Z', costTotal: 5000 });

describe('changeStoreOrder', () => {
  it('första ändringen: den tolkade kroppen, versionen, updatedAt och tiden', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'updated', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({
      payload: CHANGE,
      store_version: 2,
      portal_updated_at: '2026-10-12T08:20:00.123Z',
      changed_at: NOW.toISOString(),
    });
    // Den första kroppen står kvar.
    expect(m.tables.crm_store_orders[0].intake_payload).toEqual(RAW);
  });

  it('en beställning utan kund får kunden när ändringen har ett kundnummer som finns; butikens namn följer ändringen', async () => {
    const m = db({
      crm_store_orders: [storeRow({ customer_id: null })],
      crm_customers: [{ id: 'kund-1043', fortnox_customer_id: '1043' }],
    });
    const change = { ...CHANGE, store: { ...CHANGE.store, name: 'Norrbygg AB (nytt namn)' } };
    expect(await changeStoreOrder(m.admin, change, () => NOW)).toEqual({ kind: 'updated', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({ customer_id: 'kund-1043', store_name: 'Norrbygg AB (nytt namn)' });
  });

  it('en kund som redan står på beställningen byts aldrig av butiken', async () => {
    const m = db({
      crm_store_orders: [storeRow({ customer_id: 'kund-hand' })],
      crm_customers: [{ id: 'kund-1043', fortnox_customer_id: '1043' }],
    });
    await changeStoreOrder(m.admin, CHANGE, () => NOW);
    expect(m.tables.crm_store_orders[0].customer_id).toBe('kund-hand');
    expect(m.calls.some((c) => c.table === 'crm_customers')).toBe(false);
  });

  it('en kund som kopplas för hand medan ändringen sparas skrivs inte över: beslutet tas om', async () => {
    let raced = false;
    const m = db(
      { crm_store_orders: [storeRow({ customer_id: null })], crm_customers: [{ id: 'kund-1043', fortnox_customer_id: '1043' }] },
      {
        beforeExecute: (call, tables) => {
          if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
            raced = true;
            tables.crm_store_orders[0].customer_id = 'kund-hand';
          }
        },
      },
    );
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'updated', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({ customer_id: 'kund-hand', payload: CHANGE, store_version: 2 });
  });

  it('samma eller äldre updatedAt: ignoreras och ändrar ingenting', async () => {
    for (const stored of ['2026-10-12T08:20:00.123+00:00', '2026-10-12T08:25:00.000+00:00']) {
      const m = db({ crm_store_orders: [storeRow({ portal_updated_at: stored, store_version: 2 })] });
      expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'ignored', id: 'order-1' });
      expect(m.tables.crm_store_orders[0]).toMatchObject({ store_version: 2, payload: ORDER });
      expect(m.calls.some((c) => c.op === 'update')).toBe(false);
    }
  });

  it('bekräftad: 409-beslutet, tillbakadragen och makulerad: ignoreras', async () => {
    for (const [status, kind] of [
      ['confirmed', 'confirmed'],
      ['invoiced', 'confirmed'],
      ['withdrawn', 'ignored'],
      ['cancelled', 'ignored'],
    ] as const) {
      const m = db({ crm_store_orders: [storeRow({ status })] });
      expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind, id: 'order-1' });
      expect(m.calls.some((c) => c.op === 'update')).toBe(false);
    }
  });

  it('annan butik: mismatch; okänd: unknown_order', async () => {
    const m = db({ crm_store_orders: [storeRow({ reseller_id: 'res-annan' })] });
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'mismatch', field: 'store.resellerId' });
    expect(await changeStoreOrder(db().admin, CHANGE, () => NOW)).toEqual({ kind: 'unknown_order' });
  });

  it('en nyare ändring hann före: beslutet tas om, och den nyare står kvar', async () => {
    const newer = { ...CHANGE, updatedAt: '2026-10-12T08:29:00.000Z', costTotal: 7 };
    let raced = false;
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
          raced = true;
          Object.assign(tables.crm_store_orders[0], { payload: newer, store_version: 2, portal_updated_at: '2026-10-12T08:29:00.000+00:00' });
        }
      },
    });
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'ignored', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({ payload: newer, store_version: 2 });
  });

  it('en bekräftelse hann före: 409-beslutet, ingenting ändrat', async () => {
    let raced = false;
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
          raced = true;
          tables.crm_store_orders[0].status = 'confirmed';
        }
      },
    });
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'confirmed', id: 'order-1' });
    expect(m.tables.crm_store_orders[0].payload).toEqual(ORDER);
  });

  it('en äldre ändring som hann före byter bara versionen: vår nyare gäller ändå, på den nya versionen', async () => {
    let raced = false;
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
          raced = true;
          Object.assign(tables.crm_store_orders[0], { store_version: 2, portal_updated_at: '2026-10-12T08:10:00.000+00:00' });
        }
      },
    });
    expect(await changeStoreOrder(m.admin, CHANGE, () => NOW)).toEqual({ kind: 'updated', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({ payload: CHANGE, store_version: 3 });
  });

  it('krockar varje gång: kastar efter tre försök (routen svarar 500, portalen gör om)', async () => {
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (call.table === 'crm_store_orders' && call.op === 'update') (tables.crm_store_orders[0].store_version as number) += 0.5;
      },
    });
    await expect(changeStoreOrder(m.admin, CHANGE, () => NOW)).rejects.toThrow(/flera gånger/);
    expect(m.calls.filter((c) => c.op === 'update')).toHaveLength(3);
  });
});

// -------------------------------------------------------------------------------------------------- tillbakadragen

describe('withdrawStoreOrder', () => {
  it('mottagen: tillbakadragen med tiden', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    expect(await withdrawStoreOrder(m.admin, ORDER.orderId, () => NOW)).toEqual({ kind: 'withdrawn', id: 'order-1' });
    expect(m.tables.crm_store_orders[0]).toMatchObject({ status: 'withdrawn', withdrawn_at: NOW.toISOString() });
  });

  it('redan tillbakadragen: samma svar, ingen ny tid; bekräftad 409-beslutet; makulerad ignoreras; okänd', async () => {
    const withdrawn = db({ crm_store_orders: [storeRow({ status: 'withdrawn', withdrawn_at: '2026-10-11T00:00:00Z' })] });
    expect(await withdrawStoreOrder(withdrawn.admin, ORDER.orderId, () => NOW)).toEqual({ kind: 'withdrawn', id: 'order-1' });
    expect(withdrawn.tables.crm_store_orders[0].withdrawn_at).toBe('2026-10-11T00:00:00Z');
    for (const [status, kind] of [
      ['confirmed', 'confirmed'],
      ['delivered', 'confirmed'],
      ['cancelled', 'ignored'],
    ] as const) {
      const m = db({ crm_store_orders: [storeRow({ status })] });
      expect(await withdrawStoreOrder(m.admin, ORDER.orderId, () => NOW)).toEqual({ kind, id: 'order-1' });
      expect(m.tables.crm_store_orders[0].status).toBe(status);
    }
    expect(await withdrawStoreOrder(db().admin, ORDER.orderId, () => NOW)).toEqual({ kind: 'unknown_order' });
  });

  it('en bekräftelse hann före: 409-beslutet, beställningen står bekräftad', async () => {
    let raced = false;
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
          raced = true;
          tables.crm_store_orders[0].status = 'confirmed';
        }
      },
    });
    expect(await withdrawStoreOrder(m.admin, ORDER.orderId, () => NOW)).toEqual({ kind: 'confirmed', id: 'order-1' });
    expect(m.tables.crm_store_orders[0].status).toBe('confirmed');
  });
});

// ------------------------------------------------------------------------------------------------------ notisen

function noticeDeps(over: Partial<StoreOrderNoticeDeps> = {}) {
  const sent: { recipient_user_id: string; title: string; body: string | null; href: string | null; type: string }[][] = [];
  const deps: StoreOrderNoticeDeps = {
    notify: vi.fn(async (rows) => {
      sent.push(rows as never);
    }),
    now: () => NOW,
    ...over,
  };
  return { deps, sent };
}

describe('notifyStoreOrder', () => {
  it('ny: "Ny beställning från <butik>" till den ansvarige, med sammanfattningen och länken; bokförd, lånet släppt', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    const { deps, sent } = noticeDeps();
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({
      recipient_user_id: 'saljaren',
      type: 'portal_store_order.received',
      title: 'Ny beställning från Norrbygg AB',
      href: '/crm/butiksbestallningar/order-1',
    });
    expect(sent[0][0].body?.replace(/\s/g, ' ')).toBe('B-2026-003 · 2 rader · 4 414 kr exkl. moms · Vecka 41');
    expect(m.tables.crm_store_orders[0]).toMatchObject({ notified_key: 'v1', notify_claimed_at: null });
  });

  it('ändrad: "<butik> ändrade <nr>", med det som gäller nu', async () => {
    const m = db({ crm_store_orders: [storeRow({ store_version: 3, notified_key: 'v1', payload: { ...ORDER, lines: [ORDER.lines[0]] } })] });
    const { deps, sent } = noticeDeps();
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('sent');
    expect(sent[0][0]).toMatchObject({ type: 'portal_store_order.changed', title: 'Norrbygg AB ändrade B-2026-003' });
    expect(sent[0][0].body).toContain('1 rad');
    expect(m.tables.crm_store_orders[0].notified_key).toBe('v3');
  });

  it('tillbakadragen: "<butik> drog tillbaka <nr>", också när ingen notis är bokförd sedan förut', async () => {
    for (const notified of ['v1', null]) {
      const m = db({ crm_store_orders: [storeRow({ status: 'withdrawn', withdrawn_at: NOW.toISOString(), notified_key: notified })] });
      const { deps, sent } = noticeDeps();
      expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('sent');
      expect(sent[0][0]).toMatchObject({ type: 'portal_store_order.withdrawn', title: 'Norrbygg AB drog tillbaka B-2026-003' });
      expect(m.tables.crm_store_orders[0]).toMatchObject({ notified_key: 'withdrawn', notify_claimed_at: null });
    }
  });

  it('ingen ansvarig: reserven', async () => {
    const m = db({ crm_store_orders: [storeRow({ assigned_to: null })] });
    const { deps, sent } = noticeDeps();
    await notifyStoreOrder(m.admin, 'order-1', deps);
    expect(sent[0][0].recipient_user_id).toBe('reserven');
  });

  it('varken ansvarig eller reserv: ingen notis, men den bokförs, så att cron inte gör om den varje minut', async () => {
    const m = db({ crm_store_orders: [storeRow({ assigned_to: null })], crm_portal_settings: [{ id: true, fallback_user_id: null }] });
    const { deps } = noticeDeps();
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('no_recipient');
    expect(deps.notify).not.toHaveBeenCalled();
    expect(m.tables.crm_store_orders[0]).toMatchObject({ notified_key: 'v1', notify_claimed_at: null });
  });

  it('redan sagd, eller bekräftad: ingenting, och inget lån tas', async () => {
    for (const over of [{ notified_key: 'v1' }, { status: 'confirmed' }]) {
      const m = db({ crm_store_orders: [storeRow(over)] });
      const { deps } = noticeDeps();
      expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('none');
      expect(m.calls.some((c) => c.op === 'update')).toBe(false);
    }
  });

  it('ett lån som gäller: upptagen, ingen notis; ett utgånget tas', async () => {
    const fresh = db({ crm_store_orders: [storeRow({ notify_claimed_at: new Date(NOW.getTime() - 60_000).toISOString() })] });
    const a = noticeDeps();
    expect(await notifyStoreOrder(fresh.admin, 'order-1', a.deps)).toBe('busy');
    expect(a.deps.notify).not.toHaveBeenCalled();

    const old = db({ crm_store_orders: [storeRow({ notify_claimed_at: new Date(NOW.getTime() - STORE_ORDER_NOTICE_LEASE_MS - 1).toISOString() })] });
    const b = noticeDeps();
    expect(await notifyStoreOrder(old.admin, 'order-1', b.deps)).toBe('sent');
    expect(old.tables.crm_store_orders[0]).toMatchObject({ notified_key: 'v1', notify_claimed_at: null });
  });

  it('utskicket faller: lånet släpps och inget bokförs, så att ett nytt försök skickar den', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    const { deps } = noticeDeps({ notify: vi.fn(async () => Promise.reject(new Error('push nere'))) });
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('failed');
    expect(m.tables.crm_store_orders[0]).toMatchObject({ notified_key: null, notify_claimed_at: null });
  });

  it('en ändring kom medan lånet togs: notisen gäller den nya versionen', async () => {
    let raced = false;
    const m = db({ crm_store_orders: [storeRow()] }, {
      beforeExecute: (call, tables) => {
        if (!raced && call.table === 'crm_store_orders' && call.op === 'update') {
          raced = true;
          tables.crm_store_orders[0].store_version = 2;
        }
      },
    });
    const { deps, sent } = noticeDeps();
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('sent');
    expect(sent[0][0].type).toBe('portal_store_order.received');
    expect(m.tables.crm_store_orders[0].notified_key).toBe('v2');
  });

  it('lånet togs över under utskicket: notisen räknas ändå som skickad, men bokförs inte över den nya ägarens lån', async () => {
    const m = db({ crm_store_orders: [storeRow()] });
    const { deps } = noticeDeps({
      notify: vi.fn(async () => {
        m.tables.crm_store_orders[0].notify_claimed_at = 'någon annans';
      }),
    });
    expect(await notifyStoreOrder(m.admin, 'order-1', deps)).toBe('sent');
    expect(m.tables.crm_store_orders[0]).toMatchObject({ notified_key: null, notify_claimed_at: 'någon annans' });
  });
});

// --------------------------------------------------------------------------------------------------------- cron

describe('sweepStoreOrderNotices', () => {
  const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

  it('gör om det som inte gick iväg, och bara det', async () => {
    const m = db({
      crm_store_orders: [
        storeRow({ id: 'gammal-ny', order_id: 'a', received_at: minutesAgo(10) }),
        storeRow({ id: 'farsk-ny', order_id: 'b', received_at: minutesAgo(1) }),
        storeRow({ id: 'sagd', order_id: 'c', received_at: minutesAgo(10), notified_key: 'v1' }),
        storeRow({ id: 'andrad', order_id: 'd', received_at: minutesAgo(60), store_version: 2, notified_key: 'v1', changed_at: minutesAgo(5) }),
        storeRow({ id: 'farsk-andrad', order_id: 'e', received_at: minutesAgo(60), store_version: 2, notified_key: 'v1', changed_at: minutesAgo(1) }),
        storeRow({ id: 'lanad', order_id: 'f', received_at: minutesAgo(10), notify_claimed_at: minutesAgo(1) }),
        storeRow({ id: 'tillbaka', order_id: 'g', status: 'withdrawn', notified_key: 'v1', withdrawn_at: minutesAgo(10) }),
        storeRow({ id: 'tillbaka-gammal', order_id: 'h', status: 'withdrawn', notified_key: 'v1', withdrawn_at: minutesAgo(15 * 24 * 60) }),
        storeRow({ id: 'bekraftad', order_id: 'i', status: 'confirmed', received_at: minutesAgo(10) }),
        // Mottagen för länge sedan och aldrig ändrad: utanför fönstret.
        storeRow({ id: 'gammal-mottagen', order_id: 'j', received_at: minutesAgo(15 * 24 * 60) }),
        // Mottagen för länge sedan men ändrad nyss: bara frågan efter ändringar hittar den.
        storeRow({ id: 'gammal-andrad', order_id: 'k', received_at: minutesAgo(15 * 24 * 60), store_version: 2, notified_key: 'v1', changed_at: minutesAgo(5) }),
      ],
    });
    const { deps, sent } = noticeDeps();
    const summary = await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps });
    expect(summary).toEqual({ candidates: 4, sent: 4, failed: 0, gaveUp: 0, errors: 0, deferred: 0 });
    // Kroppen läses inte i sopningen, bara när notisen skickas (en läsning per notis).
    const sweepReads = m.calls.filter((c) => c.table === 'crm_store_orders' && c.op === 'select' && c.limit === 500);
    expect(sweepReads).toHaveLength(3);
    // Ändringar och tillbakadragningar: de nyaste. Nya som aldrig meddelats: exakt, de äldsta först.
    expect(sweepReads.map((c) => c.orders?.[0]?.ascending)).toEqual([true, false, false]);
    expect(sent.map((rows) => rows[0].href).sort()).toEqual(
      ['/crm/butiksbestallningar/andrad', '/crm/butiksbestallningar/gammal-andrad', '/crm/butiksbestallningar/gammal-ny', '/crm/butiksbestallningar/tillbaka'].sort(),
    );
  });

  it('en ny beställning som aldrig meddelats hittas, hur många redan meddelade som än kommit efter den', async () => {
    const told = Array.from({ length: 600 }, (_, i) =>
      storeRow({ id: `sagd-${i}`, order_id: `s-${i}`, received_at: minutesAgo(3 + (i % 50)), notified_key: 'v1' }),
    );
    const m = db({ crm_store_orders: [...told, storeRow({ id: 'bortglomd', order_id: 'x', received_at: minutesAgo(60 * 24) })] });
    const { deps, sent } = noticeDeps();
    const summary = await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps });
    expect(summary.candidates).toBe(1);
    expect(sent[0][0].href).toBe('/crm/butiksbestallningar/bortglomd');
  });

  it('det som väntat längst skickas först', async () => {
    const m = db({
      crm_store_orders: [
        storeRow({ id: 'nyare', order_id: 'a', received_at: minutesAgo(5) }),
        storeRow({ id: 'aldre', order_id: 'b', received_at: minutesAgo(50) }),
      ],
    });
    const { deps, sent } = noticeDeps();
    await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps });
    expect(sent.map((rows) => rows[0].href)).toEqual(['/crm/butiksbestallningar/aldre', '/crm/butiksbestallningar/nyare']);
  });

  it('högst en omgång per varv, och ett fel för en stoppar inte nästa', async () => {
    const rows = Array.from({ length: STORE_ORDER_NOTICES_PER_ROUND + 3 }, (_, i) =>
      storeRow({ id: `o-${i}`, order_id: `o-${i}`, received_at: minutesAgo(10 + i) }),
    );
    const m = db({ crm_store_orders: rows });
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'update' && c.filters.some(([, col, v]) => col === 'id' && v === 'o-22'), { message: 'nere' });
    const { deps } = noticeDeps();
    const summary = await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps });
    expect(summary.candidates).toBe(STORE_ORDER_NOTICES_PER_ROUND + 3);
    expect(summary.sent + summary.errors).toBe(STORE_ORDER_NOTICES_PER_ROUND);
    expect(summary.errors).toBe(1);
  });

  it('en notis utan mottagare räknas som uppgiven, inte som ett fel som görs om', async () => {
    const m = db({
      crm_store_orders: [storeRow({ assigned_to: null, received_at: minutesAgo(10) })],
      crm_portal_settings: [{ id: true, fallback_user_id: null }],
    });
    const summary = await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps: noticeDeps().deps });
    expect(summary).toMatchObject({ candidates: 1, failed: 0, gaveUp: 1 });
    // Bokförd: nästa varv har inget att göra.
    expect((await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps: noticeDeps().deps })).candidates).toBe(0);
  });

  it('frågan efter nya som aldrig meddelats läser de äldsta först', async () => {
    const m = db({ crm_store_orders: [storeRow({ received_at: minutesAgo(10) })] });
    await sweepStoreOrderNotices(m.admin, { now: () => NOW, deps: noticeDeps().deps });
    const exact = m.calls.find((c) => c.filters.some(([kind, col]) => kind === 'is' && col === 'notified_key'));
    expect(exact?.orders?.[0]).toEqual({ column: 'received_at', ascending: true });
  });

  it('tidsbudgeten: när den är slut påbörjas inga fler, och resten väntar till nästa varv', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => storeRow({ id: `o-${i}`, order_id: `o-${i}`, received_at: minutesAgo(10 + i) }));
    const m = db({ crm_store_orders: rows });
    let t = NOW.getTime();
    const now = () => new Date(t);
    const { deps } = noticeDeps({ now, notify: vi.fn(async () => { t += 4_000; }) });
    const summary = await sweepStoreOrderNotices(m.admin, { now, deps, budgetMs: 10_000 });
    // 0 s, 4 s och 8 s påbörjas; vid 12 s är tiden slut.
    expect(summary).toMatchObject({ candidates: 5, sent: 3, deferred: 2 });
  });

  it('en läsning som faller kastar (steget i cron fångar det)', async () => {
    const m = db();
    m.failOn((c) => c.table === 'crm_store_orders' && c.op === 'select', { message: 'nere' });
    await expect(sweepStoreOrderNotices(m.admin, { now: () => NOW, deps: noticeDeps().deps })).rejects.toThrow(/nere/);
  });
});
