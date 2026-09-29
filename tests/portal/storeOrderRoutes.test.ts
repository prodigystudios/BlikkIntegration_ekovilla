import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser } from '../crm/helpers/supabase';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';

/**
 * Ekovillas steg på en butiksbeställning över HTTP (fas 8b): frakten, kunden, Bekräfta, "Skicka till Fortnox", och
 * (8b2) Levererad, Fakturera och Makulera.
 * Grinden före allt: utan inloggning 401 och utan crm.workorder.write 403, och då har ingen klient byggts. Sedan id:t
 * (400), en beställning som sessionen inte ser (404) och regeln crm_store_order_can_manage (403), och först därefter
 * kroppen och domänen. Domänens utfall blir rätt status och kod.
 */

const ID = '55555555-5555-4555-8555-555555555555';
const CARD = '11111111-1111-4111-8111-111111111111';
const SEEN = { version: 2, freightSetAt: '2026-09-29T09:30:00.000000+00:00', customerId: CARD };

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  seen: true,
  canManage: true as unknown,
  calls: [] as { fn: string; args: unknown[] }[],
  results: {} as Record<string, unknown>,
}));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => {
    h.clients += 1;
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: h.seen ? { id: ID } : null, error: null }),
    };
    return {
      kind: 'session',
      from: () => chain,
      rpc: vi.fn(async (name: string, args: unknown) => (h.calls.push({ fn: `rpc:${name}`, args: [args] }), { data: h.canManage, error: null })),
    };
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ((h.clients += 1), { kind: 'admin' })) }));
vi.mock('@/lib/domains/portal/storeOrderActions', () => {
  const fn = (name: string) => vi.fn(async (...args: unknown[]) => (h.calls.push({ fn: name, args }), h.results[name]));
  return {
    // Grinden: samma svar som sessionens läsning och regeln hade gett.
    storeOrderManageAccess: vi.fn(async (_session: unknown, id: string) => {
      h.calls.push({ fn: 'rpc:crm_store_order_can_manage', args: [{ p_id: id }] });
      if (!h.seen) return 'not_found';
      return h.canManage === true ? 'allowed' : 'forbidden';
    }),
    setStoreOrderFreight: fn('setStoreOrderFreight'),
    linkStoreOrderCustomer: fn('linkStoreOrderCustomer'),
    confirmStoreOrder: fn('confirmStoreOrder'),
    pushStoreOrderToFortnox: fn('pushStoreOrderToFortnox'),
  };
});
vi.mock('@/lib/domains/portal/storeOrderFulfilment', () => {
  const fn = (name: string) => vi.fn(async (...args: unknown[]) => (h.calls.push({ fn: name, args }), h.results[name]));
  return {
    markStoreOrderDelivered: fn('markStoreOrderDelivered'),
    invoiceStoreOrder: fn('invoiceStoreOrder'),
    cancelStoreOrder: fn('cancelStoreOrder'),
  };
});

type Json = Record<string, any>;

type Action = 'freight' | 'customer' | 'confirm' | 'fortnox' | 'deliver' | 'invoice' | 'cancel';

