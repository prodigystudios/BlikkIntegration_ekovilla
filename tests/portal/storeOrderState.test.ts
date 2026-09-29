import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  deriveStoreOrderEvents,
  parseStoreOrderSyncState,
  storeOrderOrderingKey,
  type DeriveStoreOrderInput,
  type StoreOrderSyncRow,
  type StoreOrderSyncState,
} from '@/lib/domains/portal/storeOrderState';
import type { StoreOrderStatus } from '@/lib/domains/portal/storeOrders';
import { isValidIdempotencyKey } from '@/lib/domains/portal/idempotency';

// Vad butiken ser av sin beställning (fas 8b3). Händelserna byggs helt ur raden, "bekräftad" först när Fortnox-numret
// finns, inget efter den förrän den är levererad, "makulerad" utan bekräftelse och sedan ingenting.

// Körningens tid, skild från radens tider: ingen händelse får dateras med den.
const NOW = new Date('2026-10-12T08:30:00.000Z');
const CONFIRMED_AT = '2026-09-29T10:15:00.123+00:00';
const DELIVERED_AT = '2026-10-02T13:00:00.5+00:00';
const INVOICED_AT = '2026-10-05T07:45:10+00:00';
const CANCELLED_AT = '2026-09-30T09:00:00.25+00:00';

const row = (over: Partial<StoreOrderSyncRow> = {}): StoreOrderSyncRow => ({
  status: 'received',
  fortnoxOrderNumber: null,
  confirmedAt: null,
  deliveredOn: null,
  deliveredAt: null,
  invoicedOn: null,
  invoicedAt: null,
  cancelledAt: null,
  cancelReason: null,
  ...over,
});
const confirmedRow = (over: Partial<StoreOrderSyncRow> = {}) =>
  row({ status: 'confirmed', fortnoxOrderNumber: '74', confirmedAt: CONFIRMED_AT, ...over });
const deliveredRow = (over: Partial<StoreOrderSyncRow> = {}) =>
  confirmedRow({ status: 'delivered', deliveredOn: '2026-10-02', deliveredAt: DELIVERED_AT, ...over });
const invoicedRow = (over: Partial<StoreOrderSyncRow> = {}) =>
  deliveredRow({ status: 'invoiced', invoicedOn: '2026-10-05', invoicedAt: INVOICED_AT, ...over });
const cancelledRow = (over: Partial<StoreOrderSyncRow> = {}) =>
  row({ status: 'cancelled', cancelledAt: CANCELLED_AT, cancelReason: 'Butiken ringde och drog tillbaka.', ...over });

const CONFIRMED_KEY = 'store_order.confirmed-so-1-2026-09-29T10:15:00.123Z';
const QUEUED: StoreOrderSyncState = { confirmedKey: CONFIRMED_KEY };

function run(over: Partial<DeriveStoreOrderInput>) {
  const result = deriveStoreOrderEvents({
    orderId: 'so-1',
    order: row(),
    state: {},
    confirmedDelivery: 'missing',
    now: NOW,
    ...over,
  });
  return { ...result, types: result.events.map((e) => e.payload.type) };
}

describe('deriveStoreOrderEvents: mottagen och tillbakadragen', () => {
  it('ingenting, och inget att vänta på', () => {
    for (const status of ['received', 'withdrawn'] as const) {
      const r = run({ order: row({ status, fortnoxOrderNumber: '74', confirmedAt: CONFIRMED_AT }) });
      expect(r.types).toEqual([]);
      expect(r.revisit).toBe(false);
      expect(r.state).toEqual({});
    }
  });

  it('en okänd status ger ingenting (databasens check hindrar den, men utskicket läser en sträng)', () => {
    expect(run({ order: confirmedRow({ status: 'draft' as StoreOrderStatus }) }).types).toEqual([]);
  });
});

