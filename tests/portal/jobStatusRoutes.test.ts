import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { adminUser, salesUser } from '../crm/helpers/supabase';

/**
 * Routerna i fas 4b: portalens cron (CRON_SECRET, ingen session) och "Skicka om" på fliken Utskick (crm.portal.manage).
 * Grinden före allt: ingen klient byggs och ingenting körs förrän den släppt igenom.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  cronCalls: 0,
  requeue: { kind: 'requeued', orderingKey: 'job:q-1' } as Record<string, unknown>,
  requeueCalls: [] as unknown[][],
  marked: [] as string[],
}));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ((h.clients += 1), { kind: 'admin' })) }));
vi.mock('@/lib/domains/portal/cron', () => ({
  runPortalCron: vi.fn(async () => ((h.cronCalls += 1), { sync: {}, dispatch: { ran: false, reason: 'av' }, fortnox: {} })),
}));
vi.mock('@/lib/domains/portal/outbox', () => ({
  requeueDeadPortalEvent: vi.fn(async (...args: unknown[]) => (h.requeueCalls.push(args), h.requeue)),
}));
vi.mock('@/lib/domains/portal/jobSync', () => ({
  markPortalJobForSync: vi.fn(async (_admin: unknown, quoteId: string) => void h.marked.push(quoteId)),
}));

const SECRET = 'cron-hemlighet-0123456789';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

async function cron(authorization?: string) {
  const { GET } = await import('@/app/api/reseller-portal/cron/route');
  return GET(new NextRequest('http://localhost/api/reseller-portal/cron', { headers: authorization ? { authorization } : {} }));
}

async function retry(id = EVENT_ID) {
  const { POST } = await import('@/app/api/crm/portal/events/[id]/retry/route');
  return POST(new Request(`http://localhost/api/crm/portal/events/${id}/retry`, { method: 'POST' }), { params: { id } });
}

beforeEach(() => {
  h.held = new Set();
  h.user = null;
  h.clients = 0;
  h.cronCalls = 0;
  h.requeue = { kind: 'requeued', orderingKey: 'job:q-1' };
  h.requeueCalls = [];
  h.marked = [];
  vi.stubEnv('CRON_SECRET', SECRET);
});

describe('GET /api/reseller-portal/cron', () => {
  it('rätt nyckel: ett varv', async () => {
    const res = await cron(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(h.cronCalls).toBe(1);
  });

  it('fel eller ingen nyckel: 401, ingen klient, ingenting körs', async () => {
    for (const header of [undefined, 'Bearer fel', SECRET]) {
      expect((await cron(header)).status).toBe(401);
    }
    expect(h.clients).toBe(0);
    expect(h.cronCalls).toBe(0);
  });

  it('utan CRON_SECRET: 503, ingenting körs', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await cron('Bearer ')).status).toBe(503);
    expect(h.cronCalls).toBe(0);
  });
});

describe('POST /api/crm/portal/events/[id]/retry', () => {
  it('utan inloggning 401, utan crm.portal.manage 403; ingen klient, ingenting körs', async () => {
    expect((await retry()).status).toBe(401);
    h.user = salesUser;
    h.held = new Set(['crm.access', 'crm.write', 'crm.workorder.write']);
    expect((await retry()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.requeueCalls).toHaveLength(0);
  });

  describe('med crm.portal.manage', () => {
    beforeEach(() => {
      h.user = adminUser;
      h.held = new Set(['crm.portal.manage']);
    });

    it('ett id som inte är ett uuid: 400, ingenting körs', async () => {
      expect((await retry('x')).status).toBe(400);
      expect(h.requeueCalls).toHaveLength(0);
    });

    it('ett jobbs händelse: tillbaka i kön, jobbet markeras, ett varv körs', async () => {
      const res = await retry();
      expect(res.status).toBe(200);
      expect(h.requeueCalls[0][1]).toBe(EVENT_ID);
      expect(h.marked).toEqual(['q-1']);
      expect(h.cronCalls).toBe(1);
    });

    it('prislistan: inget jobb markeras', async () => {
      h.requeue = { kind: 'requeued', orderingKey: 'pricelist' };
      expect((await retry()).status).toBe(200);
      expect(h.marked).toEqual([]);
    });

    it.each([
      [{ kind: 'not_found' }, 404, 'portal_event_not_found'],
      [{ kind: 'not_dead', status: 'sent' }, 409, 'portal_event_not_dead'],
      [{ kind: 'superseded_by_later' }, 409, 'portal_event_superseded'],
    ])('%o: %i, inget varv', async (result, status, code) => {
      h.requeue = result;
      const res = await retry();
      expect(res.status).toBe(status);
      expect((await res.json()).errorDetails?.code ?? '').toBe(code);
      expect(h.cronCalls).toBe(0);
    });
  });
});