async function call(action: Action, body: unknown = {}, id = ID) {
  const route = await import(`@/app/api/crm/portal/store-orders/[id]/${action}/route`);
  const method = action === 'freight' || action === 'customer' ? 'PUT' : 'POST';
  const res = (await route[method](
    new Request(`http://localhost/api/crm/portal/store-orders/${id}/${action}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { id } },
  )) as Response;
  return { status: res.status, body: (await res.json()) as Json };
}

const domainCalls = () => h.calls.filter((c) => !c.fn.startsWith('rpc:'));

beforeEach(() => {
  h.held = new Set(['crm.access', 'crm.write', 'crm.workorder.read', 'crm.workorder.write']);
  h.user = salesUser;
  h.clients = 0;
  h.seen = true;
  h.canManage = true;
  h.calls = [];
  h.results = {
    setStoreOrderFreight: { kind: 'saved' },
    linkStoreOrderCustomer: { kind: 'linked', storeLink: 'linked' },
    confirmStoreOrder: { kind: 'confirmed', push: { outcome: 'created', fortnoxOrderNumber: '801', error: null } },
    pushStoreOrderToFortnox: { outcome: 'created', fortnoxOrderNumber: '801', error: null },
    markStoreOrderDelivered: { kind: 'delivered' },
    invoiceStoreOrder: { kind: 'invoiced', invoiceNumber: '23', source: 'created' },
    cancelStoreOrder: { kind: 'cancelled', fortnoxOrderNumbers: ['58'] },
  };
});

const CANCEL = { reason: 'Fel artikel', status: 'confirmed', version: 2 };

describe('grinden, för alla steg', () => {
  const actions = [
    ['freight', { mode: 'none', expectedSetAt: null }],
    ['customer', { customer_id: CARD, expected_customer_id: null }],
    ['confirm', { version: 2, freightSetAt: '2026-09-29T09:30:00.000000+00:00', customerId: CARD }],
    ['fortnox', {}],
    ['deliver', { deliveredOn: '2026-09-29' }],
    ['invoice', {}],
    ['cancel', CANCEL],
  ] as const;

  it('utan inloggning 401, utan crm.workorder.write 403: ingen klient, ingenting körs', async () => {
    for (const [action, body] of actions) {
      h.user = null;
      expect((await call(action, body)).status).toBe(401);
      h.user = salesUser;
      h.held = new Set(['crm.access', 'crm.workorder.read']);
      expect((await call(action, body)).status).toBe(403);
      h.held = new Set(['crm.access', 'crm.write', 'crm.workorder.read', 'crm.workorder.write']);
    }
    expect(h.clients).toBe(0);
    expect(domainCalls()).toHaveLength(0);
  });

  it('ogiltigt id 400; en beställning sessionen inte ser 404; varken ansvarig eller admin 403, och ingenting körs', async () => {
    for (const [action, body] of actions) {
      expect((await call(action, body, 'inte-ett-id')).status).toBe(400);
      h.seen = false;
      expect(await call(action, body)).toMatchObject({ status: 404, body: { errorDetails: { code: 'store_order_not_found' } } });
      h.seen = true;
      h.canManage = false;
      expect(await call(action, body)).toMatchObject({ status: 403, body: { errorDetails: { code: 'store_order_forbidden' } } });
      h.canManage = true;
    }
    expect(domainCalls()).toHaveLength(0);
  });

  it('regeln frågas med beställningens id', async () => {
    await call('confirm', SEEN);
    expect(h.calls.find((c) => c.fn === 'rpc:crm_store_order_can_manage')?.args[0]).toEqual({ p_id: ID });
  });
});

describe('PUT …/freight', () => {
  it('Ingen frakt, eller ett pris med högst två decimaler; annars 400 och ingenting körs', async () => {
    const AT = '2026-09-29T09:30:00.000000+00:00';
    expect((await call('freight', { mode: 'none', expectedSetAt: null })).status).toBe(200);
    expect((await call('freight', { mode: 'charged', price: 950.5, expectedSetAt: AT })).status).toBe(200);
    const saved = h.calls.filter((c) => c.fn === 'setStoreOrderFreight');
    expect(saved.map((c) => c.args[2])).toEqual([{ mode: 'none' }, { mode: 'charged', price: 950.5 }]);
    expect(saved.map((c) => c.args[4])).toEqual([null, AT]);
    h.calls = [];
    for (const bad of [{ mode: 'charged', expectedSetAt: null }, { mode: 'charged', price: 0, expectedSetAt: null }, { mode: 'charged', price: -5, expectedSetAt: null }, { mode: 'charged', price: 10.005, expectedSetAt: null }, { mode: 'charged', price: 1_000_001, expectedSetAt: null }, { mode: 'x', expectedSetAt: null }, { mode: 'none' }, { mode: 'none', expectedSetAt: 'igår' }, '{']) {
      expect((await call('freight', bad)).status).toBe(400);
    }
    expect(domainCalls()).toHaveLength(0);
  });

  it('inte mottagen 409, okänd 404', async () => {
    h.results.setStoreOrderFreight = { kind: 'not_received' };
    expect(await call('freight', { mode: 'none', expectedSetAt: null })).toMatchObject({ status: 409, body: { errorDetails: { code: 'store_order_not_received' } } });
    h.results.setStoreOrderFreight = { kind: 'freight_changed' };
    expect(await call('freight', { mode: 'none', expectedSetAt: null })).toMatchObject({ status: 409, body: { errorDetails: { code: 'store_order_freight_changed' } } });
    h.results.setStoreOrderFreight = { kind: 'not_found' };
    expect((await call('freight', { mode: 'none', expectedSetAt: null })).status).toBe(404);
  });
});

describe('PUT …/customer', () => {
  it('kortet kopplas med sessionen och service-rollen; utfallen blir rätt status', async () => {
    expect(await call('customer', { customer_id: CARD, expected_customer_id: null })).toMatchObject({ status: 200, body: { data: { store_link: 'linked' } } });
    const args = h.calls.find((c) => c.fn === 'linkStoreOrderCustomer')!.args;
    expect((args[0] as Json).kind).toBe('session');
    expect((args[1] as Json).kind).toBe('admin');
    expect(args[2]).toEqual({ id: ID, customerId: CARD, expectedCustomerId: null, actor: { id: salesUser.id } });

    const cases: [string, number, string][] = [
      ['not_found', 404, 'store_order_not_found'],
      ['not_received', 409, 'store_order_not_received'],
      ['customer_changed', 409, 'store_order_customer_changed'],
      ['customer_not_found', 404, 'crm_customer_not_found'],
      ['not_business', 422, 'portal_customer_not_business'],
      ['customer_not_in_fortnox', 422, 'store_order_customer_not_in_fortnox'],
    ];
    // Ett byte: butiken rördes inte, och det är inget fel.
    h.results.linkStoreOrderCustomer = { kind: 'linked', storeLink: 'not_applicable' };
    expect(await call('customer', { customer_id: CARD, expected_customer_id: null })).toMatchObject({ status: 200, body: { data: { store_link: 'not_applicable' } } });
    for (const [kind, status, code] of cases) {
      h.results.linkStoreOrderCustomer = { kind };
      expect(await call('customer', { customer_id: CARD, expected_customer_id: null })).toMatchObject({ status, body: { errorDetails: { code } } });
    }
    for (const bad of [{ customer_id: 'x', expected_customer_id: null }, { customer_id: CARD }, { customer_id: CARD, expected_customer_id: 'x' }]) {
      expect((await call('customer', bad)).status).toBe(400);
    }
  });
});

describe('POST …/confirm', () => {
  it('det säljaren såg går till domänen; svaret bär Fortnox-numret, felet och utfallet', async () => {
    expect(await call('confirm', SEEN)).toMatchObject({ status: 200, body: { data: { fortnox_order_number: '801', fortnox_error: null, fortnox_outcome: 'created' } } });
    expect(h.calls.find((c) => c.fn === 'confirmStoreOrder')!.args[1]).toEqual({ id: ID, expected: SEEN, actor: { id: salesUser.id } });
    h.results.confirmStoreOrder = { kind: 'confirmed', push: { outcome: 'failed', fortnoxOrderNumber: null, error: 'Fortnox svarade: nere' } };
    expect(await call('confirm', SEEN)).toMatchObject({ status: 200, body: { data: { fortnox_order_number: null, fortnox_error: 'Fortnox svarade: nere', fortnox_outcome: 'failed' } } });
  });

  it('varje skäl blir 409 med sin kod; utan version 400', async () => {
    for (const [reason, code] of [
      ['not_received', 'store_order_not_received'],
      ['changed', 'store_order_changed'],
      ['changed_here', 'store_order_changed_here'],
      ['freight_missing', 'store_order_freight_missing'],
      ['customer_missing', 'store_order_customer_missing'],
      ['customer_not_in_fortnox', 'store_order_customer_not_in_fortnox'],
    ]) {
      h.results.confirmStoreOrder = { kind: 'blocked', reason };
      expect(await call('confirm', SEEN)).toMatchObject({ status: 409, body: { errorDetails: { code } } });
    }
    h.calls = [];
    const bads = [{}, { ...SEEN, version: 0 }, { ...SEEN, version: 1.5 }, { ...SEEN, version: '2' }, { version: 2, customerId: CARD }, { version: 2, freightSetAt: SEEN.freightSetAt }, { ...SEEN, freightSetAt: 'igår' }, { ...SEEN, customerId: 'x' }];
    for (const bad of bads) expect((await call('confirm', bad)).status).toBe(400);
    expect(domainCalls()).toHaveLength(0);
  });

  it('ett oväntat fel: 500 utan databasens text', async () => {
    h.results.confirmStoreOrder = undefined;
    const { confirmStoreOrder } = await import('@/lib/domains/portal/storeOrderActions');
    vi.mocked(confirmStoreOrder).mockRejectedValueOnce(new Error('relation "hemlig" does not exist'));
    const res = await call('confirm', SEEN);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hemlig');
  });
});

describe('POST …/fortnox', () => {
  it('skapad eller redan i Fortnox 200; inte bekräftad 409; pågår 409', async () => {
    expect(await call('fortnox')).toMatchObject({ status: 200, body: { data: { fortnox_order_number: '801' } } });
    h.results.pushStoreOrderToFortnox = { outcome: 'exists', fortnoxOrderNumber: '799', error: null };
    expect(await call('fortnox')).toMatchObject({ status: 200, body: { data: { fortnox_order_number: '799' } } });
    h.results.pushStoreOrderToFortnox = { outcome: 'failed', fortnoxOrderNumber: null, error: 'Fortnox svarade: nere' };
    expect(await call('fortnox')).toMatchObject({ status: 200, body: { data: { fortnox_error: 'Fortnox svarade: nere' } } });
    h.results.pushStoreOrderToFortnox = { outcome: 'skipped', fortnoxOrderNumber: null, error: null };
    expect(await call('fortnox')).toMatchObject({ status: 409, body: { errorDetails: { code: 'store_order_not_confirmed' } } });
    h.results.pushStoreOrderToFortnox = { outcome: 'in_progress', fortnoxOrderNumber: null, error: 'Fortnox-ordern skapas redan.' };
    expect(await call('fortnox')).toMatchObject({ status: 409, body: { errorDetails: { code: 'store_order_push_in_progress' } } });
  });
});

describe('POST …/deliver', () => {
  it('dagen går till domänen; utfallen blir rätt status', async () => {
    expect(await call('deliver', { deliveredOn: '2026-09-28' })).toMatchObject({ status: 200, body: { data: { delivered_on: '2026-09-28' } } });
    expect(h.calls.find((c) => c.fn === 'markStoreOrderDelivered')!.args[1]).toEqual({ id: ID, deliveredOn: '2026-09-28', actor: { id: salesUser.id } });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ kind: 'not_found' }, 404, 'store_order_not_found'],
      [{ kind: 'not_confirmed' }, 409, 'store_order_not_confirmed'],
      [{ kind: 'fortnox_order_missing' }, 409, 'store_order_fortnox_order_missing'],
      [{ kind: 'busy' }, 409, 'store_order_busy'],
      [{ kind: 'date_out_of_range', min: '2026-09-27', max: '2026-09-29' }, 400, 'store_order_delivered_on_out_of_range'],
    ];
    for (const [result, status, code] of cases) {
      h.results.markStoreOrderDelivered = result;
      expect(await call('deliver', { deliveredOn: '2026-09-28' })).toMatchObject({ status, body: { errorDetails: { code } } });
    }
    h.results.markStoreOrderDelivered = { kind: 'date_out_of_range', min: '2026-09-27', max: '2026-09-29' };
    expect((await call('deliver', { deliveredOn: '2026-09-26' })).body.error).toContain('27 sep. 2026');
  });

  it('🧨 bara en riktig kalenderdag i formen ÅÅÅÅ-MM-DD; annars 400 och ingenting körs', async () => {
    for (const bad of [{}, { deliveredOn: '' }, { deliveredOn: '2026-02-30' }, { deliveredOn: '2026-9-29' }, { deliveredOn: '29/9/2026' }, { deliveredOn: '2026-09-29T00:00:00Z' }, { deliveredOn: 20260929 }, '{']) {
      expect((await call('deliver', bad)).status).toBe(400);
    }
    expect(domainCalls()).toHaveLength(0);
    expect((await call('deliver', { deliveredOn: '2028-02-29' })).status).toBe(200);
  });
});

describe('POST …/invoice', () => {
  it('numret och källan; varje utfall blir rätt status och kod', async () => {
    expect(await call('invoice')).toMatchObject({ status: 200, body: { data: { fortnox_invoice_number: '23', source: 'created' } } });
    expect(h.calls.find((c) => c.fn === 'invoiceStoreOrder')!.args[1]).toEqual({ id: ID, actor: { id: salesUser.id } });
    h.results.invoiceStoreOrder = { kind: 'invoiced', invoiceNumber: '19', source: 'adopted' };
    expect(await call('invoice')).toMatchObject({ status: 200, body: { data: { fortnox_invoice_number: '19', source: 'adopted' } } });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ kind: 'not_found' }, 404, 'store_order_not_found'],
      [{ kind: 'not_delivered' }, 409, 'store_order_not_delivered'],
      [{ kind: 'busy' }, 409, 'store_order_invoice_in_progress'],
      [{ kind: 'fortnox_order_cancelled', orderNumber: '58' }, 409, 'store_order_fortnox_order_cancelled'],
      [{ kind: 'unsaved', invoiceNumber: '23' }, 500, 'store_order_invoice_unsaved'],
    ];
    for (const [result, status, code] of cases) {
      h.results.invoiceStoreOrder = result;
      expect(await call('invoice')).toMatchObject({ status, body: { errorDetails: { code } } });
    }
    h.results.invoiceStoreOrder = { kind: 'unsaved', invoiceNumber: '23' };
    expect((await call('invoice')).body.error).toContain('Faktura 23 skapades i Fortnox');
  });

  it('Fortnox inte anslutet 409, ett nej från Fortnox 502 med Fortnox text, vårt eget fel 500 utan databasens text', async () => {
    const { invoiceStoreOrder } = await import('@/lib/domains/portal/storeOrderFulfilment');
    vi.mocked(invoiceStoreOrder).mockRejectedValueOnce(new FortnoxNotConnectedError());
    expect(await call('invoice')).toMatchObject({ status: 409, body: { errorDetails: { code: 'fortnox_not_connected' } } });
    vi.mocked(invoiceStoreOrder).mockRejectedValueOnce(new FortnoxApiError(400, 'teknisk text', 2000397, 'Ordernummer 58 är makulerad och kan inte behandlas.'));
    const refused = await call('invoice');
    expect(refused).toMatchObject({ status: 502, body: { errorDetails: { code: 'store_order_fortnox_failed' } } });
    expect(refused.body.error).toContain('Ordernummer 58 är makulerad');
    vi.mocked(invoiceStoreOrder).mockRejectedValueOnce(new Error('relation "hemlig" does not exist'));
    const ours = await call('invoice');
    expect(ours).toMatchObject({ status: 500, body: { errorDetails: { code: 'store_order_invoice_failed' } } });
    expect(JSON.stringify(ours.body)).not.toContain('hemlig');
  });
});

describe('POST …/cancel', () => {
  it('skälet (trimmat) och det säljaren såg går till domänen; svaret bär Fortnox-ordrarna', async () => {
    expect(await call('cancel', { ...CANCEL, reason: '  Fel artikel \n' })).toMatchObject({ status: 200, body: { data: { fortnox_order_numbers: ['58'] } } });
    expect(h.calls.find((c) => c.fn === 'cancelStoreOrder')!.args[1]).toEqual({
      id: ID,
      reason: 'Fel artikel',
      expected: { status: 'confirmed', version: 2 },
      actor: { id: salesUser.id },
    });
  });

  it('varje utfall blir rätt status och kod', async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ kind: 'not_found' }, 404, 'store_order_not_found'],
      [{ kind: 'not_cancellable' }, 409, 'store_order_not_cancellable'],
      [{ kind: 'changed' }, 409, 'store_order_changed'],
      [{ kind: 'busy' }, 409, 'store_order_push_in_progress'],
      [{ kind: 'fortnox_order_invoiced', orderNumber: '58', invoiceNumber: '23' }, 409, 'store_order_fortnox_order_invoiced'],
    ];
    for (const [result, status, code] of cases) {
      h.results.cancelStoreOrder = result;
      expect(await call('cancel', CANCEL)).toMatchObject({ status, body: { errorDetails: { code } } });
    }
    const { cancelStoreOrder } = await import('@/lib/domains/portal/storeOrderFulfilment');
    vi.mocked(cancelStoreOrder).mockRejectedValueOnce(new FortnoxApiError(503, 'Fortnox PUT misslyckades (503)'));
    expect(await call('cancel', CANCEL)).toMatchObject({ status: 502, body: { errorDetails: { code: 'store_order_fortnox_failed' } } });
    vi.mocked(cancelStoreOrder).mockRejectedValueOnce(new FortnoxNotConnectedError());
    expect(await call('cancel', CANCEL)).toMatchObject({ status: 409, body: { errorDetails: { code: 'fortnox_not_connected' } } });
    vi.mocked(cancelStoreOrder).mockRejectedValueOnce(new Error('relation "hemlig" does not exist'));
    const ours = await call('cancel', CANCEL);
    expect(ours).toMatchObject({ status: 500, body: { errorDetails: { code: 'store_order_cancel_failed' } } });
    expect(JSON.stringify(ours.body)).not.toContain('hemlig');
  });

  it('🧨 ett skäl krävs (butiken ser det), högst 2000 tecken, och bara före Levererad; annars 400 och ingenting körs', async () => {
    const bads = [
      {},
      { ...CANCEL, reason: '' },
      { ...CANCEL, reason: '   \n ' },
      { ...CANCEL, reason: 'x'.repeat(2001) },
      { ...CANCEL, reason: `a${String.fromCharCode(0)}b` },
      { ...CANCEL, reason: 42 },
      { ...CANCEL, status: 'delivered' },
      { ...CANCEL, status: 'cancelled' },
      { ...CANCEL, version: 0 },
      { ...CANCEL, version: '2' },
      { reason: 'x', status: 'confirmed' },
      '{',
    ];
    for (const bad of bads) expect((await call('cancel', bad)).status).toBe(400);
    expect(domainCalls()).toHaveLength(0);
    expect((await call('cancel', { ...CANCEL, reason: 'x'.repeat(2000) })).status).toBe(200);
    expect((await call('cancel', { ...CANCEL, status: 'received' })).status).toBe(200);
  });
});
