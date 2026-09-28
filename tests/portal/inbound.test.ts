import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyPortalRequest } from '@/app/api/portal/_shared';
import { signPortalRequest } from '@/lib/domains/portal/signature';

const SECRET = 'a'.repeat(64);
const NOW = 1_790_000_000;
const ENV = { PORTAL_CRM_SHARED_SECRET: SECRET };

function signed(
  path: string,
  body: string,
  options: { method?: string; signedPath?: string; signedBody?: string; now?: number; secret?: string } = {},
) {
  const method = options.method ?? 'POST';
  const headers = signPortalRequest({
    secret: options.secret ?? SECRET,
    method,
    path: options.signedPath ?? path,
    rawBody: options.signedBody ?? body,
    nowSeconds: options.now ?? NOW,
  });
  return new NextRequest(`https://app.ekovilla.se${path}`, { method, body, headers });
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string; errorDetails?: { code: string }; data?: unknown };
}

describe('verifyPortalRequest', () => {
  it('släpper igenom ett korrekt signerat anrop och lämnar tillbaka den råa kroppen', async () => {
    const body = '{"messageId":"msg-1","body":"Hej från Gävle"}';
    const result = await verifyPortalRequest(signed('/api/portal/jobs/q-1/messages', body), ENV, NOW);
    expect(result).toEqual({ ok: true, rawBody: body });
  });

  it('prövar sökvägen som den står i URL:en, procentkodad', async () => {
    const path = '/api/portal/jobs/q%201/messages';
    expect(await verifyPortalRequest(signed(path, '{}'), ENV, NOW)).toMatchObject({ ok: true });
  });

  it('503 när hemligheten saknas — integrationen är av, och anropet prövas inte', async () => {
    const result = await verifyPortalRequest(signed('/api/portal/ping', ''), {}, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect((await json(result.response)).errorDetails?.code).toBe('portal_not_configured');
  });

  it('🧨 401 på en signatur för en annan route — en signerad ping duger inte till något annat', async () => {
    const request = signed('/api/portal/store-orders/so-1/withdraw', '', { signedPath: '/api/portal/ping' });
    const result = await verifyPortalRequest(request, ENV, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('401 på en ändrad kropp, fel hemlighet, fel metod och en gammal tidsstämpel', async () => {
    const cases = [
      signed('/api/portal/jobs', '{"a":2}', { signedBody: '{"a":1}' }),
      signed('/api/portal/jobs', '{}', { secret: 'b'.repeat(64) }),
      signed('/api/portal/jobs', '{}', { now: NOW - 301 }),
      new NextRequest('https://app.ekovilla.se/api/portal/jobs', { method: 'POST', body: '{}' }),
    ];
    for (const request of cases) {
      const result = await verifyPortalRequest(request, ENV, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    }
    // En POST-signatur på ett PUT-anrop.
    const put = signed('/api/portal/store-orders/so-1', '{}', { method: 'PUT' });
    const asPost = new NextRequest(put.url, { method: 'POST', body: '{}', headers: put.headers });
    expect((await verifyPortalRequest(asPost, ENV, NOW)).ok).toBe(false);
  });

  it('berättar inte varför ett anrop nekades', async () => {
    const result = await verifyPortalRequest(signed('/api/portal/jobs', '{}', { now: NOW - 301 }), ENV, NOW);
    if (result.ok) throw new Error('skulle ha nekats');
    const body = JSON.stringify(await json(result.response));
    expect(body).not.toMatch(/stale|timestamp|signature_mismatch|tidsstämpel/i);
  });
});

describe('POST /api/portal/ping', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('svarar 200 på ett korrekt signerat anrop', async () => {
    vi.stubEnv('PORTAL_CRM_SHARED_SECRET', SECRET);
    const { POST } = await import('@/app/api/portal/ping/route');
    const res = await POST(signed('/api/portal/ping', '', { now: Date.now() / 1000 }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, data: { pong: true } });
  });

  it('401 utan signatur', async () => {
    vi.stubEnv('PORTAL_CRM_SHARED_SECRET', SECRET);
    const { POST } = await import('@/app/api/portal/ping/route');
    const res = await POST(new NextRequest('https://app.ekovilla.se/api/portal/ping', { method: 'POST', body: '' }));
    expect(res.status).toBe(401);
  });

  it('503 när integrationen är av — så svarar prod tills hemligheten sätts', async () => {
    vi.stubEnv('PORTAL_CRM_SHARED_SECRET', '');
    const { POST } = await import('@/app/api/portal/ping/route');
    const res = await POST(signed('/api/portal/ping', '', { now: Date.now() / 1000 }));
    expect(res.status).toBe(503);
  });
});
