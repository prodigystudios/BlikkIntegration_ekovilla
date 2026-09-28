import { describe, it, expect, vi } from 'vitest';
import {
  PORTAL_OUTBOX_MAX_ATTEMPTS,
  dispatchPortalOutbox,
  enqueuePortalEvent,
  outcomeUpdate,
  retryDelaySeconds,
} from '@/lib/domains/portal/outbox';

const NOW = new Date('2026-09-28T08:00:00.000Z');
const SECRET = 'a'.repeat(64);
const LOCAL_ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:55321',
  PORTAL_CRM_SHARED_SECRET: SECRET,
  RESELLER_PORTAL_URL: 'http://localhost:3001',
};

describe('retryDelaySeconds', () => {
  it('fördubblas från 30 sekunder och stannar på en timme', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
    expect(retryDelaySeconds(PORTAL_OUTBOX_MAX_ATTEMPTS)).toBe(3600);
    expect(retryDelaySeconds(0)).toBe(30);
  });
});

describe('outcomeUpdate', () => {
  const response = (status: number, body = '') => ({ kind: 'response' as const, status, bodyExcerpt: body });

  it('2xx: levererad, med tid', () => {
    expect(outcomeUpdate({ attempts: 1 }, response(202), NOW)).toEqual({
      status: 'sent',
      sent_at: NOW.toISOString(),
      last_http_status: 202,
      last_error: null,
    });
  });

  it('5xx och 401: tillbaka i kön med nästa försök enligt fördröjningen', () => {
    expect(outcomeUpdate({ attempts: 3 }, response(503, 'upptagen'), NOW)).toEqual({
      status: 'pending',
      next_attempt_at: new Date(NOW.getTime() + 120_000).toISOString(),
      last_http_status: 503,
      last_error: 'HTTP 503: upptagen',
    });
    expect(outcomeUpdate({ attempts: 1 }, response(401), NOW)).toMatchObject({ status: 'pending', last_http_status: 401 });
    expect(outcomeUpdate({ attempts: 1 }, { kind: 'timeout' }, NOW)).toMatchObject({ status: 'pending', last_error: 'timeout' });
  });

  it('409 och andra 4xx: uppgiven, med orsaken kvar', () => {
    expect(outcomeUpdate({ attempts: 1 }, response(409, 'redan bekräftad'), NOW)).toEqual({
      status: 'dead',
      last_http_status: 409,
      last_error: 'HTTP 409: redan bekräftad',
    });
  });

  it('efter sista försöket ges även ett tillfälligt fel upp', () => {
    expect(outcomeUpdate({ attempts: PORTAL_OUTBOX_MAX_ATTEMPTS }, response(503), NOW)).toMatchObject({ status: 'dead' });
    expect(outcomeUpdate({ attempts: PORTAL_OUTBOX_MAX_ATTEMPTS - 1 }, response(503), NOW)).toMatchObject({ status: 'pending' });
  });
});

