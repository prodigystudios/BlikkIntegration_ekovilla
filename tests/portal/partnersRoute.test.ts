import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, salesUser } from '../crm/helpers/supabase';

/**
 * Partnerrutans routes (RESELLER_PORTAL_CRM_PLAN.md 10a): GET och PUT /api/crm/portal/partners/[customerId] och POST
 * …/invites. Grinden före allt: utan inloggning 401, utan crm.portal.manage 403 (också för en säljare som får ändra
 * kundkort), och då har ingen klient byggts och ingenting körts. Sedan id:t och kroppen (400) och översättningen av
 * domänens utfall till HTTP. Reglerna prövas i partnersStore.test.ts.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  calls: [] as unknown[][],
  read: null as unknown,
  setResult: { kind: 'saved', partnerType: 'reseller' } as Record<string, unknown>,
  inviteResult: { kind: 'invited', created: true, resellerId: 'r', attempt: 1, delivery: null } as Record<string, unknown>,
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
vi.mock('@/lib/domains/portal/partnersStore', () => ({
  readPortalPartner: vi.fn(async (...args: unknown[]) => (h.calls.push(['read', ...args]), h.read)),
  setPortalPartnerType: vi.fn(async (...args: unknown[]) => (h.calls.push(['set', ...args]), h.setResult)),
  invitePortalReseller: vi.fn(async (...args: unknown[]) => (h.calls.push(['invite', ...args]), h.inviteResult)),
}));

const CARD = '11111111-1111-4111-8111-111111111111';
const RESELLER_ID = '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64';
const STORE = { name: 'Beijer Gävle', street: '', postalCode: '', city: 'Gävle', phone: '', email: '' };
const ADMIN = { name: 'Anna Berg', email: 'anna@exempel.se' };

async function call(method: 'GET' | 'PUT', id = CARD, body?: unknown) {
  const route = await import('@/app/api/crm/portal/partners/[customerId]/route');
  const req = new Request(`http://localhost/api/crm/portal/partners/${id}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await route[method](req, { params: { customerId: id } });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function invite(body: unknown, id = CARD) {
  const { POST } = await import('@/app/api/crm/portal/partners/[customerId]/invites/route');
  const res = await POST(
    new Request(`http://localhost/api/crm/portal/partners/${id}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { customerId: id } },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const newBody = (patch: Record<string, unknown> = {}) => ({ mode: 'new', resellerId: RESELLER_ID, store: STORE, admin: ADMIN, ...patch });

beforeEach(() => {
  h.held = new Set(['crm.access', 'crm.customer.write', 'crm.portal.manage']);
  h.user = adminUser;
  h.clients = 0;
  h.calls = [];
  h.read = { customerId: CARD, partnerType: null, stores: [] };
  h.setResult = { kind: 'saved', partnerType: 'reseller' };
  h.inviteResult = { kind: 'invited', created: true, resellerId: RESELLER_ID, attempt: 1, delivery: { status: 'sent' } };
});

describe('grinden', () => {
  it('utan inloggning: 401 på alla tre, ingen klient, ingenting körs', async () => {
    h.user = null;
    expect((await call('GET')).status).toBe(401);
    expect((await call('PUT', CARD, { partnerType: 'reseller' })).status).toBe(401);
    expect((await invite(newBody())).status).toBe(401);
    expect(h.clients).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('utan crm.portal.manage: 403, också för en säljare som får ändra kundkort', async () => {
    h.user = salesUser;
    h.held = new Set(['crm.access', 'crm.customer.write', 'fortnox.customer.sync']);
    expect((await call('GET')).status).toBe(403);
    expect((await call('PUT', CARD, { partnerType: 'reseller' })).status).toBe(403);
    expect((await invite(newBody())).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('ett kund-id som inte är en uuid: 400, ingenting körs', async () => {
    expect((await call('GET', 'inte-ett-id')).status).toBe(400);
    expect((await call('PUT', 'inte-ett-id', { partnerType: 'reseller' })).status).toBe(400);
    expect((await invite(newBody(), 'inte-ett-id')).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});

describe('GET och PUT /api/crm/portal/partners/[customerId]', () => {
  it('GET: rutan, eller 404 när kortet inte finns för sessionen', async () => {
    expect(await call('GET')).toMatchObject({ status: 200, body: { data: { partner: { customerId: CARD } } } });
    h.read = null;
    expect((await call('GET')).status).toBe(404);
  });

  it('PUT: typen eller null; allt annat är 400 och körs inte', async () => {
    expect(await call('PUT', CARD, { partnerType: 'partner' })).toMatchObject({ status: 200 });
    expect(await call('PUT', CARD, { partnerType: null })).toMatchObject({ status: 200 });
    expect(h.calls.map((c) => c.slice(2, 4))).toEqual([
      [CARD, 'partner'],
      [CARD, null],
    ]);
    h.calls = [];
    for (const body of [{ partnerType: 'kund' }, {}, '{']) expect((await call('PUT', CARD, body)).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('PUT: domänens utfall', async () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ kind: 'not_found' }, 404],
      [{ kind: 'not_business' }, 422],
      [{ kind: 'forbidden' }, 403],
      [{ kind: 'db_error', message: 'nere' }, 500],
    ];
    for (const [result, status] of cases) {
      h.setResult = result;
      expect((await call('PUT', CARD, { partnerType: 'reseller' })).status).toBe(status);
    }
  });
});

describe('POST /api/crm/portal/partners/[customerId]/invites', () => {
  it('kroppen prövas innan något körs', async () => {
    const bad: unknown[] = [
      '{',
      {},
      newBody({ mode: 'annat' }),
      newBody({ resellerId: 'res-norrbygg' }), // ett nytt företag får ett uuid av formuläret
      newBody({ resellerId: RESELLER_ID.toUpperCase() }),
      newBody({ store: { ...STORE, city: '' } }),
      newBody({ admin: { name: 'Anna', email: 'anna' } }),
      { mode: 'resend', resellerId: 'res-norrbygg', admin: ADMIN },
      { mode: 'resend', resellerId: 'res-norrbygg', admin: ADMIN, expectedAttempt: 1.5 },
      { mode: 'resend', resellerId: '..', admin: ADMIN, expectedAttempt: 0 },
    ];
    for (const body of bad) expect((await invite(body)).status, JSON.stringify(body)).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('domänen får kortet ur sökvägen och de prövade fälten, med adressen i gemener', async () => {
    await invite(newBody({ admin: { name: ' Anna Berg ', email: ' Anna@Exempel.SE ' } }));
    const [, deps, input] = h.calls[0] as [string, Record<string, any>, Record<string, unknown>];
    expect(input).toEqual({ mode: 'new', customerId: CARD, resellerId: RESELLER_ID, store: STORE, admin: ADMIN });
    expect(deps.actor).toEqual({ id: adminUser.id, name: null });
    expect(deps.session).toEqual({ kind: 'session' });
    expect(deps.admin).toEqual({ kind: 'admin' });

    h.calls = [];
    await invite({ mode: 'resend', resellerId: 'res-norrbygg', admin: ADMIN, expectedAttempt: 0 });
    expect(h.calls[0][2]).toEqual({ mode: 'resend', customerId: CARD, resellerId: 'res-norrbygg', admin: ADMIN, expectedAttempt: 0 });
  });

  it('domänens utfall', async () => {
    const cases: [Record<string, unknown>, number, string | null][] = [
      [{ kind: 'invited', created: true, resellerId: RESELLER_ID, attempt: 1, delivery: null }, 201, null],
      [{ kind: 'invited', created: false, resellerId: RESELLER_ID, attempt: 1, delivery: null }, 200, null],
      [{ kind: 'integration_off', message: 'av' }, 409, 'portal_integration_off'],
      [{ kind: 'not_found' }, 404, 'customer_not_found'],
      [{ kind: 'ineligible', reason: 'no_fortnox_number' }, 422, 'portal_partner_ineligible'],
      [{ kind: 'not_partner' }, 409, 'portal_partner_not_flagged'],
      [{ kind: 'reseller_id_taken' }, 409, 'portal_reseller_id_taken'],
      [{ kind: 'store_not_found' }, 404, 'portal_reseller_not_found'],
      [{ kind: 'changed' }, 409, 'portal_invite_changed'],
      [{ kind: 'db_error', message: 'nere' }, 500, 'portal_invite_db_error'],
    ];
    for (const [result, status, code] of cases) {
      h.inviteResult = result;
      const res = await invite(newBody());
      expect(res.status, String(result.kind)).toBe(status);
      if (code) expect(res.body.errorDetails.code).toBe(code);
    }
  });

  it('ett kort utan kundnummer får förklaringen, inte bara koden', async () => {
    h.inviteResult = { kind: 'ineligible', reason: 'no_fortnox_number' };
    expect((await invite(newBody())).body.error).toMatch(/kundnummer i Fortnox/);
  });
});