describe('deriveStoreOrderEvents: bekräftad', () => {
  it('bekräftad utan Fortnox-nummer: ingenting än (vakten markerar raden när numret skrivs)', () => {
    const r = run({ order: confirmedRow({ fortnoxOrderNumber: null }) });
    expect(r.types).toEqual([]);
    expect(r.revisit).toBe(false);
    expect(r.state).toEqual({});
  });

  it('numret finns: store_order.confirmed med numret och tiden då någon tryckte Bekräfta', () => {
    const r = run({ order: confirmedRow() });
    expect(r.types).toEqual(['store_order.confirmed']);
    expect(r.events[0].payload).toEqual({
      type: 'store_order.confirmed',
      occurredAt: '2026-09-29T10:15:00.123Z',
      data: { orderId: 'so-1', ekovillaOrderNumber: '74', confirmedAt: '2026-09-29T10:15:00.123Z' },
    });
    expect(r.state).toEqual({ confirmedKey: r.events[0].idempotencyKey });
    // Inget väntar bakom den.
    expect(r.revisit).toBe(false);
  });

  it('nyckeln har kontraktets form <event>-<id>-<tidpunkt>, med radens tid och inte körningens', () => {
    const r = run({ order: confirmedRow() });
    expect(r.events[0].idempotencyKey).toBe(CONFIRMED_KEY);
    expect(isValidIdempotencyKey(r.events[0].idempotencyKey)).toBe(true);
  });

  it('en rad utan tid (skriven för hand) får körningens tid', () => {
    for (const confirmedAt of [null, 'x']) {
      const r = run({ order: confirmedRow({ confirmedAt }) });
      expect(r.events[0].payload.occurredAt).toBe(NOW.toISOString());
      expect(r.events[0].payload.data.confirmedAt).toBe(NOW.toISOString());
    }
  });

  it('redan levererad eller fakturerad: bekräftad först, resten väntar tills den är levererad', () => {
    for (const order of [deliveredRow(), invoicedRow()]) {
      const r = run({ order });
      expect(r.types).toEqual(['store_order.confirmed']);
      expect(r.revisit).toBe(true);
    }
  });

  it('köad men inte levererad: ingenting nytt; räkna om bara när något väntar bakom den', () => {
    const idle = run({ state: QUEUED, confirmedDelivery: 'pending', order: confirmedRow() });
    expect(idle.types).toEqual([]);
    expect(idle.revisit).toBe(false);
    const waiting = run({ state: QUEUED, confirmedDelivery: 'pending', order: deliveredRow() });
    expect(waiting.types).toEqual([]);
    expect(waiting.revisit).toBe(true);
    expect(waiting.state).toEqual(QUEUED);
  });

  it('uppgiven eller borta: beställningen står still tills någon skickar om den', () => {
    for (const delivery of ['dead', 'missing'] as const) {
      const r = run({ state: QUEUED, confirmedDelivery: delivery, order: invoicedRow() });
      expect(r.types).toEqual([]);
      expect(r.revisit).toBe(false);
      expect(r.state).toEqual(QUEUED);
    }
  });

  it('levererad bekräftelse och bara bekräftad: ingenting mer', () => {
    const r = run({ state: QUEUED, confirmedDelivery: 'sent', order: confirmedRow() });
    expect(r.types).toEqual([]);
    expect(r.state).toEqual(QUEUED);
  });
});

describe('deriveStoreOrderEvents: levererad och fakturerad', () => {
  it('levererad: store_order.delivered med leveransdagen, daterad när knappen trycktes', () => {
    const r = run({ state: QUEUED, confirmedDelivery: 'sent', order: deliveredRow() });
    expect(r.types).toEqual(['store_order.delivered']);
    expect(r.events[0]).toEqual({
      idempotencyKey: 'store_order.delivered-so-1-2026-10-02T13:00:00.500Z',
      payload: { type: 'store_order.delivered', occurredAt: '2026-10-02T13:00:00.500Z', data: { orderId: 'so-1', deliveredAt: '2026-10-02' } },
    });
    expect(r.state).toEqual({ ...QUEUED, delivered: true });
    expect(r.revisit).toBe(false);
  });

  it('fakturerad utan att levererad köats: båda, i ordning', () => {
    const r = run({ state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow() });
    expect(r.types).toEqual(['store_order.delivered', 'store_order.invoiced']);
    expect(r.events[0].payload.data).toEqual({ orderId: 'so-1', deliveredAt: '2026-10-02' });
    expect(r.events[1]).toEqual({
      idempotencyKey: 'store_order.invoiced-so-1-2026-10-05T07:45:10.000Z',
      payload: { type: 'store_order.invoiced', occurredAt: '2026-10-05T07:45:10.000Z', data: { orderId: 'so-1', invoicedAt: '2026-10-05' } },
    });
    expect(r.state).toEqual({ ...QUEUED, delivered: true, invoiced: true });
  });

  it('levererad redan köad: bara fakturerad', () => {
    const r = run({ state: { ...QUEUED, delivered: true }, confirmedDelivery: 'sent', order: invoicedRow() });
    expect(r.types).toEqual(['store_order.invoiced']);
  });

  it('allt köat: ingenting, också om bekräftelsen sedan gett upp', () => {
    for (const delivery of ['sent', 'dead'] as const) {
      const r = run({ state: { ...QUEUED, delivered: true, invoiced: true }, confirmedDelivery: delivery, order: invoicedRow() });
      expect(r.types).toEqual([]);
      expect(r.revisit).toBe(false);
    }
  });

  it('statusen avgör, inte dagen: en bekräftad med en leveransdag är inte levererad', () => {
    const queued = run({ state: QUEUED, confirmedDelivery: 'sent', order: confirmedRow({ deliveredOn: '2026-10-02', deliveredAt: DELIVERED_AT }) });
    expect(queued.types).toEqual([]);
    const first = run({ order: confirmedRow({ deliveredOn: '2026-10-02', deliveredAt: DELIVERED_AT }) });
    expect(first.types).toEqual(['store_order.confirmed']);
    expect(first.revisit).toBe(false);
  });

  it('statusen avgör, inte dagen: en levererad med en fakturadag är inte fakturerad', () => {
    const r = run({ state: QUEUED, confirmedDelivery: 'sent', order: deliveredRow({ invoicedOn: '2026-10-05', invoicedAt: INVOICED_AT }) });
    expect(r.types).toEqual(['store_order.delivered']);
  });

  it('ett läge med fakturan har också leveransen: ingen leverans köas efter fakturan', () => {
    const r = run({ state: { ...QUEUED, invoiced: true }, confirmedDelivery: 'sent', order: invoicedRow() });
    expect(r.types).toEqual([]);
    expect(r.revisit).toBe(false);
    expect(r.state).toEqual({ ...QUEUED, delivered: true, invoiced: true });
  });

  it('en händelse utan sin dag skickas inte (portalen hade nekat den)', () => {
    const noDelivery = run({ state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow({ deliveredOn: null }) });
    expect(noDelivery.types).toEqual([]);
    const noInvoice = run({ state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow({ invoicedOn: null }) });
    expect(noInvoice.types).toEqual(['store_order.delivered']);
    // Bekräftelsen går ändå.
    expect(run({ order: deliveredRow({ deliveredOn: null }) }).types).toEqual(['store_order.confirmed']);
  });

  it('en rad utan tidpunkt (skriven för hand) dateras med dagens början, aldrig med körningens tid', () => {
    for (const time of [null, 'x']) {
      const r = run({ state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow({ deliveredAt: time, invoicedAt: time }) });
      expect(r.events.map((e) => e.payload.occurredAt)).toEqual(['2026-10-02T00:00:00.000Z', '2026-10-05T00:00:00.000Z']);
      expect(r.events[0].idempotencyKey).toBe('store_order.delivered-so-1-2026-10-02T00:00:00.000Z');
    }
  });
});

