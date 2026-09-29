import { describe, it, expect } from 'vitest';
import { markStoreOrderForSync, syncStoreOrders } from '@/lib/domains/portal/storeOrderSync';
import { memoryAdmin } from './helpers/memoryAdmin';

// Omräkningen av de markerade butiksbeställningarna (fas 8b3). Händelserna köas först och läget sparas sedan, i en
// UPDATE som bara går igenom om markeringen står kvar som den lästes: samma rad ger samma händelser, så en krasch eller
// en ändring under tiden varken tappar eller dubblerar något.

const NOW = new Date('2026-10-12T08:30:00.000Z');
const MARK = '2026-10-12T08:29:00.123456+00:00';
const CONFIRMED_KEY = 'store_order.confirmed-so-1-2026-09-29T10:15:00.123Z';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'id-1',
  order_id: 'so-1',
  status: 'confirmed',
  fortnox_order_number: '74',
  confirmed_at: '2026-09-29T10:15:00.123+00:00',
  delivered_on: null,
  delivered_at: null,
  invoiced_on: null,
  invoiced_at: null,
  cancelled_at: null,
  cancel_reason: null,
  sync_requested_at: MARK,
  sync_state: {},
  ...over,
});
const delivered = (over: Record<string, unknown> = {}) =>
  order({ status: 'delivered', delivered_on: '2026-10-02', delivered_at: '2026-10-02T13:00:00.5+00:00', ...over });
const sentConfirmation = (status = 'sent') => ({ id: 'e1', seq: 1, idempotency_key: CONFIRMED_KEY, status });

const sync = (admin: unknown) => syncStoreOrders(admin as never, { now: () => NOW });
const row = (tables: Record<string, Record<string, unknown>[]>, id = 'id-1') => tables.crm_store_orders.find((r) => r.id === id)!;
const keys = (tables: Record<string, Record<string, unknown>[]>) => (tables.portal_outbound_events ?? []).map((e) => e.idempotency_key);

