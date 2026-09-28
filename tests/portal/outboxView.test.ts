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
    expect(portalOutboxEventKind('job:q-1', { type: 'job.message' })).toBe('other');
  });

  it('det viktigaste ur kroppen', () => {
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: '2026-10-14', scheduledUntil: '2026-10-15' } })).toBe('2026-10-14 – 2026-10-15');
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: '2026-10-14', scheduledUntil: '2026-10-14' } })).toBe('2026-10-14');
    expect(portalOutboxEventDetail('job.scheduled', { data: { scheduledFor: null, scheduledUntil: null } })).toBe('Inte längre planerad');
    expect(portalOutboxEventDetail('job.confirmed', { data: { ekovillaOrderNumber: '26' } })).toBe('Order 26');
    expect(portalOutboxEventDetail('pricelist', { validFrom: '2026-10-01' })).toBe('Giltig från 2026-10-01');
    expect(portalOutboxEventDetail('job.cancelled', { data: {} })).toBeNull();
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
    expect(items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(items[1]).toMatchObject({
      kind: 'job.scheduled', detail: '2026-10-14 – 2026-10-15', status: 'dead', lastHttpStatus: 404, nextAttemptAt: null,
      job: { quoteId: 'q-1', quoteNumber: '2026-901', storeName: 'Sehed Bygg', workOrderId: 'wo-1' }, canRetry: true,
    });
    expect(items[0]).toMatchObject({ kind: 'pricelist', job: null, canRetry: false, nextAttemptAt: '2026-10-12T09:00:00.000Z' });
  });

  it('en uppgiven före något som gått iväg eller väntar kan inte skickas om', async () => {
    const { admin } = memoryAdmin({
      portal_outbound_events: [event({ id: 'b', seq: 2, status: 'dead' }), event({ id: 'd', seq: 4, status: 'sent' })],
      crm_portal_jobs: [],
    });
    const [item] = await listPortalOutboxAttention(admin);
    expect(item).toMatchObject({ id: 'b', canRetry: false, job: { quoteId: 'q-1', quoteNumber: null, storeName: null } });
  });

  it('en tom kö frågar inte efter jobben', async () => {
    const { admin, calls } = memoryAdmin({ portal_outbound_events: [event({ status: 'sent' })] });
    expect(await listPortalOutboxAttention(admin)).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(['portal_outbound_events']);
  });
});