describe('deriveStoreOrderEvents: makulerad', () => {
  it('en mottagen som makulerats: store_order.cancelled med skälet, daterad vid makuleringen', () => {
    const r = run({ order: cancelledRow() });
    expect(r.events).toEqual([
      {
        idempotencyKey: 'store_order.cancelled-so-1-2026-09-30T09:00:00.250Z',
        payload: {
          type: 'store_order.cancelled',
          occurredAt: '2026-09-30T09:00:00.250Z',
          data: { orderId: 'so-1', reason: 'Butiken ringde och drog tillbaka.' },
        },
      },
    ]);
    expect(r.state).toEqual({ cancelled: true });
    expect(r.revisit).toBe(false);
  });

  it('makulerad med ett Fortnox-nummer men aldrig bekräftad hos butiken: bara makuleringen', () => {
    const r = run({ order: cancelledRow({ fortnoxOrderNumber: '53', confirmedAt: CONFIRMED_AT }) });
    expect(r.types).toEqual(['store_order.cancelled']);
  });

  it('makulerad efter bekräftelsen: köas direkt, vad bekräftelsen än väntar på', () => {
    for (const delivery of ['sent', 'pending', 'dead', 'missing'] as const) {
      const r = run({ state: QUEUED, confirmedDelivery: delivery, order: cancelledRow({ fortnoxOrderNumber: '66' }) });
      expect(r.types).toEqual(['store_order.cancelled']);
      expect(r.state).toEqual({ ...QUEUED, cancelled: true });
      expect(r.revisit).toBe(false);
    }
  });

  it('efter makuleringen köas ingenting mer, hur raden än ser ut', () => {
    for (const order of [cancelledRow(), invoicedRow(), confirmedRow()]) {
      const r = run({ state: { ...QUEUED, cancelled: true }, confirmedDelivery: 'sent', order });
      expect(r.types).toEqual([]);
      expect(r.revisit).toBe(false);
    }
  });

  it('ett saknat skäl blir en tom sträng, och tiden körningens', () => {
    const r = run({ order: cancelledRow({ cancelReason: null, cancelledAt: null }) });
    expect(r.events[0].payload.data.reason).toBe('');
    expect(r.events[0].payload.occurredAt).toBe(NOW.toISOString());
  });
});

