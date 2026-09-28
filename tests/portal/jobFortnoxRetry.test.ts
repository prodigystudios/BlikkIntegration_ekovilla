import { describe, it, expect, vi } from 'vitest';
import {
  PORTAL_FORTNOX_LEASE_MS,
  planPortalFortnoxRetry,
  portalFortnoxRetryDelayMs,
  portalFortnoxSafetyNet,
  retryPortalFortnox,
} from '@/lib/domains/portal/jobFortnoxRetry';
import { memoryAdmin } from './helpers/memoryAdmin';

// Fortnox-omförsöken för portalens jobb (William 2026-09-28): 5 min, 15 min, 1 h, sedan varje timme i 24 h, bara
// efter tekniska fel. Kontrollerna och bokföringen görs av followUpPortalJob (se jobIntakeStore.test.ts).

const NOW = new Date('2026-10-12T08:00:00.000Z');
const plus = (ms: number, from = NOW) => new Date(from.getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('portalFortnoxRetryDelayMs', () => {
  it('5 min, 15 min, sedan en timme', () => {
    expect([1, 2, 3, 4, 10].map(portalFortnoxRetryDelayMs)).toEqual([5 * MIN, 15 * MIN, HOUR, HOUR, HOUR]);
    expect(portalFortnoxRetryDelayMs(0)).toBe(5 * MIN);
  });
});

describe('planPortalFortnoxRetry', () => {
  const until = plus(24 * HOUR);

  it('tekniskt fel: försöket räknas, nästa efter väntan, fönstret står kvar', () => {
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 0, retryUntil: until, now: NOW })).toEqual({
      fortnox_next_attempt_at: plus(5 * MIN), fortnox_attempts: 1, fortnox_retry_until: until,
    });
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 3, retryUntil: until, now: NOW }).fortnox_next_attempt_at).toBe(plus(HOUR));
  });

  it('första felet utan fönster (kopplingen av kund): fönstret börjar nu', () => {
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 0, retryUntil: null, now: NOW })).toMatchObject({
      fortnox_retry_until: plus(24 * HOUR), fortnox_next_attempt_at: plus(5 * MIN),
    });
  });

  it('nästa försök efter fönstret: ges upp (null), sedan bara för hand', () => {
    const late = new Date(new Date(until).getTime() - 30 * MIN);
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 5, retryUntil: until, now: late })).toMatchObject({
      fortnox_next_attempt_at: null, fortnox_attempts: 6,
    });
    // Precis på gränsen räknas det ännu.
    const edge = new Date(new Date(until).getTime() - HOUR);
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 5, retryUntil: until, now: edge }).fortnox_next_attempt_at).toBe(until);
  });

  it('klart, stoppat av kontrollerna eller ingen order: inget mer', () => {
    for (const outcome of ['created', 'exists', 'blocked', 'skipped'] as const) {
      expect(planPortalFortnoxRetry({ outcome, attempts: 2, retryUntil: until, now: NOW })).toEqual({
        fortnox_next_attempt_at: null, fortnox_attempts: 2, fortnox_retry_until: until,
      });
    }
  });

  it('en push som pågår: om 5 min, inget räknat', () => {
    expect(planPortalFortnoxRetry({ outcome: 'in_progress', attempts: 1, retryUntil: until, now: NOW })).toEqual({
      fortnox_next_attempt_at: plus(5 * MIN), fortnox_attempts: 1, fortnox_retry_until: until,
    });
  });

  it('en notis gick inte fram: ett varv till om 5 min när Fortnox-ordern finns', () => {
    expect(planPortalFortnoxRetry({ outcome: 'created', attempts: 0, retryUntil: until, now: NOW, resendNotice: true }).fortnox_next_attempt_at).toBe(plus(5 * MIN));
    expect(planPortalFortnoxRetry({ outcome: 'exists', attempts: 0, retryUntil: until, now: NOW, resendNotice: true }).fortnox_next_attempt_at).toBe(plus(5 * MIN));
    expect(planPortalFortnoxRetry({ outcome: 'skipped', attempts: 0, retryUntil: until, now: NOW, resendNotice: true }).fortnox_next_attempt_at).toBeNull();
  });

  it('🧨 ett stoppat jobb får aldrig ett varv till, inte ens för en notis: rättas kortet under tiden hade ordern pushats', () => {
    expect(planPortalFortnoxRetry({ outcome: 'blocked', attempts: 0, retryUntil: until, now: NOW, resendNotice: true }).fortnox_next_attempt_at).toBeNull();
  });

  it('ett fel när fönstret gått ut (kunden kopplad dagar efter intaget): nytt fönster från nu, försöken från noll', () => {
    const old = plus(-HOUR);
    expect(planPortalFortnoxRetry({ outcome: 'failed', attempts: 7, retryUntil: old, now: NOW })).toEqual({
      fortnox_next_attempt_at: plus(5 * MIN), fortnox_attempts: 1, fortnox_retry_until: plus(24 * HOUR),
    });
  });
});

