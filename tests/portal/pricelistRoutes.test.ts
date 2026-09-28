import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, salesUser } from '../crm/helpers/supabase';

/**
 * Routerna på sidan Återförsäljarportalen (fas 2b): publiceringen och "Skicka väntande nu". Grinden före allt: utan
 * inloggning 401, utan crm.portal.manage 403, och i båda fallen har ingen klient byggts och ingenting körts. Sedan
 * kroppen (400) och översättningen av domänens utfall till HTTP.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  publishCalls: [] as unknown[][],
  publishResult: { kind: 'empty' } as Record<string, unknown>,
  dispatchCalls: 0,
  dispatchResult: { ran: true, claimed: 0, sent: 0, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 } as Record<string, unknown>,
}));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ((h.clients += 1), { kind: 'session' })) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ((h.clients += 1), { kind: 'admin' })) }));
vi.mock('@/lib/domains/portal/pricelistPublish', () => ({
  pricelistSources: vi.fn(() => ({ kind: 'sources' })),
  publishPricelist: vi.fn(async (...args: unknown[]) => (h.publishCalls.push(args), h.publishResult)),
}));
vi.mock('@/lib/domains/portal/outbox', () => ({
  dispatchPortalOutbox: vi.fn(async () => ((h.dispatchCalls += 1), h.dispatchResult)),
}));
// "Skicka väntande nu" kör hela varvet (fas 4b); här prövas bara grinden och hur utskickets utfall översätts.
vi.mock('@/lib/domains/portal/cron', () => ({
  runPortalCron: vi.fn(async () => {
    h.dispatchCalls += 1;
    return { sync: { jobs: 0, queued: 0, unchanged: 0, conflicts: 0, errors: 0 }, dispatch: h.dispatchResult, fortnox: { due: 0, attempted: 0, gaveUp: 0, skipped: 0, errors: 0 } };
  }),
}));

const HASH = 'a'.repeat(64);

async function publish(body: unknown = { valid_from: '2026-10-01', expected_hash: HASH }) {
  const { POST } = await import('@/app/api/crm/portal/pricelist/publish/route');
  return POST(
    new Request('http://localhost/api/crm/portal/pricelist/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

async function dispatch() {
  const { POST } = await import('@/app/api/crm/portal/dispatch/route');
  return POST();
}

beforeEach(() => {
  h.held = new Set();
  h.user = null;
  h.clients = 0;
  h.publishCalls = [];
  h.publishResult = { kind: 'empty' };
  h.dispatchCalls = 0;
  h.dispatchResult = { ran: true, claimed: 0, sent: 0, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
});

describe.each([
  ['POST /api/crm/portal/pricelist/publish', () => publish()],
  ['POST /api/crm/portal/dispatch', () => dispatch()],
])('%s: grinden', (_name, call) => {
  it('utan inloggning: 401, ingen klient, ingenting körs', async () => {
    expect((await call()).status).toBe(401);
    expect(h.clients).toBe(0);
    expect(h.publishCalls).toHaveLength(0);
    expect(h.dispatchCalls).toBe(0);
  });

  it('utan crm.portal.manage (säljaren, också med artikelnyckeln): 403, ingen klient, ingenting körs', async () => {
    h.user = salesUser;
    h.held = new Set(['crm.access', 'crm.write', 'crm.article.manage']);
    expect((await call()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.publishCalls).toHaveLength(0);
    expect(h.dispatchCalls).toBe(0);
  });
});

describe('POST /api/crm/portal/pricelist/publish', () => {
  beforeEach(() => {
    h.user = adminUser;
    h.held = new Set(['crm.portal.manage']);
  });

  it.each([
    ['inte JSON', 'x'],
    ['utan hash', { valid_from: '2026-10-01' }],
    ['kort hash', { valid_from: '2026-10-01', expected_hash: 'abc' }],
    ['datum i fel form', { valid_from: '1 okt', expected_hash: HASH }],
  ])('%s: 400 och ingenting körs', async (_label, body) => {
    expect((await publish(body)).status).toBe(400);
    expect(h.publishCalls).toHaveLength(0);
  });

  it('skickar datum, hash, den inloggade och den svenska dagen till domänen', async () => {
    h.publishResult = { kind: 'published', created: true, idempotencyKey: 'k', articleCount: 51, delivery: { status: 'sent' } };
    const res = await publish();
    expect(res.status).toBe(201);
    const [deps, input] = h.publishCalls[0] as [Record<string, any>, unknown];
    expect(input).toEqual({ validFrom: '2026-10-01', expectedHash: HASH });
    expect(deps.actor).toEqual({ id: adminUser.id, name: adminUser.name ?? null });
    expect(deps.session).toEqual({ kind: 'session' });
    expect(deps.admin).toEqual({ kind: 'admin' });
    expect(deps.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await res.json()).data).toEqual({ created: true, idempotency_key: 'k', article_count: 51, delivery: { status: 'sent' } });
  });

  it.each([
    [{ kind: 'published', created: false, idempotencyKey: 'k', articleCount: 1, delivery: null }, 200],
    [{ kind: 'integration_off', message: 'x' }, 409],
    [{ kind: 'invalid_valid_from' }, 400],
    [{ kind: 'source_error', message: 'Lista 160 gick inte att läsa' }, 502],
    [{ kind: 'empty' }, 422],
    [{ kind: 'changed' }, 409],
    [{ kind: 'forbidden' }, 403],
    [{ kind: 'db_error', message: 'x' }, 500],
  ])('%j → %i', async (outcome, status) => {
    h.publishResult = outcome;
    expect((await publish()).status).toBe(status);
  });
});

describe('POST /api/crm/portal/dispatch', () => {
  beforeEach(() => {
    h.user = adminUser;
    h.held = new Set(['crm.portal.manage']);
  });

  it('skickar kön och svarar med sammanfattningen', async () => {
    h.dispatchResult = { ran: true, claimed: 2, sent: 2, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
    const res = await dispatch();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ claimed: 2, sent: 2 });
  });

  it('avstängd integration: 409, inget påstås skickat', async () => {
    h.dispatchResult = { ran: false, reason: 'PORTAL_CRM_SHARED_SECRET saknas eller är för kort.' };
    const res = await dispatch();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/inte påslagen/);
  });
});
