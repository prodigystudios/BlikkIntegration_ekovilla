import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signPortalRequest } from '@/lib/domains/portal/signature';
import { CONTRACT_JOB } from './helpers/contractFixtures';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * POST /api/portal/jobs (fas 3b). Det som skyddas:
 *   - grinden före allt: osignerat 401, och då har ingenting körts;
 *   - svarscachen: samma Idempotency-Key och kropp ger samma svar utan att intaget körs igen, en annan kropp 422;
 *   - 201 { crmWorkOrderId } i appens kuvert, och arbetet efter svaret (Fortnox, notiserna) körs bara en gång;
 *   - fel i kroppen 400 med fältets sökväg, och bestående svar (400, 409) sparas;
 *   - "ingen kan ta jobbet" och ett kast blir 503/500, och nyckeln släpps så att portalens omförsök körs på nytt.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./helpers/memoryAdmin').memoryAdmin>,
  receive: vi.fn(),
  followUp: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => h.db.admin) }));
// Vercel håller funktionen vid liv tills löftet är klart; här räcker det att se att den fick det.
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));
vi.mock('@/lib/domains/portal/jobIntakeStore', () => ({ receivePortalJob: h.receive, followUpPortalJob: h.followUp }));

const SECRET = 's'.repeat(64);
const PATH = '/api/portal/jobs';
const WORK_ORDER_ID = '22222222-2222-4222-8222-222222222222';

function request(body: string, options: { key?: string | null; sign?: boolean } = {}) {
  const headers: Record<string, string> =
    options.sign === false
      ? {}
      : signPortalRequest({ secret: SECRET, method: 'POST', path: PATH, rawBody: body, nowSeconds: Date.now() / 1000 });
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? `job-${CONTRACT_JOB.quoteId}`;
  return new NextRequest(`https://app.ekovilla.se${PATH}`, { method: 'POST', body, headers });
}

