import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ett varv av portalens bakgrundsarbete (fas 4b): omräkning → utskick → (om något levererades) omräkning + utskick →
// Fortnox-försöken sist, bara inom tidsgränsen. Ett steg som kastar stoppar inte nästa.

const calls: string[] = [];
const sync = vi.fn();
const dispatch = vi.fn();
const retry = vi.fn();

vi.mock('@/lib/domains/portal/jobSync', () => ({ syncPortalJobs: (...a: unknown[]) => (calls.push('sync'), sync(...a)) }));
vi.mock('@/lib/domains/portal/outbox', () => ({ dispatchPortalOutbox: (...a: unknown[]) => (calls.push('dispatch'), dispatch(...a)) }));
vi.mock('@/lib/domains/portal/jobFortnoxRetry', () => ({ retryPortalFortnox: (...a: unknown[]) => (calls.push('fortnox'), retry(...a)) }));
vi.mock('@/lib/domains/portal/jobIntakeStore', () => ({ followUpPortalJob: vi.fn() }));

const { runPortalCron, PORTAL_CRON_FORTNOX_START_BEFORE_MS } = await import('@/lib/domains/portal/cron');

const SYNC = { jobs: 1, queued: 1, unchanged: 0, conflicts: 0, errors: 0 };
const SENT = { ran: true, claimed: 1, sent: 1, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
const NOTHING = { ...SENT, claimed: 0, sent: 0 };
const RETRY = { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 };

beforeEach(() => {
  calls.length = 0;
  sync.mockReset().mockResolvedValue(SYNC);
  dispatch.mockReset().mockResolvedValue(SENT);
  retry.mockReset().mockResolvedValue(RETRY);
});

describe('runPortalCron', () => {
  it('levererades något: omräkning och utskick en gång till, Fortnox sist', async () => {
    const summary = await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'dispatch', 'sync', 'dispatch', 'fortnox']);
    expect(summary).toMatchObject({ sync: SYNC, dispatch: SENT, resync: SYNC, redispatch: SENT, fortnox: RETRY });
  });

  it('inget levererat: ingen extra runda', async () => {
    dispatch.mockResolvedValue(NOTHING);
    await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'dispatch', 'fortnox']);
  });

  it('integrationen av: omräkningen och Fortnox görs ändå, kön ligger kvar', async () => {
    dispatch.mockResolvedValue({ ran: false, reason: 'av' });
    const summary = await runPortalCron({} as never, { env: {} });
    expect(calls).toEqual(['sync', 'dispatch', 'fortnox']);
    expect(summary.dispatch).toEqual({ ran: false, reason: 'av' });
  });

  it('ett steg som kastar stoppar inte nästa', async () => {
    sync.mockRejectedValue(new Error('databasen svarar inte'));
    const summary = await runPortalCron({} as never, { env: {} });
    expect(summary.sync).toEqual({ error: 'databasen svarar inte' });
    expect(calls).toContain('dispatch');
    expect(calls).toContain('fortnox');
  });

  it('Fortnox-försöken får resten av tidsgränsen, och inga när den är slut', async () => {
    let t = 0;
    dispatch.mockImplementation(async () => {
      t += 10_000;
      return NOTHING;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(retry.mock.calls[0][1].budgetMs).toBe(PORTAL_CRON_FORTNOX_START_BEFORE_MS - 10_000);

    calls.length = 0;
    dispatch.mockImplementation(async () => {
      t += PORTAL_CRON_FORTNOX_START_BEFORE_MS;
      return NOTHING;
    });
    await runPortalCron({} as never, { env: {}, now: () => new Date(t) });
    expect(calls).toEqual(['sync', 'dispatch']);
  });
});
