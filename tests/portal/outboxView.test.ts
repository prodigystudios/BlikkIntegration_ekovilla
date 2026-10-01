import { describe, it, expect } from 'vitest';
import { listPortalOutboxAttention, portalOutboxEventDetail, portalOutboxEventKind } from '@/lib/domains/portal/outboxView';
import { memoryAdmin } from './helpers/memoryAdmin';

// Fliken Utskick (fas 4b): väntande och uppgivna händelser, vad de gäller, och om de kan skickas om.

const event = (over: Record<string, unknown>) => ({
  id: 'e', seq: 1, idempotency_key: 'k', ordering_key: 'job:q-1', status: 'dead', attempts: 60,
  last_http_status: 404, last_error: 'HTTP 404: okänt jobb', created_at: '2026-10-12T08:00:00.000Z',
  next_attempt_at: '2026-10-12T09:00:00.000Z', payload: { type: 'job.scheduled', data: { scheduledFor: '2026-10-14', scheduledUntil: '2026-10-15' } },
  ...over,
});

describe('portalOutboxEventKind / Detail', () => {
  it('känner igen prislistan och jobbens händelser', () => {
    expect(portalOutboxEventKind('pricelist', { validFrom: '2026-10-01' })).toBe('pricelist');
    expect(portalOutboxEventKind('job:q-1', { type: 'job.cancelled' })).toBe('job.cancelled');
    expect(portalOutboxEventKind('job:q-1', { type: 'job.message' })).toBe('job.message');
    expect(portalOutboxEventKind('job:q-1', { type: 'job.document' })).toBe('job.document');
    expect(portalOutboxEventKind('job:q-1', { type: 'job.okand' })).toBe('other');
  });

  it('det viktigaste ur kroppen', () => {
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: '2026-10-14', scheduledUntil: '2026-10-15' } })).toBe('2026-10-14 – 2026-10-15');
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: '2026-10-14', scheduledUntil: '2026-10-14' } })).toBe('2026-10-14');
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: null, scheduledUntil: null } })).toBe('Inte längre planerad');
    expect(portalOutboxEventDetail('job.confirmed', { data: { ekovillaOrderNumber: '26' } })).toBe('Order 26');
    expect(portalOutboxEventDetail('pricelist', { validFrom: '2026-10-01' })).toBe('Giltig från 2026-10-01');
    // En butiks egen lista (10b2): samma sort, i butikens ordning, och detaljen säger att listan är butikens.
    expect(portalOutboxEventKind('pricelist:res-a', { validFrom: '2026-10-01', resellerId: 'res-a' })).toBe('pricelist');
    expect(portalOutboxEventDetail('pricelist', { validFrom: '2026-10-01', resellerId: 'res-a' })).toBe(
      'Giltig från 2026-10-01, butikens egen lista',
    );
    expect(portalOutboxEventDetail('job.cancelled', { data: {} })).toBeNull();
    expect(portalOutboxEventDetail('job.message', { data: { authorName: 'Anna Berg', body: 'Hej' } })).toBe('Anna Berg');
    // Dokumentets kropp i kön har namnet och en referens, aldrig innehållet (fas 7).
    expect(
      portalOutboxEventDetail('job.document', {
        data: { quoteId: 'q-1', kind: 'order_confirmation', name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf' },
        contentRef: { documentId: 'd', sha256: 'x', bytes: 10 },
      }),
    ).toBe('Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf');
  });
});

describe('portalOutboxEventKind / Detail: butiksbeställningarna (fas 8b3)', () => {
  it('känner igen store_order.*', () => {
    for (const type of ['store_order.confirmed', 'store_order.delivered', 'store_order.invoiced', 'store_order.cancelled']) {
      expect(portalOutboxEventKind('store_order:so-1', { type })).toBe(type);
    }
    expect(portalOutboxEventKind('store_order:so-1', { type: 'store_order.okand' })).toBe('other');
  });

  it('numret, dagarna och skälets början', () => {
    expect(portalOutboxEventDetail('store_order.confirmed', { data: { ekovillaOrderNumber: '74' } })).toBe('Order 74');
    expect(portalOutboxEventDetail('store_order.delivered', { data: { deliveredAt: '2026-10-02' } })).toBe('2026-10-02');
    expect(portalOutboxEventDetail('store_order.invoiced', { data: { invoicedAt: '2026-10-05' } })).toBe('2026-10-05');
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: 'Butiken ringde.' } })).toBe('Butiken ringde.');
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: '' } })).toBeNull();
    // 80 tecken står kvar; ett längre skäl kapas till 79 och en ellips, utan att dela ett emoji.
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: 'x'.repeat(80) } })).toBe('x'.repeat(80));
    const long = `${'x'.repeat(78)}😀😀😀`;
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: long } })).toBe(`${'x'.repeat(78)}😀…`);
    // En sammansatt emoji och en flagga är ett tecken var för läsaren, och delas aldrig.
    const family = '👨‍👩‍👧';
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: `${'x'.repeat(78)}${family}🇸🇪x` } })).toBe(`${'x'.repeat(78)}${family}…`);
    expect(portalOutboxEventDetail('store_order.cancelled', { data: { reason: `${'x'.repeat(79)}${family}` } })).toBe(`${'x'.repeat(79)}${family}`);
  });
});

