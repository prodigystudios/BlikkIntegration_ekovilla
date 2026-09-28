import { describe, it, expect } from 'vitest';
import { requeueDeadPortalEvent } from '@/lib/domains/portal/outbox';
import { memoryAdmin } from './helpers/memoryAdmin';

// "Skicka om" på fliken Utskick (fas 4b). Bara den senaste för sin nyckel: annars hade en gammal job.scheduled kunnat
// komma fram efter en levererad job.completed (bara framåt), eller en gammal prislista efter en nyare.

const NOW = new Date('2026-10-12T08:00:00.000Z');
const ev = (id: string, seq: number, status: string, ordering_key = 'job:q-1') => ({
  id, seq, status, ordering_key, idempotency_key: `k-${id}`, attempts: 60, next_attempt_at: '2026-10-10T00:00:00.000Z',
  claimed_at: '2026-10-10T00:00:00.000Z', last_error: 'HTTP 404: okänt jobb',
});

describe('requeueDeadPortalEvent', () => {
  it('en uppgiven, den senaste för sitt jobb: tillbaka i kön med nya försök', async () => {
    const { admin, tables } = memoryAdmin({ portal_outbound_events: [ev('a', 1, 'sent'), ev('b', 2, 'dead')] });
    expect(await requeueDeadPortalEvent(admin, 'b', NOW)).toEqual({ kind: 'requeued', orderingKey: 'job:q-1' });
    expect(tables.portal_outbound_events[1]).toMatchObject({ status: 'pending', attempts: 0, next_attempt_at: NOW.toISOString(), claimed_at: null });
  });

  it('en senare händelse har gått iväg, väntar eller skickas: skickas inte om', async () => {
    for (const later of ['sent', 'pending', 'sending']) {
      const { admin, tables } = memoryAdmin({ portal_outbound_events: [ev('a', 1, 'dead'), ev('b', 2, later)] });
      expect(await requeueDeadPortalEvent(admin, 'a', NOW)).toEqual({ kind: 'superseded_by_later' });
      expect(tables.portal_outbound_events[0].status).toBe('dead');
    }
  });

  it('🧨 en senare som själv gett upp hindrar också: två uppgivna prislistor, och den äldre hade gett butikerna gamla priser', async () => {
    const { admin } = memoryAdmin({ portal_outbound_events: [ev('a', 1, 'dead', 'pricelist'), ev('b', 2, 'dead', 'pricelist')] });
    expect(await requeueDeadPortalEvent(admin, 'a', NOW)).toEqual({ kind: 'superseded_by_later' });
    expect((await requeueDeadPortalEvent(admin, 'b', NOW)).kind).toBe('requeued');
  });

  it('en senare ersatt planerad dag och andra jobbs händelser hindrar inte', async () => {
    const { admin } = memoryAdmin({ portal_outbound_events: [ev('a', 1, 'dead'), ev('c', 3, 'superseded'), ev('x', 4, 'sent', 'job:q-2')] });
    expect((await requeueDeadPortalEvent(admin, 'a', NOW)).kind).toBe('requeued');
  });

  it('inte uppgiven, eller finns inte', async () => {
    const { admin } = memoryAdmin({ portal_outbound_events: [ev('a', 1, 'sent')] });
    expect(await requeueDeadPortalEvent(admin, 'a', NOW)).toEqual({ kind: 'not_dead', status: 'sent' });
    expect(await requeueDeadPortalEvent(admin, 'nej', NOW)).toEqual({ kind: 'not_found' });
  });
});