/** En minimal service-roll-klient som spelar in anropen. */
function fakeAdmin(claimed: unknown[] = []) {
  const calls: { table: string; op: string; values?: unknown; filters: [string, string, unknown][] }[] = [];
  function builder(table: string) {
    const call = { table, op: '', values: undefined as unknown, filters: [] as [string, string, unknown][] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['update', 'upsert', 'insert', 'select', 'delete']) {
      chain[op] = vi.fn((values?: unknown) => {
        if (!call.op) {
          call.op = op;
          call.values = values;
        }
        return chain;
      });
    }
    for (const f of ['eq', 'neq', 'lte', 'lt']) {
      chain[f] = vi.fn((column: string, value: unknown) => {
        call.filters.push([f, column, value]);
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: call.op === 'upsert' ? [{ id: 'new-id', created_at: NOW.toISOString() }] : [], error: null }).then(resolve);
    return chain;
  }
  const rpc = vi.fn(async () => ({ data: claimed, error: null }));
  return { admin: { from: vi.fn(builder), rpc } as never, calls, rpc };
}

describe('enqueuePortalEvent', () => {
  it('köar bara till portalens egna routes', async () => {
    const { admin } = fakeAdmin();
    await expect(
      enqueuePortalEvent(admin, { idempotencyKey: 'k', path: 'https://example.com/x', payload: {}, orderingKey: 'job:1' }),
    ).rejects.toThrow(/portalroute/);
  });

  it('ersätter äldre väntande händelser med samma supersedeKey, men inte den nya', async () => {
    const { admin, calls } = fakeAdmin();
    const result = await enqueuePortalEvent(admin, {
      idempotencyKey: 'job.scheduled-q-1-2026-09-28T08:00:00Z',
      path: '/api/ekovilla/events',
      payload: { type: 'job.scheduled' },
      orderingKey: 'job:q-1',
      supersedeKey: 'job.scheduled:q-1',
    });
    expect(result).toEqual({ id: 'new-id', created: true });
    const supersede = calls.find((c) => c.op === 'update');
    expect(supersede?.values).toEqual({ status: 'superseded' });
    expect(supersede?.filters).toEqual([
      ['eq', 'supersede_key', 'job.scheduled:q-1'],
      ['eq', 'status', 'pending'],
      ['neq', 'id', 'new-id'],
      ['lte', 'created_at', NOW.toISOString()],
    ]);
  });
});

describe('dispatchPortalOutbox', () => {
  const event = {
    id: 'ev-1',
    idempotency_key: 'job.confirmed-q-1',
    path: '/api/ekovilla/events',
    payload: { type: 'job.confirmed' },
    attempts: 1,
    claimed_at: '2026-09-28T07:59:59.000000+00:00',
  };

  it('🧨 tar ingenting ur kön när integrationen är avstängd — händelserna väntar', async () => {
    const { admin, rpc } = fakeAdmin([event]);
    const fetchImpl = vi.fn();
    const summary = await dispatchPortalOutbox(admin, { env: { ...LOCAL_ENV, PORTAL_CRM_SHARED_SECRET: '' }, fetchImpl, now: () => NOW });
    expect(summary).toMatchObject({ ran: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🧨 skickar aldrig till en portal som miljön inte får nå', async () => {
    const { admin, rpc } = fakeAdmin([event]);
    const fetchImpl = vi.fn();
    const summary = await dispatchPortalOutbox(admin, {
      env: { ...LOCAL_ENV, RESELLER_PORTAL_URL: 'https://partner.ekovilla.se' },
      fetchImpl,
      now: () => NOW,
    });
    expect(summary).toMatchObject({ ran: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skickar det som tagits och bokför resultatet bara om claimen fortfarande är vår', async () => {
    const { admin, calls, rpc } = fakeAdmin([event]);
    const fetchImpl = vi.fn(async () => new Response('', { status: 202 })) as unknown as typeof fetch;
    const summary = await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW });

    expect(rpc).toHaveBeenCalledWith('claim_portal_outbound_events', { p_limit: 20 });
    expect(summary).toEqual({ ran: true, claimed: 1, sent: 1, retried: 0, dead: 0, bookkeepingErrors: 0 });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3001/api/ekovilla/events');

    const booked = calls.find((c) => c.table === 'portal_outbound_events' && c.op === 'update');
    expect(booked?.values).toMatchObject({ status: 'sent' });
    expect(booked?.filters).toEqual([
      ['eq', 'id', 'ev-1'],
      ['eq', 'status', 'sending'],
      ['eq', 'claimed_at', event.claimed_at],
    ]);
  });

  it('räknar tillfälliga fel och uppgivna var för sig', async () => {
    const { admin } = fakeAdmin([event, { ...event, id: 'ev-2', idempotency_key: 'job.confirmed-q-2' }]);
    const statuses = [503, 409];
    const fetchImpl = vi.fn(async () => new Response('', { status: statuses.shift() })) as unknown as typeof fetch;
    const summary = await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW });
    expect(summary).toEqual({ ran: true, claimed: 2, sent: 0, retried: 1, dead: 1, bookkeepingErrors: 0 });
  });
});
