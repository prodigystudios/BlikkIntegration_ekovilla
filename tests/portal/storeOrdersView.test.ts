import { describe, it, expect } from 'vitest';
import { STORE_ORDER_LIST_LIMIT } from '@/lib/domains/portal/storeOrders';
import { getStoreOrderView, listStoreOrderViews } from '@/lib/domains/portal/storeOrdersView';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Butiksbeställningarna som sidorna visar dem (fas 8). Det som skyddas: summorna ur butikens rader (inte butikens egen
 * costTotal), fraktbeslutet (numeric kommer som sträng), händelserna i flödets ordning, en okänd status som inte visas,
 * och listans gräns.
 */

const ORDER = structuredClone(CONTRACT_STORE_ORDER) as unknown as Record<string, any>;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'order-1',
  order_id: 'so-b-2026-003',
  order_number: 'B-2026-003',
  store_name: 'Norrbygg AB',
  status: 'received',
  payload: { ...ORDER, costTotal: 1 },
  store_version: 1,
  received_at: '2026-10-12T06:30:00.000Z',
  changed_at: null,
  withdrawn_at: null,
  confirmed_at: null,
  confirmed_by_name: null,
  delivered_on: null,
  delivered_by_name: null,
  invoiced_on: null,
  invoiced_by_name: null,
  cancelled_at: null,
  cancelled_by_name: null,
  cancel_reason: null,
  customer_id: 'kund',
  assigned_to_name: 'Sara Säljare',
  freight_mode: null,
  freight_price: null,
  fortnox_order_number: null,
  ...over,
});
/** Som PostgREST svarar på listans select: raderna och önskad leverans ur kroppen, under sina alias. */
const listRow = (over: Record<string, unknown> = {}) => {
  const r = row(over) as Record<string, any>;
  return { lines: r.payload.lines, desired_period: r.payload.delivery.desiredPeriod, ...r };
};