describe('deriveStoreOrderEvents: samma rad ger samma händelser', () => {
  // Utskicket köar FÖRST och sparar läget sedan. Dör det mellan de två räknar nästa varv fram samma nycklar och samma
  // kroppar, och kön känner igen dem. Körningens tid får alltså aldrig påverka en händelse.
  const cases: [string, Partial<DeriveStoreOrderInput>][] = [
    ['bekräftad', { order: invoicedRow() }],
    ['levererad och fakturerad', { state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow() }],
    ['makulerad', { order: cancelledRow({ fortnoxOrderNumber: '66' }) }],
    ['levererad och fakturerad utan tider', { state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow({ deliveredAt: null, invoicedAt: null }) }],
  ];
  it.each(cases)('%s', (_, input) => {
    const first = run({ ...input, now: NOW });
    const later = run({ ...input, now: new Date('2026-10-13T00:00:00.000Z') });
    expect(first.events.length).toBeGreaterThan(0);
    expect(later.events).toEqual(first.events);
    expect(later.state).toEqual(first.state);
  });

  it('en krasch efter att bekräftelsen köats: nästa varv köar samma nyckel igen, och sedan resten', () => {
    const crashed = run({ order: invoicedRow() });
    // Läget sparades aldrig, men händelsen hann köas och skickas.
    const retry = run({ order: invoicedRow(), confirmedDelivery: 'sent' });
    expect(retry.events).toEqual(crashed.events);
    const next = run({ order: invoicedRow(), state: retry.state, confirmedDelivery: 'sent' });
    expect(next.types).toEqual(['store_order.delivered', 'store_order.invoiced']);
  });

  it('läget in ändras inte', () => {
    const state: StoreOrderSyncState = { ...QUEUED };
    run({ state, confirmedDelivery: 'sent', order: invoicedRow() });
    expect(state).toEqual(QUEUED);
  });
});

describe('storeOrderOrderingKey', () => {
  it('en egen kö per beställning, skild från jobbens', () => {
    expect(storeOrderOrderingKey('so-1')).toBe('store_order:so-1');
  });
});

describe('parseStoreOrderSyncState', () => {
  it('läser det som sparats', () => {
    const state = { confirmedKey: CONFIRMED_KEY, delivered: true, invoiced: true, cancelled: true };
    expect(parseStoreOrderSyncState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('okända eller trasiga fält tas bort', () => {
    expect(parseStoreOrderSyncState(null)).toEqual({});
    expect(parseStoreOrderSyncState([])).toEqual({});
    expect(parseStoreOrderSyncState('x')).toEqual({});
    expect(
      parseStoreOrderSyncState({ confirmedKey: '', delivered: 'true', invoiced: 1, cancelled: {}, scheduled: { for: null } }),
    ).toEqual({});
    expect(parseStoreOrderSyncState({ confirmedKey: 5 })).toEqual({});
  });
});

describe('kontraktet: portalens schema för store_order.*', () => {
  // Speglar portalens lib/crm/events.ts @ e9b55aa (zod 4 där, zod 3 här). Ändras portalens schema ska det här ändras.
  const portalId = z.string().regex(/^(?!\.+$)[A-Za-z0-9._~-]{1,100}$/);
  const isoDate = z.string().date();
  const isoDateTime = z.string().datetime({ offset: true });
  const portalSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('store_order.confirmed'),
      occurredAt: isoDateTime,
      data: z.object({ orderId: portalId, ekovillaOrderNumber: z.string().trim().min(1).max(50), confirmedAt: isoDateTime }).strict(),
    }).strict(),
    z.object({
      type: z.literal('store_order.delivered'),
      occurredAt: isoDateTime,
      data: z.object({ orderId: portalId, deliveredAt: isoDate }).strict(),
    }).strict(),
    z.object({
      type: z.literal('store_order.invoiced'),
      occurredAt: isoDateTime,
      data: z.object({ orderId: portalId, invoicedAt: isoDate }).strict(),
    }).strict(),
    z.object({
      type: z.literal('store_order.cancelled'),
      occurredAt: isoDateTime,
      // Krävs, till skillnad från job.cancelled.
      data: z.object({ orderId: portalId, reason: z.string().trim().max(2000) }).strict(),
    }).strict(),
  ]);

  it('varje händelse funktionen ger tas emot av portalen, och nycklarna är giltiga', () => {
    const orderId = 'b1c2d3e4-0000-4000-8000-000000000001';
    const events = [
      ...run({ orderId, order: invoicedRow() }).events,
      ...run({ orderId, state: QUEUED, confirmedDelivery: 'sent', order: invoicedRow() }).events,
      ...run({ orderId, order: cancelledRow({ cancelReason: 'x'.repeat(2000) }) }).events,
    ];
    expect(events.map((e) => e.payload.type)).toEqual([
      'store_order.confirmed',
      'store_order.delivered',
      'store_order.invoiced',
      'store_order.cancelled',
    ]);
    for (const e of events) {
      expect(portalSchema.safeParse(e.payload).success, JSON.stringify(e.payload)).toBe(true);
      expect(isValidIdempotencyKey(e.idempotencyKey), e.idempotencyKey).toBe(true);
    }
  });
});