describe('portalFortnoxSafetyNet', () => {
  it('ett försök om 5 min, ett fönster på 24 h, inget räknat', () => {
    expect(portalFortnoxSafetyNet(NOW)).toEqual({
      fortnox_next_attempt_at: plus(5 * MIN), fortnox_attempts: 0, fortnox_retry_until: plus(24 * HOUR),
    });
  });
});

describe('retryPortalFortnox', () => {
  const row = (quoteId: string, next: string | null, until: string | null = plus(20 * HOUR)) => ({
    quote_id: quoteId, fortnox_next_attempt_at: next, fortnox_retry_until: until, fortnox_attempts: 1,
  });

  it('bara de som är dags, äldst först; varje jobb tas med ett lån innan försöket', async () => {
    const { admin, tables } = memoryAdmin({
      crm_portal_jobs: [row('q-sen', plus(MIN)), row('q-2', plus(-MIN)), row('q-1', plus(-10 * MIN)), row('q-inget', null)],
    });
    const seen: { quoteId: string; next: unknown }[] = [];
    const followUp = vi.fn(async (quoteId: string) => {
      seen.push({ quoteId, next: tables.crm_portal_jobs.find((r) => r.quote_id === quoteId)!.fortnox_next_attempt_at });
    });
    const summary = await retryPortalFortnox(admin, { followUp, now: () => NOW });
    expect(summary).toEqual({ due: 2, attempted: 2, gaveUp: 0, skipped: 0, errors: 0 });
    expect(seen).toEqual([
      { quoteId: 'q-1', next: plus(PORTAL_FORTNOX_LEASE_MS) },
      { quoteId: 'q-2', next: plus(PORTAL_FORTNOX_LEASE_MS) },
    ]);
  });

  it('en annan körning hann ta jobbet: inget andra försök', async () => {
    const { admin } = memoryAdmin(
      { crm_portal_jobs: [row('q-1', plus(-MIN))] },
      {
        beforeExecute: (call, t) => {
          if (call.table === 'crm_portal_jobs' && call.op === 'update') t.crm_portal_jobs[0].fortnox_next_attempt_at = plus(9 * MIN);
        },
      },
    );
    const followUp = vi.fn(async () => {});
    expect(await retryPortalFortnox(admin, { followUp, now: () => NOW })).toMatchObject({ skipped: 1, attempted: 0 });
    expect(followUp).not.toHaveBeenCalled();
  });

  it('fönstret har gått ut: ges upp utan försök, och står inte kvar', async () => {
    const { admin, tables } = memoryAdmin({ crm_portal_jobs: [row('q-1', plus(-MIN), plus(-2 * MIN))] });
    const followUp = vi.fn(async () => {});
    expect(await retryPortalFortnox(admin, { followUp, now: () => NOW })).toMatchObject({ gaveUp: 1, attempted: 0 });
    expect(followUp).not.toHaveBeenCalled();
    expect(tables.crm_portal_jobs[0].fortnox_next_attempt_at).toBeNull();
  });

  it('ett försök som kastar hindrar inte nästa; tiden är slut = inga fler', async () => {
    const { admin } = memoryAdmin({ crm_portal_jobs: [row('q-1', plus(-2 * MIN)), row('q-2', plus(-MIN))] });
    const followUp = vi.fn(async (q: string) => {
      if (q === 'q-1') throw new Error('nere');
    });
    expect(await retryPortalFortnox(admin, { followUp, now: () => NOW })).toMatchObject({ errors: 1, attempted: 1 });

    let t = NOW.getTime();
    const slow = vi.fn(async () => {
      t += 60_000;
    });
    const again = memoryAdmin({ crm_portal_jobs: [row('q-1', plus(-2 * MIN)), row('q-2', plus(-MIN))] });
    expect(await retryPortalFortnox(again.admin, { followUp: slow, now: () => new Date(t), budgetMs: 30_000 })).toMatchObject({ attempted: 1 });
  });
});