describe('syncStoreOrders', () => {
  it('bekräftad med Fortnox-nummer: köas mot portalens events-route i beställningens egen kö, läget sparas, markeringen nollas', async () => {
    const { admin, tables } = memoryAdmin({ crm_store_orders: [order()] });
    expect(await sync(admin)).toEqual({ orders: 1, queued: 1, unchanged: 0, conflicts: 0, errors: 0 });

    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(tables.portal_outbound_events[0]).toMatchObject({
      idempotency_key: CONFIRMED_KEY,
      path: '/api/ekovilla/events',
      ordering_key: 'store_order:so-1',
      supersede_key: null,
      status: 'pending',
      payload: {
        type: 'store_order.confirmed',
        occurredAt: '2026-09-29T10:15:00.123Z',
        data: { orderId: 'so-1', ekovillaOrderNumber: '74', confirmedAt: '2026-09-29T10:15:00.123Z' },
      },
    });
    expect(row(tables)).toMatchObject({ sync_state: { confirmedKey: CONFIRMED_KEY }, sync_requested_at: null });
  });

  it('redan levererad: bekräftad köas, och markeringen står kvar men flyttas sist tills den levererats', async () => {
    const { admin, tables } = memoryAdmin({ crm_store_orders: [delivered()] });
    expect(await sync(admin)).toMatchObject({ queued: 1 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY]);
    expect(row(tables).sync_requested_at).toBe(NOW.toISOString());
  });

  it('bekräftelsen levererad: leveransen köas efter den, och markeringen nollas', async () => {
    const { admin, tables } = memoryAdmin({
      crm_store_orders: [delivered({ sync_state: { confirmedKey: CONFIRMED_KEY } })],
      portal_outbound_events: [sentConfirmation()],
    });
    expect(await sync(admin)).toMatchObject({ queued: 1, errors: 0 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY, 'store_order.delivered-so-1-2026-10-02T13:00:00.500Z']);
    expect(tables.portal_outbound_events[1]).toMatchObject({ ordering_key: 'store_order:so-1', seq: 2 });
    expect(row(tables)).toMatchObject({ sync_state: { confirmedKey: CONFIRMED_KEY, delivered: true }, sync_requested_at: null });
  });

  it('bekräftelsen väntar: inget nytt, markeringen flyttas sist; uppgiven: beställningen står still', async () => {
    for (const [status, mark] of [['pending', NOW.toISOString()], ['dead', null]] as const) {
      const { admin, tables } = memoryAdmin({
        crm_store_orders: [delivered({ sync_state: { confirmedKey: CONFIRMED_KEY } })],
        portal_outbound_events: [sentConfirmation(status)],
      });
      expect(await sync(admin)).toMatchObject({ queued: 0, unchanged: 1 });
      expect(keys(tables)).toEqual([CONFIRMED_KEY]);
      expect(row(tables).sync_requested_at).toBe(mark);
    }
  });

  it('mottagen och tillbakadragen: inget köas, markeringen tas bort', async () => {
    const { admin, tables } = memoryAdmin({
      crm_store_orders: [
        order({ id: 'id-1', order_id: 'so-1', status: 'received', fortnox_order_number: null, confirmed_at: null }),
        order({ id: 'id-2', order_id: 'so-2', status: 'withdrawn', fortnox_order_number: null, confirmed_at: null }),
      ],
    });
    expect(await sync(admin)).toEqual({ orders: 2, queued: 0, unchanged: 2, conflicts: 0, errors: 0 });
    expect(tables.portal_outbound_events ?? []).toEqual([]);
    expect(tables.crm_store_orders.map((r) => [r.sync_requested_at, r.sync_state])).toEqual([[null, {}], [null, {}]]);
  });

  it('makulerad: store_order.cancelled med skälet, daterad vid makuleringen; sedan ingenting mer', async () => {
    const { admin, tables } = memoryAdmin({
      crm_store_orders: [order({ status: 'cancelled', cancelled_at: '2026-09-30T09:00:00.25+00:00', cancel_reason: 'Butiken ringde.' })],
    });
    await sync(admin);
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(tables.portal_outbound_events[0]).toMatchObject({
      idempotency_key: 'store_order.cancelled-so-1-2026-09-30T09:00:00.250Z',
      payload: { type: 'store_order.cancelled', occurredAt: '2026-09-30T09:00:00.250Z', data: { orderId: 'so-1', reason: 'Butiken ringde.' } },
    });
    expect(row(tables)).toMatchObject({ sync_state: { cancelled: true }, sync_requested_at: null });

    row(tables).sync_requested_at = '2026-10-12T09:00:00.000Z';
    await sync(admin);
    expect(tables.portal_outbound_events).toHaveLength(1);
    expect(row(tables).sync_requested_at).toBeNull();
  });

  it('en ändring under tiden (vakten markerar på nytt): läget sparas inte, nästa varv köar samma nyckel utan dubblett och sedan resten', async () => {
    let changed = false;
    const { admin, tables } = memoryAdmin(
      { crm_store_orders: [order()] },
      {
        beforeExecute: (call, t) => {
          // Beställningen levereras medan händelsen köas: vakten sätter en ny markering.
          if (!changed && call.table === 'crm_store_orders' && call.op === 'update') {
            changed = true;
            Object.assign(t.crm_store_orders[0], {
              status: 'delivered',
              delivered_on: '2026-10-02',
              delivered_at: '2026-10-02T13:00:00.5+00:00',
              sync_requested_at: '2026-10-12T08:29:30.000000+00:00',
            });
          }
        },
      },
    );
    expect(await sync(admin)).toEqual({ orders: 1, queued: 1, unchanged: 0, conflicts: 1, errors: 0 });
    expect(row(tables)).toMatchObject({ sync_state: {}, sync_requested_at: '2026-10-12T08:29:30.000000+00:00' });

    // Nästa varv: samma bekräftelse (kön känner igen den), och resten väntar på att den levereras.
    expect(await sync(admin)).toMatchObject({ queued: 1, conflicts: 0 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY]);
    expect(row(tables)).toMatchObject({ sync_state: { confirmedKey: CONFIRMED_KEY }, sync_requested_at: NOW.toISOString() });

    tables.portal_outbound_events[0].status = 'sent';
    await sync(admin);
    expect(keys(tables)).toEqual([CONFIRMED_KEY, 'store_order.delivered-so-1-2026-10-02T13:00:00.500Z']);
    expect(row(tables).sync_requested_at).toBeNull();
  });

  it('en krasch efter kön (läget sparas inte): nästa varv köar ingen dubblett och sparar läget', async () => {
    const { admin, tables, failOn } = memoryAdmin({ crm_store_orders: [order()] });
    failOn((c) => c.table === 'crm_store_orders' && c.op === 'update', { message: 'anslutningen bröts' });
    expect(await sync(admin)).toEqual({ orders: 1, queued: 0, unchanged: 0, conflicts: 0, errors: 1 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY]);
    expect(row(tables)).toMatchObject({ sync_state: {}, sync_requested_at: MARK });

    expect(await sync(admin)).toMatchObject({ queued: 1, errors: 0 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY]);
    expect(row(tables)).toMatchObject({ sync_state: { confirmedKey: CONFIRMED_KEY }, sync_requested_at: null });
  });

  it('bara markerade, äldst först, högst limit; en som faller hindrar inte nästa', async () => {
    const { admin, tables, calls, failOn } = memoryAdmin({
      crm_store_orders: [
        order({ id: 'id-1', order_id: 'so-1', sync_requested_at: '2026-10-12T08:20:00.000Z' }),
        order({ id: 'id-2', order_id: 'so-2', sync_requested_at: '2026-10-12T08:10:00.000Z' }),
        order({ id: 'id-3', order_id: 'so-3', sync_requested_at: null }),
      ],
    });
    // Kön faller för den äldsta.
    failOn((c) => c.table === 'portal_outbound_events' && c.op === 'upsert' && JSON.stringify(c.values).includes('so-2'), { message: 'kön svarar inte' });
    expect(await sync(admin)).toEqual({ orders: 2, queued: 1, unchanged: 0, conflicts: 0, errors: 1 });
    expect(keys(tables)).toEqual([CONFIRMED_KEY]);
    expect(tables.crm_store_orders.map((r) => r.sync_requested_at)).toEqual([null, '2026-10-12T08:10:00.000Z', null]);

    const read = calls.find((c) => c.table === 'crm_store_orders' && c.op === 'select')!;
    expect(read.filters).toContainEqual(['notIs', 'sync_requested_at', null]);
    expect(read.order).toEqual({ column: 'sync_requested_at', ascending: true });
    expect(read.limit).toBe(100);

    const { admin: limited, calls: limitedCalls } = memoryAdmin({ crm_store_orders: [] });
    await syncStoreOrders(limited as never, { now: () => NOW, limit: 7 });
    expect(limitedCalls.find((c) => c.table === 'crm_store_orders')!.limit).toBe(7);
  });

  it('läsfel på listan kastar (cron skriver det i sammanfattningen)', async () => {
    const { admin, failOn } = memoryAdmin({ crm_store_orders: [order()] });
    failOn((c) => c.table === 'crm_store_orders' && c.op === 'select', { message: 'nere' });
    await expect(sync(admin)).rejects.toThrow('De markerade butiksbeställningarna gick inte att läsa: nere');
  });

  it('ett trasigt läge läses som tomt: en nyckel av fel typ räknas inte som köad', async () => {
    for (const sync_state of [['x'], { confirmedKey: 5, cancelled: 'true' }]) {
      const { admin, tables } = memoryAdmin({ crm_store_orders: [order({ sync_state })] });
      await sync(admin);
      expect(keys(tables)).toEqual([CONFIRMED_KEY]);
      expect(row(tables).sync_state).toEqual({ confirmedKey: CONFIRMED_KEY });
    }
  });
});

describe('markStoreOrderForSync', () => {
  it('markerar beställningen med portalens orderId', async () => {
    const { admin, tables } = memoryAdmin({
      crm_store_orders: [order({ id: 'id-1', order_id: 'so-1', sync_requested_at: null }), order({ id: 'id-2', order_id: 'so-2', sync_requested_at: null })],
    });
    await markStoreOrderForSync(admin as never, 'so-2', NOW);
    expect(tables.crm_store_orders.map((r) => r.sync_requested_at)).toEqual([null, NOW.toISOString()]);
  });

  it('ett fel kastar', async () => {
    const { admin, failOn } = memoryAdmin({ crm_store_orders: [order()] });
    failOn((c) => c.table === 'crm_store_orders', { message: 'nere' });
    await expect(markStoreOrderForSync(admin as never, 'so-1', NOW)).rejects.toThrow('Butiksbeställningen kunde inte markeras: nere');
  });
});
