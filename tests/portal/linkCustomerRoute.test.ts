import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser } from '../crm/helpers/supabase';

/**
 * POST /api/crm/portal/jobs/[workOrderId]/link-customer (fas 3c). Grinden före allt: utan inloggning 401, utan
 * crm.workorder.write 403, och då har ingen klient byggts och ingenting körts. Sedan id:t och kroppen (400) och
 * översättningen av domänens utfall till HTTP. Vem som får ändra ordern avgör RLS i domänen (se linkCustomer.test.ts).
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  calls: [] as unknown[][],
  result: { kind: 'linked', fortnoxOrderNumber: '24', fortnoxError: null, storeLinked: true } as Record<string, unknown>,
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
vi.mock('@/lib/domains/portal/linkCustomer', () => ({
  linkPortalJobCustomer: vi.fn(async (...args: unknown[]) => (h.calls.push(args), h.result)),
}));
vi.mock('@/lib/domains/crm/work-orders', () => ({
  getCrmWorkOrder: vi.fn(async () => ({ data: { id: WO, customer_id: CARD }, error: null })),
}));

const WO = '22222222-2222-4222-8222-222222222222';
const CARD = '11111111-1111-4111-8111-111111111111';

async function post(id = WO, body: unknown = { customer_id: CARD }) {
  const { POST } = await import('@/app/api/crm/portal/jobs/[workOrderId]/link-customer/route');
  const res = await POST(
    new Request(`http://localhost/api/crm/portal/jobs/${id}/link-customer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { workOrderId: id } },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  h.held = new Set(['crm.access', 'crm.write', 'crm.workorder.read', 'crm.workorder.write']);
  h.user = salesUser;
  h.clients = 0;
  h.calls = [];
  h.result = { kind: 'linked', fortnoxOrderNumber: '24', fortnoxError: null, storeLinked: true };
});

describe('POST /api/crm/portal/jobs/[workOrderId]/link-customer', () => {
  it('utan inloggning: 401, ingen klient, ingenting körs', async () => {
    h.user = null;
    expect((await post()).status).toBe(401);
    expect(h.clients).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('utan crm.workorder.write: 403, ingen klient, ingenting körs', async () => {
    h.held = new Set(['crm.access', 'crm.workorder.read']);
    expect((await post()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('ett id som inte är en uuid, eller en kropp utan kort: 400, ingenting körs', async () => {
    expect((await post('inte-ett-id')).status).toBe(400);
    expect((await post(WO, { customer_id: 'x' })).status).toBe(400);
    expect((await post(WO, '{')).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('kopplad: 200 med arbetsordern, Fortnox-numret och om butiken fick kopplingen; den inloggade som aktör', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ item: { id: WO, customer_id: CARD }, fortnox_order_number: '24', fortnox_error: null, store_linked: true });
    const [, , input] = h.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(input).toEqual({ workOrderId: WO, customerId: CARD, actorId: salesUser.id });
  });

  it('kopplad men Fortnox svarade fel: 200, felet i svaret', async () => {
    h.result = { kind: 'linked', fortnoxOrderNumber: null, fortnoxError: 'Fortnox svarade: nej', storeLinked: true };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.fortnox_error).toBe('Fortnox svarade: nej');
  });

  it('kortet saknar något: 409 med listan', async () => {
    const blockers = [{ field: 'organization_number', label: 'Organisationsnummer', message: 'Org.nr saknas.', fixAt: 'customer_card' }];
    h.result = { kind: 'incomplete', blockers };
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.errorDetails.code).toBe('crm_work_order_incomplete');
    expect(res.body.errorDetails.details.blockers).toEqual(blockers);
  });

  it.each([
    ['not_found', 404, 'crm_work_order_not_found'],
    ['already_linked', 409, 'portal_job_already_linked'],
    ['in_fortnox', 409, 'portal_job_in_fortnox'],
    ['customer_not_found', 404, 'crm_customer_not_found'],
    ['not_business', 422, 'portal_customer_not_business'],
    ['forbidden', 403, 'portal_link_forbidden'],
  ])('%s: %i %s', async (kind, status, code) => {
    h.result = { kind };
    const res = await post();
    expect(res.status).toBe(status);
    expect(res.body.errorDetails.code).toBe(code);
  });
});
