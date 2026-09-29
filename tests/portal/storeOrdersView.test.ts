import { describe, it, expect } from 'vitest';
import { STORE_ORDER_LIST_LIMIT, getStoreOrderView, listStoreOrderViews } from '@/lib/domains/portal/storeOrdersView';
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

describe('listStoreOrderViews', () => {
  it('summan ur raderna, antalet rader, önskad leverans och ändrad; en okänd status visas inte', async () => {
    const m = memoryAdmin({
      crm_store_orders: [row(), row({ id: 'order-2', status: 'något nytt' }), row({ id: 'order-3', store_version: 2 })],
    });
    const { orders, capped } = await listStoreOrderViews(m.admin);
    expect(capped).toBe(false);
    expect(orders.map((o) => o.id).sort()).toEqual(['order-1', 'order-3']);
    const first = orders.find((o) => o.id === 'order-1')!;
    expect(first).toMatchObject({ lineCount: 2, linesTotal: 4414.2, desiredPeriod: 'Vecka 41', changed: false, status: 'received' });
    expect(first.receivedLabel).toMatch(/12 okt\. 2026 08:30/);
    expect(orders.find((o) => o.id === 'order-3')!.changed).toBe(true);
    const call = m.calls[0];
    expect(call.limit).toBe(STORE_ORDER_LIST_LIMIT);
    expect(call.orders?.[0]).toEqual({ column: 'received_at', ascending: false });
  });

  it('säger till när gränsen nås', async () => {
    const rows = Array.from({ length: STORE_ORDER_LIST_LIMIT }, (_, i) => row({ id: `o-${i}` }));
    const { capped } = await listStoreOrderViews(memoryAdmin({ crm_store_orders: rows }).admin);
    expect(capped).toBe(true);
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
