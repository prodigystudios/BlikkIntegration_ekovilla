import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signPortalRequest } from '@/lib/domains/portal/signature';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Butiksbeställningarnas tre routes (fas 8, kontraktets "Flöde 3"). Det som skyddas:
 *   - grinden före allt: osignerat 401, och då har ingenting körts;
 *   - svarscachen: samma nyckel och kropp ger samma svar utan att intaget körs igen, och arbetet efter svaret (notisen)
 *     körs bara av det anrop som faktiskt gjorde något;
 *   - kontraktets svar: 201 { crmStoreOrderId }, 200 { status: updated | ignored | withdrawn }, 409 BARA för en
 *     bekräftad beställning, 404 unknown_order, 400 när orderId inte är sökvägens eller butiken inte stämmer;
 *   - kroppens fel (400) med fältets sökväg, ett BOM tåls.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./helpers/memoryAdmin').memoryAdmin>,
  receive: vi.fn(),
  change: vi.fn(),
  withdraw: vi.fn(),
  notify: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => h.db.admin) }));
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));
vi.mock('@/lib/domains/portal/storeOrdersStore', () => ({
  receiveStoreOrder: h.receive,
  changeStoreOrder: h.change,
  withdrawStoreOrder: h.withdraw,
  notifyStoreOrder: h.notify,
}));

const SECRET = 's'.repeat(64);
const ORDER_ID = CONTRACT_STORE_ORDER.orderId;
const UPDATED_AT = '2026-10-12T08:20:00.123Z';
const CHANGE = { ...CONTRACT_STORE_ORDER, updatedAt: UPDATED_AT };

function request(method: 'POST' | 'PUT', path: string, body: string, key: string | null, sign = true) {
  const headers: Record<string, string> = sign
    ? signPortalRequest({ secret: SECRET, method, path, rawBody: body, nowSeconds: Date.now() / 1000 })
    : {};
  if (key !== null) headers['Idempotency-Key'] = key;
  return new NextRequest(`https://app.ekovilla.se${path}`, { method, body, headers });
}

