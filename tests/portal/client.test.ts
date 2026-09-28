import { describe, it, expect, vi } from 'vitest';
import { classifyPortalResult, sendToPortal } from '@/lib/domains/portal/client';
import { verifyPortalSignature } from '@/lib/domains/portal/signature';

const SECRET = 'portal-kontraktsvektor-0123456789abcdef0123456789abcdef';
const NOW = 1_790_000_000;

describe('classifyPortalResult', () => {
  const response = (status: number) => ({ kind: 'response' as const, status, bodyExcerpt: '' });

  it('2xx är levererat', () => {
    for (const status of [200, 201, 202, 204]) expect(classifyPortalResult(response(status))).toBe('sent');
  });

  it('🧨 401 görs om, inte ges upp (beslut 2026-09-28)', () => {
    expect(classifyPortalResult(response(401))).toBe('retry');
  });

  it('5xx, timeout, nätfel och HTTP:s "försök senare" görs om', () => {
    for (const status of [500, 502, 503, 504, 408, 425, 429]) expect(classifyPortalResult(response(status))).toBe('retry');
    expect(classifyPortalResult({ kind: 'timeout' })).toBe('retry');
    expect(classifyPortalResult({ kind: 'network_error', message: 'ECONNRESET' })).toBe('retry');
  });

  it('en omdirigering följs inte och görs om — adressen är felinställd', () => {
    for (const status of [301, 302, 307, 308]) expect(classifyPortalResult(response(status))).toBe('retry');
  });

  it('övriga 4xx ges upp; 409 är kontraktets "går inte längre"', () => {
    for (const status of [400, 403, 404, 409, 413, 422]) expect(classifyPortalResult(response(status))).toBe('dead');
  });
});

describe('sendToPortal', () => {
  const payload = { type: 'job.confirmed', occurredAt: '2026-09-28T08:00:00Z', data: { quoteId: 'q-2026-015', ekovillaOrderNumber: '1043' } };

  function fakeFetch(response: Response | Error) {
    return vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it('skickar exakt det som signerats, till rätt route, och följer aldrig en omdirigering', async () => {
    const fetchImpl = fakeFetch(new Response('{"ok":true}', { status: 202 }));
    const result = await sendToPortal({
      baseUrl: 'https://test.partner.ekovilla.se',
      secret: SECRET,
      path: '/api/ekovilla/events',
      idempotencyKey: 'job.confirmed-q-2026-015-2026-09-28T08:00:00Z',
      payload,
      nowSeconds: NOW,
      fetchImpl,
    });
    expect(result).toEqual({ kind: 'response', status: 202, bodyExcerpt: '{"ok":true}' });

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.partner.ekovilla.se/api/ekovilla/events');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(JSON.stringify(payload));
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('job.confirmed-q-2026-015-2026-09-28T08:00:00Z');
    expect(headers['Content-Type']).toMatch(/^application\/json/);

    // Mottagaren — portalen — godtar signaturen för just den här routen och kroppen.
    expect(
      verifyPortalSignature({
        secret: SECRET,
        method: 'POST',
        path: '/api/ekovilla/events',
        rawBody: init.body as string,
        timestampHeader: headers['X-Ekovilla-Timestamp'],
        signatureHeader: headers['X-Ekovilla-Signature'],
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('en timeout och ett nätfel blir sina egna utfall, aldrig ett kast', async () => {
    const base = { baseUrl: 'https://test.partner.ekovilla.se', secret: SECRET, path: '/api/ekovilla/events', idempotencyKey: 'k', payload, nowSeconds: NOW };
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(await sendToPortal({ ...base, fetchImpl: fakeFetch(timeout) })).toEqual({ kind: 'timeout' });
    expect(await sendToPortal({ ...base, fetchImpl: fakeFetch(new TypeError('fetch failed')) })).toEqual({
      kind: 'network_error',
      message: 'fetch failed',
    });
  });

  it('sparar bara början av svarskroppen', async () => {
    const result = await sendToPortal({
      baseUrl: 'https://test.partner.ekovilla.se',
      secret: SECRET,
      path: '/api/ekovilla/events',
      idempotencyKey: 'k',
      payload,
      nowSeconds: NOW,
      fetchImpl: fakeFetch(new Response('x'.repeat(5000), { status: 500 })),
    });
    expect(result).toMatchObject({ kind: 'response', status: 500 });
    expect((result as { bodyExcerpt: string }).bodyExcerpt).toHaveLength(500);
  });
});