async function post(body: string = JSON.stringify(CONTRACT_JOB), options?: { key?: string | null; sign?: boolean }) {
  const { POST } = await import('@/app/api/portal/jobs/route');
  const res = await POST(request(body, options));
  // Arbetet efter svaret körs i processen (ingen Vercel här); låt det bli klart.
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  vi.stubEnv('PORTAL_CRM_SHARED_SECRET', SECRET);
  h.db = memoryAdmin();
  h.receive.mockReset().mockResolvedValue({ kind: 'created', workOrderId: WORK_ORDER_ID });
  h.followUp.mockReset().mockResolvedValue({ received: 'sent', fortnox: 'created', reasons: [] });
  h.waitUntil.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/portal/jobs', () => {
  it('osignerat: 401, och ingenting har körts', async () => {
    const res = await post(undefined, { sign: false });
    expect(res.status).toBe(401);
    expect(h.receive).not.toHaveBeenCalled();
    expect(h.db.calls).toHaveLength(0);
  });

  it('utan hemlighet: 503, integrationen är av', async () => {
    vi.stubEnv('PORTAL_CRM_SHARED_SECRET', '');
    expect((await post()).status).toBe(503);
    expect(h.receive).not.toHaveBeenCalled();
  });

  it('utan Idempotency-Key: 400, ingenting körs', async () => {
    const res = await post(undefined, { key: null });
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.code).toBe('invalid_idempotency_key');
    expect(h.receive).not.toHaveBeenCalled();
  });

  it('201 med arbetsorderns id i appens kuvert; kroppen och den tolkade kroppen går till intaget; arbetet efter svaret körs', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, data: { crmWorkOrderId: WORK_ORDER_ID } });
    const [, job, payload] = h.receive.mock.calls[0];
    expect(job.quoteId).toBe(CONTRACT_JOB.quoteId);
    expect(payload).toEqual(CONTRACT_JOB);
    expect(h.followUp).toHaveBeenCalledTimes(1);
    expect(h.followUp.mock.calls[0][1]).toBe(CONTRACT_JOB.quoteId);
    expect(h.db.tables.portal_idempotency_keys[0]).toMatchObject({ status: 'done', response_status: 201 });
  });

  it('samma nyckel och kropp igen: samma svar ur cachen, intaget och arbetet efter svaret körs inte igen', async () => {
    await post();
    const again = await post();
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ ok: true, data: { crmWorkOrderId: WORK_ORDER_ID } });
    expect(h.receive).toHaveBeenCalledTimes(1);
    expect(h.followUp).toHaveBeenCalledTimes(1);
  });

  it('samma nyckel med en annan kropp: 422', async () => {
    await post();
    const changed = structuredClone(CONTRACT_JOB) as Record<string, any>;
    changed.costTotal = 1;
    const res = await post(JSON.stringify(changed));
    expect(res.status).toBe(422);
    expect(h.receive).toHaveBeenCalledTimes(1);
  });

  it('ett befintligt jobb (en ny nyckel): 201 med samma id, och arbetet efter svaret körs (det är idempotent)', async () => {
    h.receive.mockResolvedValue({ kind: 'existing', workOrderId: WORK_ORDER_ID });
    const res = await post(undefined, { key: 'job-q-2026-015-igen' });
    expect(res.status).toBe(201);
    expect(res.body.data.crmWorkOrderId).toBe(WORK_ORDER_ID);
    expect(h.followUp).toHaveBeenCalledTimes(1);
  });

  it('ett BOM före JSON:en tas emot', async () => {
    expect((await post(`﻿${JSON.stringify(CONTRACT_JOB)}`)).status).toBe(201);
  });

  it('inte JSON: 400 invalid_json, och svaret sparas', async () => {
    const res = await post('{inte json');
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.code).toBe('invalid_json');
    expect(h.db.tables.portal_idempotency_keys[0]).toMatchObject({ status: 'done', response_status: 400 });
  });

  it('fel i kroppen: 400 med fältets sökväg, intaget körs inte', async () => {
    const bad = structuredClone(CONTRACT_JOB) as Record<string, any>;
    bad.lines[1].unitCost = -5;
    const res = await post(JSON.stringify(bad));
    expect(res.status).toBe(400);
    expect(res.body.errorDetails.code).toBe('validation_error');
    expect(res.body.error).toMatch(/^lines\.1\.unitCost: /);
    expect(res.body.errorDetails.details.issues[0].path).toBe('lines.1.unitCost');
    expect(h.receive).not.toHaveBeenCalled();
  });

  it.each([
    ['conflict', 'job_conflict'],
    ['work_order_removed', 'work_order_removed'],
  ])('%s: 409 %s, svaret sparas, inget arbete efter svaret', async (kind, code) => {
    h.receive.mockResolvedValue({ kind });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.errorDetails.code).toBe(code);
    expect(h.followUp).not.toHaveBeenCalled();
    expect(h.db.tables.portal_idempotency_keys[0]).toMatchObject({ status: 'done', response_status: 409 });
  });

  it('ingen kan ta jobbet: 503 med Retry-After, och nyckeln släpps så att omförsöket körs på nytt', async () => {
    h.receive.mockResolvedValueOnce({ kind: 'no_assignee', assignment: { kind: 'none', county: null, skipped: [] } });
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(res.body.errorDetails.code).toBe('no_assignee');
    expect(h.db.tables.portal_idempotency_keys).toHaveLength(0);

    // Reserven väljs; portalens omförsök med samma nyckel tas emot.
    expect((await post()).status).toBe(201);
    expect(h.receive).toHaveBeenCalledTimes(2);
  });

  it('intaget kastar: 500, nyckeln släpps, omförsöket körs', async () => {
    h.receive.mockRejectedValueOnce(new Error('databasen svarar inte'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('databasen svarar inte');
    expect(h.db.tables.portal_idempotency_keys).toHaveLength(0);
    expect((await post()).status).toBe(201);
  });

  it('🧨 Vercel får vänta in arbetet efter svaret: waitUntil får ett löfte som blir klart först när Fortnox-steget är det', async () => {
    let finish!: () => void;
    h.followUp.mockImplementationOnce(() => new Promise((r) => (finish = () => r({ received: 'sent', fortnox: 'created', reasons: [] }))));
    expect((await post()).status).toBe(201);
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    const work = h.waitUntil.mock.calls[0][0] as Promise<unknown>;
    let settled = false;
    void work.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    finish();
    await work;
    expect(settled).toBe(true);
  });

  it('en upprepning ur cachen ger inget nytt arbete för Vercel att vänta in', async () => {
    await post();
    await post();
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('ett fel i arbetet efter svaret ändrar inte svaret', async () => {
    h.followUp.mockRejectedValueOnce(new Error('Fortnox nere'));
    expect((await post()).status).toBe(201);
  });

  it('ett annat anrop med samma nyckel pågår: 503 med Retry-After', async () => {
    h.db.tables.portal_idempotency_keys = [];
    let release!: () => void;
    h.receive.mockImplementationOnce(() => new Promise((r) => (release = () => r({ kind: 'created', workOrderId: WORK_ORDER_ID }))));
    const { POST } = await import('@/app/api/portal/jobs/route');
    const first = POST(request(JSON.stringify(CONTRACT_JOB)));
    await new Promise((r) => setTimeout(r, 0));
    const second = await POST(request(JSON.stringify(CONTRACT_JOB)));
    expect(second.status).toBe(503);
    expect(second.headers.get('Retry-After')).toBe('5');
    release();
    expect((await first).status).toBe(201);
  });
});