async function done(res: Response) {
  // Arbetet efter svaret körs i processen (ingen Vercel här); låt det bli klart.
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

async function post(body: string = JSON.stringify(CONTRACT_STORE_ORDER), options: { key?: string | null; sign?: boolean } = {}) {
  const { POST } = await import('@/app/api/portal/store-orders/route');
  const key = options.key === undefined ? `store-order-${ORDER_ID}` : options.key;
  return done(await POST(request('POST', '/api/portal/store-orders', body, key, options.sign !== false)));
}

async function put(body: string = JSON.stringify(CHANGE), orderId: string = ORDER_ID, options: { key?: string | null; sign?: boolean } = {}) {
  const { PUT } = await import('@/app/api/portal/store-orders/[orderId]/route');
  const path = `/api/portal/store-orders/${orderId}`;
  const key = options.key === undefined ? `store-order-${orderId}-${UPDATED_AT}` : options.key;
  return done(await PUT(request('PUT', path, body, key, options.sign !== false), { params: { orderId } }));
}

async function withdraw(body: string = JSON.stringify({ orderId: ORDER_ID }), orderId: string = ORDER_ID, options: { sign?: boolean } = {}) {
  const { POST } = await import('@/app/api/portal/store-orders/[orderId]/withdraw/route');
  const path = `/api/portal/store-orders/${orderId}/withdraw`;
  return done(await POST(request('POST', path, body, `store-order-${orderId}-withdraw`, options.sign !== false), { params: { orderId } }));
}

beforeEach(() => {
  vi.stubEnv('PORTAL_CRM_SHARED_SECRET', SECRET);
  h.db = memoryAdmin();
  h.receive.mockReset().mockResolvedValue({ kind: 'created', id: 'order-1' });
  h.change.mockReset().mockResolvedValue({ kind: 'updated', id: 'order-1' });
  h.withdraw.mockReset().mockResolvedValue({ kind: 'withdrawn', id: 'order-1' });
  h.notify.mockReset().mockResolvedValue('sent');
  h.waitUntil.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/portal/store-orders', () => {
  it('osignerat: 401, ingenting körs', async () => {
    const res = await post(undefined, { sign: false });
    expect(res.status).toBe(401);
    expect(h.receive).not.toHaveBeenCalled();
    expect(h.db.calls).toHaveLength(0);
  });

  it('201 med beställningens id i appens kuvert; tolkad och rå kropp till intaget; notisen efter svaret', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, data: { crmStoreOrderId: 'order-1' } });
    const [, order, payload] = h.receive.mock.calls[0];
    expect(order.orderId).toBe(ORDER_ID);
    expect(payload).toEqual(CONTRACT_STORE_ORDER);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][1]).toBe('order-1');
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('en befintlig beställning: också 201, och notisen görs (den skickas ändå bara en gång)', async () => {
    h.receive.mockResolvedValue({ kind: 'existing', id: 'order-1' });
    const res = await post();
    expect(res.status).toBe(201);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('samma nyckel och kropp igen: samma svar ur cachen, intaget och notisen körs inte igen', async () => {
    const first = await post();
    const second = await post();
    expect(second).toMatchObject({ status: first.status, body: first.body });
    expect(h.receive).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('konflikt 409 store_order_conflict; ingen kan ta den 503 no_assignee med Retry-After, nyckeln släpps', async () => {
    h.receive.mockResolvedValue({ kind: 'conflict' });
    const conflict = await post();
    expect(conflict.status).toBe(409);
    expect(conflict.body.errorDetails.code).toBe('store_order_conflict');

    h.receive.mockResolvedValue({ kind: 'no_assignee', assignment: { kind: 'none', county: null, skipped: [] } });
    const busy = await post(undefined, { key: 'store-order-annan' });
    expect(busy.status).toBe(503);
    expect(busy.body.errorDetails.code).toBe('no_assignee');
    expect(busy.headers.get('Retry-After')).toBe('300');
    expect(h.notify).not.toHaveBeenCalled();
    // 503 sparas inte: samma nyckel körs igen.
    h.receive.mockResolvedValue({ kind: 'created', id: 'order-1' });
    expect((await post(undefined, { key: 'store-order-annan' })).status).toBe(201);
  });

  it('fel i kroppen: 400 med fältets sökväg; intaget körs inte', async () => {
    const m3 = structuredClone(CONTRACT_STORE_ORDER) as Record<string, any>;
    m3.lines[0].unit = 'm3';
    const res = await post(JSON.stringify(m3));
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.code).toBe('validation_error');
    expect(res.body.errorDetails.details.issues[0].path).toBe('lines.0.unit');
    expect((await post('inte json', { key: 'k2' })).body.errorDetails.code).toBe('invalid_json');
    const nul = structuredClone(CONTRACT_STORE_ORDER) as Record<string, any>;
    nul.delivery.message = `a${String.fromCharCode(0)}b`;
    const invalid = await post(JSON.stringify(nul), { key: 'k3' });
    expect(invalid.body.errorDetails.code).toBe('invalid_text');
    expect(invalid.body.error).toContain('delivery.message');
    expect(h.receive).not.toHaveBeenCalled();
  });

  it('ett inledande BOM tåls (det signerades)', async () => {
    const res = await post(String.fromCharCode(0xfeff) + JSON.stringify(CONTRACT_STORE_ORDER));
    expect(res.status).toBe(201);
    expect(h.receive).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/portal/store-orders/{orderId}', () => {
  it('osignerat: 401, ingenting körs', async () => {
    expect((await put(undefined, undefined, { sign: false })).status).toBe(401);
    expect(h.change).not.toHaveBeenCalled();
  });

  it('updated: 200 { status: "updated" }, den tolkade ändringen till intaget, notisen efter svaret', async () => {
    const res = await put();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'updated' } });
    expect(h.change.mock.calls[0][1]).toMatchObject({ orderId: ORDER_ID, updatedAt: UPDATED_AT });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('ignored: 200 { status: "ignored" }, ingen notis', async () => {
    h.change.mockResolvedValue({ kind: 'ignored', id: 'order-1' });
    const res = await put();
    expect(res).toMatchObject({ status: 200, body: { ok: true, data: { status: 'ignored' } } });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('bekräftad: 409 store_order_confirmed, och bara då', async () => {
    h.change.mockResolvedValue({ kind: 'confirmed', id: 'order-1' });
    const res = await put();
    expect(res.status).toBe(409);
    expect(res.body.errorDetails.code).toBe('store_order_confirmed');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('en annan butik: 400 store_order_mismatch; okänd: 404 unknown_order', async () => {
    h.change.mockResolvedValue({ kind: 'mismatch', field: 'store.resellerId' });
    const mismatch = await put();
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.errorDetails.code).toBe('store_order_mismatch');
    h.change.mockResolvedValue({ kind: 'unknown_order' });
    const unknown = await put(undefined, undefined, { key: 'annan-nyckel' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.errorDetails.code).toBe('unknown_order');
  });

  it('orderId i kroppen är inte sökvägens: 400, intaget körs inte', async () => {
    const res = await put(JSON.stringify(CHANGE), 'so-annan');
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.details.issues[0].path).toBe('orderId');
    expect(h.change).not.toHaveBeenCalled();
  });

  it('utan updatedAt: 400 validation_error', async () => {
    const res = await put(JSON.stringify(CONTRACT_STORE_ORDER));
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.details.issues[0].path).toBe('updatedAt');
    expect(h.change).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/store-orders/{orderId}/withdraw', () => {
  it('osignerat: 401, ingenting körs', async () => {
    expect((await withdraw(undefined, undefined, { sign: false })).status).toBe(401);
    expect(h.withdraw).not.toHaveBeenCalled();
  });

  it('withdrawn: 200 { status: "withdrawn" }, notisen efter svaret', async () => {
    const res = await withdraw();
    expect(res).toMatchObject({ status: 200, body: { ok: true, data: { status: 'withdrawn' } } });
    expect(h.withdraw.mock.calls[0][1]).toBe(ORDER_ID);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('bekräftad 409, makulerad 200 ignored, okänd 404', async () => {
    h.withdraw.mockResolvedValue({ kind: 'confirmed', id: 'order-1' });
    const confirmed = await withdraw();
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.errorDetails.code).toBe('store_order_confirmed');

    h.db = memoryAdmin();
    h.withdraw.mockResolvedValue({ kind: 'ignored', id: 'order-1' });
    expect(await withdraw()).toMatchObject({ status: 200, body: { data: { status: 'ignored' } } });

    h.db = memoryAdmin();
    h.withdraw.mockResolvedValue({ kind: 'unknown_order' });
    expect((await withdraw()).status).toBe(404);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('orderId i kroppen är inte sökvägens: 400', async () => {
    const res = await withdraw(JSON.stringify({ orderId: 'so-annan' }));
    expect(res.status).toBe(400);
    expect(h.withdraw).not.toHaveBeenCalled();
  });
});