describe('listStoreOrderViews', () => {
  it('summan ur raderna, antalet rader, önskad leverans och ändrad; en okänd status visas inte; nyast först', async () => {
    const m = memoryAdmin({
      crm_store_orders: [
        listRow(),
        listRow({ id: 'order-2', status: 'något nytt' }),
        listRow({ id: 'order-3', store_version: 2, status: 'confirmed', received_at: '2026-10-12T07:30:00.000Z' }),
        listRow({ id: 'order-4', received_at: '2026-10-11T07:30:00.000Z', desired_period: null }),
      ],
    });
    const { orders, capped } = await listStoreOrderViews(m.admin);
    expect(capped).toBe(false);
    expect(orders.map((o) => o.id)).toEqual(['order-3', 'order-1', 'order-4']);
    const first = orders.find((o) => o.id === 'order-1')!;
    expect(first).toMatchObject({ lineCount: 2, linesTotal: 4414.2, desiredPeriod: 'Vecka 41', changed: false, status: 'received' });
    expect(first.receivedLabel).toMatch(/12 okt\. 2026 08:30/);
    expect(orders.find((o) => o.id === 'order-3')!.changed).toBe(true);
    expect(orders.find((o) => o.id === 'order-4')!.desiredPeriod).toBe('');
  });

  it('alla som väntar på bekräftelse, sida för sida, hur många som än kommit efter; gränsen gäller bara resten', async () => {
    const received = Array.from({ length: 1500 }, (_, i) => listRow({ id: `r-${i}`, received_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    const confirmed = Array.from({ length: STORE_ORDER_LIST_LIMIT + 5 }, (_, i) => listRow({ id: `c-${i}`, status: 'confirmed', received_at: '2026-10-12T08:00:00.000Z' }));
    const m = memoryAdmin({ crm_store_orders: [...received, ...confirmed] });
    const { orders, capped } = await listStoreOrderViews(m.admin);
    expect(orders.filter((o) => o.status === 'received')).toHaveLength(1500);
    expect(orders.filter((o) => o.status === 'confirmed')).toHaveLength(STORE_ORDER_LIST_LIMIT);
    expect(capped).toBe(true);
    const receivedReads = m.calls.filter((c) => c.filters.some(([kind, col, v]) => kind === 'eq' && col === 'status' && v === 'received'));
    expect(receivedReads.map((c) => [c.offset, c.limit])).toEqual([[0, 1000], [1000, 1000]]);
  });

  it('säger inte att listan är kapad när resten ryms', async () => {
    // De obekräftade räknas inte mot gränsen: de läses alltid alla.
    const rows = [
      ...Array.from({ length: STORE_ORDER_LIST_LIMIT - 1 }, (_, i) => listRow({ id: `o-${i}`, status: 'invoiced' })),
      ...Array.from({ length: 10 }, (_, i) => listRow({ id: `r-${i}` })),
    ];
    const { capped, orders } = await listStoreOrderViews(memoryAdmin({ crm_store_orders: rows }).admin);
    expect(orders).toHaveLength(STORE_ORDER_LIST_LIMIT + 9);
    expect(capped).toBe(false);
  });
});

describe('getStoreOrderView', () => {
  it('raderna med summor, frakten ur numeric-strängen, och null för en som inte syns', async () => {
    const m = memoryAdmin({ crm_store_orders: [row({ freight_mode: 'charged', freight_price: '950.00' })] });
    const view = (await getStoreOrderView(m.admin, 'order-1'))!;
    expect(view.lines[0]).toMatchObject({ articleNumber: '13003', quantity: 12, unitCost: 335.3, total: 4023.6 });
    expect(view.linesTotal).toBe(4414.2);
    expect(view.freight).toEqual({ mode: 'charged', price: 950 });
    expect(view.vatPercent).toBe(25);
    expect(view.customerNumber).toBe('1043');
    expect(await getStoreOrderView(m.admin, 'annan')).toBeNull();
    const none = (await getStoreOrderView(memoryAdmin({ crm_store_orders: [row({ freight_mode: 'none' })] }).admin, 'order-1'))!;
    expect(none.freight).toEqual({ mode: 'none' });
    expect((await getStoreOrderView(memoryAdmin({ crm_store_orders: [row()] }).admin, 'order-1'))!.freight).toBeNull();
  });

  it('kunden beställningen är kopplad till, som sessionen ser kortet; null utan kort', async () => {
    const linked = (await getStoreOrderView(
      memoryAdmin({ crm_store_orders: [row({ customer: { customer_type: 'business', company_name: 'SEHED Bygg AB', first_name: null, last_name: null, fortnox_customer_id: '15' } })] }).admin,
      'order-1',
    ))!;
    expect(linked.customer).toEqual({ name: 'SEHED Bygg AB', fortnoxCustomerNumber: '15' });
    expect(linked.customerNumber).toBe('1043');
    const hidden = (await getStoreOrderView(memoryAdmin({ crm_store_orders: [row({ customer: null })] }).admin, 'order-1'))!;
    expect(hidden.customer).toBeNull();
    expect(hidden.customerLinked).toBe(true);
  });

  it('tiderna för läget: senaste ändringen och tillbakadragningen, eller null', async () => {
    const view = (await getStoreOrderView(
      memoryAdmin({ crm_store_orders: [row({ store_version: 2, changed_at: '2026-10-12T07:00:00.000Z', withdrawn_at: '2026-10-12T08:00:00.000Z', status: 'withdrawn' })] }).admin,
      'order-1',
    ))!;
    expect(view.changedAtLabel).toMatch(/12 okt\. 2026 09:00/);
    expect(view.withdrawnAtLabel).toMatch(/12 okt\. 2026 10:00/);
    const fresh = (await getStoreOrderView(memoryAdmin({ crm_store_orders: [row()] }).admin, 'order-1'))!;
    expect(fresh.changedAtLabel).toBeNull();
    expect(fresh.withdrawnAtLabel).toBeNull();
  });

  it('händelserna i flödets ordning, med vem; en leverans samma dag kommer efter bekräftelsen', async () => {
    const m = memoryAdmin({
      crm_store_orders: [
        row({
          status: 'invoiced',
          store_version: 3,
          changed_at: '2026-10-12T07:00:00.000Z',
          confirmed_at: '2026-10-12T20:00:00.000Z',
          confirmed_by_name: 'Sara Säljare',
          delivered_on: '2026-10-12',
          delivered_by_name: 'Lars Lager',
          invoiced_on: '2026-10-13',
          invoiced_by_name: 'Eva Ekonomi',
        }),
      ],
    });
    const view = (await getStoreOrderView(m.admin, 'order-1'))!;
    // Dagarna i svensk form, som tiderna; inte 2026-10-12.
    expect(view.events.find((e) => e.label === 'Levererad')!.at).toMatch(/^12 okt\. 2026$/);
    expect(view.events.find((e) => e.label === 'Fakturerad')!.at).toMatch(/^13 okt\. 2026$/);
    expect(view.events.map((e) => [e.label, e.by])).toEqual([
      ['Mottagen från butiken', null],
      ['Ändrad av butiken 2 gånger, senast', null],
      ['Bekräftad', 'Sara Säljare'],
      ['Levererad', 'Lars Lager'],
      ['Fakturerad', 'Eva Ekonomi'],
    ]);
    const once = (await getStoreOrderView(memoryAdmin({ crm_store_orders: [row({ store_version: 2, changed_at: '2026-10-12T07:00:00.000Z' })] }).admin, 'order-1'))!;
    expect(once.events[1].label).toBe('Ändrad av butiken');
  });

  it('tillbakadragen och makulerad står i händelserna, med skälet', async () => {
    const withdrawn = (await getStoreOrderView(memoryAdmin({ crm_store_orders: [row({ status: 'withdrawn', withdrawn_at: '2026-10-12T08:00:00.000Z' })] }).admin, 'order-1'))!;
    expect(withdrawn.events.map((e) => e.label)).toEqual(['Mottagen från butiken', 'Tillbakadragen av butiken']);
    const cancelled = (await getStoreOrderView(
      memoryAdmin({ crm_store_orders: [row({ status: 'cancelled', cancelled_at: '2026-10-12T08:00:00.000Z', cancelled_by_name: 'Admin', cancel_reason: 'Slut i lager' })] }).admin,
      'order-1',
    ))!;
    expect(cancelled.events.at(-1)).toMatchObject({ label: 'Makulerad', by: 'Admin' });
    expect(cancelled.cancelReason).toBe('Slut i lager');
  });
});
