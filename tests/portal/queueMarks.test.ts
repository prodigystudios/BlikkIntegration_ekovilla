import { describe, it, expect, vi, afterEach } from 'vitest';
import { markPortalQueueForSync } from '@/lib/domains/portal/queueMarks';
import { memoryAdmin } from './helpers/memoryAdmin';

// "Skicka om" markerar det kön gäller (fas 4b och 8b3), så att det som väntat bakom en uppgiven bekräftelse följer.

const NOW = new Date('2026-10-12T08:30:00.000Z');
const tables = () => ({
  crm_portal_jobs: [{ quote_id: 'q-1', sync_requested_at: null }, { quote_id: 'q-2', sync_requested_at: null }],
  crm_store_orders: [{ id: 'id-1', order_id: 'so-1', sync_requested_at: null }, { id: 'id-2', order_id: 'so-2', sync_requested_at: null }],
});
const marks = (t: Record<string, Record<string, unknown>[]>) => ({
  jobs: t.crm_portal_jobs.map((r) => r.sync_requested_at),
  orders: t.crm_store_orders.map((r) => r.sync_requested_at),
});

afterEach(() => vi.restoreAllMocks());

describe('markPortalQueueForSync', () => {
  it('ett jobbs kö: jobbet markeras, ingen beställning', async () => {
    const { admin, tables: t } = memoryAdmin(tables());
    await markPortalQueueForSync(admin as never, 'job:q-2', NOW);
    expect(marks(t)).toEqual({ jobs: [null, NOW.toISOString()], orders: [null, null] });
  });

  it('en butiksbeställnings kö: beställningen markeras med portalens orderId, inget jobb', async () => {
    const { admin, tables: t } = memoryAdmin(tables());
    await markPortalQueueForSync(admin as never, 'store_order:so-2', NOW);
    expect(marks(t)).toEqual({ jobs: [null, null], orders: [null, NOW.toISOString()] });
  });

  it('prislistan och okända köer: ingenting', async () => {
    const { admin, tables: t, calls } = memoryAdmin(tables());
    for (const key of ['pricelist', 'annan:so-1', 'store_order', 'jobb:q-1']) await markPortalQueueForSync(admin as never, key, NOW);
    expect(marks(t)).toEqual({ jobs: [null, null], orders: [null, null] });
    expect(calls).toEqual([]);
  });

  it('en beställning som inte finns: en varning, inget fel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin } = memoryAdmin(tables());
    await markPortalQueueForSync(admin as never, 'store_order:so-okand', NOW);
    expect(warn).toHaveBeenCalledWith('[portal-requeue] ingen butiksbeställning att markera', { orderId: 'so-okand' });
    await markPortalQueueForSync(admin as never, 'store_order:so-1', NOW);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ett fel vid markeringen kastar (routen svarar 500)', async () => {
    const { admin, failOn } = memoryAdmin(tables());
    failOn((c) => c.table === 'crm_store_orders', { message: 'nere' });
    await expect(markPortalQueueForSync(admin as never, 'store_order:so-1', NOW)).rejects.toThrow('Butiksbeställningen kunde inte markeras: nere');
  });
});
