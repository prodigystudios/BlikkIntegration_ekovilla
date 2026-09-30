import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyPortalRequest } from '@/app/api/portal/_shared';
import { signPortalRequest } from '@/lib/domains/portal/signature';
import { TEST_DATABASE_HOST } from '@/lib/domains/portal/config';
import { SIGNATURE_VECTOR } from './helpers/contractFixtures';

const SECRET = 'a'.repeat(64);
const NOW = 1_790_000_000;
const ENV = { PORTAL_CRM_SHARED_SECRET: SECRET };

function signed(
  path: string,
  body: string | Uint8Array,
  options: { method?: string; signedPath?: string; signedBody?: string | Uint8Array; now?: number; secret?: string } = {},
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

  it('godtar kontraktets vektor, räknad med Python, genom hela grinden', async () => {
    const { secret, timestamp, method, path, body, signature } = SIGNATURE_VECTOR;
    const request = new NextRequest(`https://app.ekovilla.se${path}`, {
      method,
      body,
      headers: { 'X-Ekovilla-Timestamp': timestamp, 'X-Ekovilla-Signature': signature },
    });
    expect(await verifyPortalRequest(request, { PORTAL_CRM_SHARED_SECRET: secret }, Number(timestamp))).toEqual({ ok: true, rawBody: body });
  });

  it('prövar signaturen över kroppens byte: ett BOM följer med, och godtas', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    const result = await verifyPortalRequest(signed('/api/portal/jobs', bytes), ENV, NOW);
    expect(result).toEqual({ ok: true, rawBody: '\uFEFF{"a":1}' });
  });

  it('korrekt signerad men inte UTF-8: 400, inte 401 — samma byte blir inte rätt av att skickas igen', async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0x7d]);
    const result = await verifyPortalRequest(signed('/api/portal/jobs', bytes), ENV, NOW);
    if (result.ok) throw new Error('skulle ha nekats');
    expect(result.response.status).toBe(400);
    expect((await json(result.response)).errorDetails?.code).toBe('invalid_encoding');
  });

  it('🧨 läser inte kroppen förrän headrarna stämmer — ett osignerat anrop kostar ingenting', async () => {
    const stream = new ReadableStream({ pull() { throw new Error('kroppen lästes'); } });
    const request = new NextRequest('https://app.ekovilla.se/api/portal/jobs', { method: 'POST', body: stream, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1]);
    const result = await verifyPortalRequest(request, ENV, NOW);
    if (result.ok) throw new Error('skulle ha nekats');
    expect(result.response.status).toBe(401);
  });

  it('en kropp som inte går att läsa ger 400, inte ett kast', async () => {
    const stream = new ReadableStream({ pull() { throw new Error('anslutningen bröts'); } });
    const headers = signPortalRequest({ secret: SECRET, method: 'POST', path: '/api/portal/jobs', rawBody: '', nowSeconds: NOW });
    const request = new NextRequest('https://app.ekovilla.se/api/portal/jobs', { method: 'POST', body: stream, headers, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1]);
    const result = await verifyPortalRequest(request, ENV, NOW);
    if (result.ok) throw new Error('skulle ha nekats');
    expect(result.response.status).toBe(400);
    expect((await json(result.response)).errorDetails?.code).toBe('unreadable_body');
  });

  it('413 på en för stor kropp, före läsningen', async () => {
    const request = signed('/api/portal/jobs', '{}');
    request.headers.set('content-length', String(6 * 1024 * 1024));
    const result = await verifyPortalRequest(request, ENV, NOW);
    if (result.ok) throw new Error('skulle ha nekats');
    expect(result.response.status).toBe(413);
  });

  it('400 på en sökväg med tecken som portalen aldrig skickar (procentkodning, mellanslag)', async () => {
    for (const path of ['/api/portal/jobs/q%201/messages', '/api/portal/jobs/q%C3%A5']) {
      const result = await verifyPortalRequest(signed(path, '{}'), ENV, NOW);
      if (result.ok) throw new Error(`${path} skulle ha nekats`);
      expect(result.response.status).toBe(400);
      expect((await json(result.response)).errorDetails?.code).toBe('invalid_path');
    }
  });

  it('503 när hemligheten saknas — integrationen är av, och anropet prövas inte', async () => {
    const result = await verifyPortalRequest(signed('/api/portal/ping', ''), {}, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect((await json(result.response)).errorDetails?.code).toBe('portal_not_configured');
  });

  /** T4b: testportalens jobb får inte skrivas in i prods databas, om testmiljön ärvt prods nycklar. */
  it('🧨 503 utanför prod mot en annan databas än den lokala eller testprojektet — också korrekt signerat', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preview = { ...ENV, NODE_ENV: 'production', VERCEL_ENV: 'preview' };
    for (const env of [
      { ...preview, SUPABASE_URL: 'https://prodref.supabase.co' },
      { ...preview, SUPABASE_URL: `https://${TEST_DATABASE_HOST}`, NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co' },
    ]) {
      const result = await verifyPortalRequest(signed('/api/portal/ping', ''), env, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(503);
        const payload = await json(result.response);
        expect(payload.errorDetails?.code).toBe('portal_not_configured');
        expect(JSON.stringify(payload)).not.toContain('prodref');
      }
    }
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
    const ok = await verifyPortalRequest(signed('/api/portal/ping', ''), { ...preview, SUPABASE_URL: `https://${TEST_DATABASE_HOST}` }, NOW);
    expect(ok).toEqual({ ok: true, rawBody: '' });
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