describe('listPortalOutboxAttention', () => {
  it('uppgivna och väntande, nyast först, med jobbets butik och offert; skickade visas inte', async () => {
    const { admin } = memoryAdmin({
      portal_outbound_events: [
        event({ id: 'a', seq: 1, status: 'sent' }),
        event({ id: 'b', seq: 2, status: 'dead' }),
        event({ id: 'c', seq: 3, status: 'pending', attempts: 2, ordering_key: 'pricelist', payload: { validFrom: '2026-10-01' } }),
      ],
      crm_portal_jobs: [{ quote_id: 'q-1', quote_number: '2026-901', store_name: 'Sehed Bygg', work_order_id: 'wo-1' }],
    });
    const items = await listPortalOutboxAttention(admin);
    expect(items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(items[0]).toMatchObject({
      kind: 'job.scheduled', detail: '2026-10-14 – 2026-10-15', status: 'dead', lastHttpStatus: 404, nextAttemptAt: null,
      job: { quoteId: 'q-1', quoteNumber: '2026-901', storeName: 'Sehed Bygg', workOrderId: 'wo-1' }, canRetry: true,
    });
    expect(items[1]).toMatchObject({ kind: 'pricelist', job: null, canRetry: false, nextAttemptAt: '2026-10-12T09:00:00.000Z' });
  });

  it('en uppgiven före något som gått iväg, väntar eller själv gett upp kan inte skickas om', async () => {
    for (const later of ['sent', 'pending', 'dead']) {
      const { admin } = memoryAdmin({
        portal_outbound_events: [event({ id: 'b', seq: 2, status: 'dead' }), event({ id: 'd', seq: 4, status: later })],
        crm_portal_jobs: [],
      });
      const item = (await listPortalOutboxAttention(admin)).find((i) => i.id === 'b');
      expect(item).toMatchObject({ canRetry: false, job: { quoteId: 'q-1', quoteNumber: null, storeName: null } });
    }
  });

  it('en lång kö av väntande trycker aldrig ut en uppgiven', async () => {
    const { admin } = memoryAdmin({
      portal_outbound_events: [
        event({ id: 'gammal', seq: 1, status: 'dead', ordering_key: 'job:q-9' }),
        event({ id: 'p1', seq: 2, status: 'pending' }),
        event({ id: 'p2', seq: 3, status: 'pending' }),
      ],
      crm_portal_jobs: [],
    });
    const items = await listPortalOutboxAttention(admin, 1);
    expect(items.map((i) => i.id)).toEqual(['gammal', 'p2']);
  });

  it('en butiksbeställnings händelse: beställningens butik och nummer, ingen jobbuppgift', async () => {
    const { admin, calls } = memoryAdmin({
      portal_outbound_events: [
        event({ id: 'b', seq: 2, ordering_key: 'store_order:so-1', payload: { type: 'store_order.delivered', data: { deliveredAt: '2026-10-02' } } }),
        event({ id: 'c', seq: 3, status: 'pending', ordering_key: 'store_order:so-okand', payload: { type: 'store_order.confirmed', data: { ekovillaOrderNumber: '74' } } }),
      ],
      crm_store_orders: [
        { id: 'id-1', order_id: 'so-1', order_number: 'B-2026-003', store_name: 'Sehed Bygg' },
        { id: 'id-2', order_id: 'so-2', order_number: 'B-2026-004', store_name: 'Boli' },
      ],
    });
    const items = await listPortalOutboxAttention(admin);
    expect(items.find((i) => i.id === 'b')).toMatchObject({
      kind: 'store_order.delivered',
      detail: '2026-10-02',
      job: null,
      storeOrder: { orderId: 'so-1', id: 'id-1', orderNumber: 'B-2026-003', storeName: 'Sehed Bygg' },
      canRetry: true,
    });
    expect(items.find((i) => i.id === 'c')).toMatchObject({
      job: null,
      storeOrder: { orderId: 'so-okand', id: null, orderNumber: null, storeName: null },
    });
    const read = calls.find((c) => c.table === 'crm_store_orders')!;
    expect(read.filters).toContainEqual(['in', 'order_id', ['so-1', 'so-okand']]);
    expect(calls.some((c) => c.table === 'crm_portal_jobs')).toBe(false);
  });

  it('ett jobbs händelse har ingen beställning, och beställningarna läses inte', async () => {
    const { admin, calls } = memoryAdmin({ portal_outbound_events: [event({})], crm_portal_jobs: [] });
    const [item] = await listPortalOutboxAttention(admin);
    expect(item.storeOrder).toBeNull();
    expect(calls.some((c) => c.table === 'crm_store_orders')).toBe(false);
  });

  it('beställningarna går inte att läsa: fel, som för jobben', async () => {
    const { admin, failOn } = memoryAdmin({
      portal_outbound_events: [event({ ordering_key: 'store_order:so-1', payload: { type: 'store_order.confirmed', data: {} } })],
      crm_store_orders: [],
    });
    failOn((c) => c.table === 'crm_store_orders', { message: 'nere' });
    await expect(listPortalOutboxAttention(admin)).rejects.toThrow('Butiksbeställningarna gick inte att läsa: nere');
  });

  it('en tom kö frågar inte efter jobben', async () => {
    const { admin, calls } = memoryAdmin({ portal_outbound_events: [event({ status: 'sent' })] });
    expect(await listPortalOutboxAttention(admin)).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(['portal_outbound_events', 'portal_outbound_events']);
  });
});
