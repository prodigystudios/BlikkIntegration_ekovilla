import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signPortalRequest } from '@/lib/domains/portal/signature';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * POST /api/portal/jobs/{quoteId}/messages (fas 6), med den riktiga domänkoden mot en databas i minnet. Det som skyddas:
 *   - grinden före allt: osignerat 401, och då har ingenting lästs;
 *   - 201 i appens kuvert, notisen efter svaret, och en upprepning (samma nyckel) som inte gör något nytt;
 *   - samma messageId med en ny nyckel: 201 och fortfarande en rad och en notis;
 *   - kantfallen (William 2026-09-28): 404 unknown_job, 409 work_order_removed, 503 job_not_ready som portalen gör om
 *     (nyckeln släpps), 409 message_conflict;
 *   - kroppen: 400 med fältets sökväg, tecken räknade som Postgres räknar dem.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./helpers/memoryAdmin').memoryAdmin>,
  delivered: [] as unknown[],
  waitUntil: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => h.db.admin) }));
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));
vi.mock('@/lib/domains/notifications/delivery', () => ({
  deliverNotifications: vi.fn(async (_admin: unknown, rows: unknown[]) => (h.delivered.push(...rows), { error: null })),
}));

const SECRET = 's'.repeat(64);
const QUOTE = 'q-2026-015';
const PATH = `/api/portal/jobs/${QUOTE}/messages`;
const MESSAGE = {
  messageId: 'b9c1e0d2-3f4a-4b5c-8d6e-7f8091a2b3c4',
  authorName: 'Sara Ek',
  body: 'Hej från Gävle – vindsluckan sitter ute.',
  sentAt: '2026-09-27T12:00:00Z',
};

let ids = 0;
function database(job: Record<string, unknown> = {}) {
  return memoryAdmin(
    {
      crm_portal_jobs: [
        { quote_id: QUOTE, store_name: 'K-Bygg Sandviken', work_order_id: 'wo-1', work_order_created_at: '2026-09-27T10:00:00Z', ...job },
      ],
      crm_work_orders: [{ id: 'wo-1', assigned_to: 'u-seller', status: 'scheduled' }],
      crm_portal_settings: [{ id: true, fallback_user_id: 'u-reserve' }],
    },
    {
      defaults: (table) =>
        table === 'crm_portal_job_messages' ? { id: `m-${++ids}`, department: '', created_at: new Date().toISOString(), notified_at: null } : {},
    },
  );
}

function request(body: string, options: { key?: string | null; sign?: boolean; path?: string } = {}) {
  const path = options.path ?? PATH;
  const headers: Record<string, string> =
    options.sign === false ? {} : signPortalRequest({ secret: SECRET, method: 'POST', path, rawBody: body, nowSeconds: Date.now() / 1000 });
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? `message-${MESSAGE.messageId}`;
  return new NextRequest(`https://app.ekovilla.se${path}`, { method: 'POST', body, headers });
}

async function post(body: unknown = MESSAGE, options: { key?: string | null; sign?: boolean; quoteId?: string } = {}) {
  const { POST } = await import('@/app/api/portal/jobs/[quoteId]/messages/route');
  const quoteId = options.quoteId ?? QUOTE;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await POST(request(raw, { ...options, path: `/api/portal/jobs/${quoteId}/messages` }), { params: { quoteId } });
  // Arbetet efter svaret körs i processen (ingen Vercel här); låt det bli klart.
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

const messages = () => h.db.tables.crm_portal_job_messages ?? [];

beforeEach(() => {
  ids = 0;
  vi.stubEnv('PORTAL_CRM_SHARED_SECRET', SECRET);
  h.db = database();
  h.delivered = [];
  h.waitUntil.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/portal/jobs/{quoteId}/messages', () => {
  it('osignerat: 401, och ingenting har lästs', async () => {
    expect((await post(MESSAGE, { sign: false })).status).toBe(401);
    expect(h.db.calls).toHaveLength(0);
  });

  it('201 i appens kuvert; meddelandet sparat som butikens; notisen till den som har ordern efter svaret', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, data: { messageId: MESSAGE.messageId } });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ direction: 'from_store', quote_id: QUOTE, body: MESSAGE.body, author_name: 'Sara Ek' });
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    expect(h.delivered).toMatchObject([{ recipient_user_id: 'u-seller', type: 'portal_job.message', title: 'Meddelande från K-Bygg Sandviken' }]);
  });

  it('samma nyckel igen: samma svar ur cachen, ingenting körs igen (ingen ny notis)', async () => {
    const first = await post();
    const again = await post();
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    expect(messages()).toHaveLength(1);
    expect(h.delivered).toHaveLength(1);
  });

  it('samma messageId med en ny nyckel: 201, fortfarande en rad och en notis', async () => {
    await post();
    const res = await post(MESSAGE, { key: `message-${MESSAGE.messageId}-igen` });
    expect(res.status).toBe(201);
    expect(messages()).toHaveLength(1);
    expect(h.delivered).toHaveLength(1);
  });

  it('notisen föll första gången: portalens nästa anrop (ny nyckel, samma meddelande) gör om den, en gång', async () => {
    const { deliverNotifications } = await import('@/lib/domains/notifications/delivery');
    vi.mocked(deliverNotifications).mockResolvedValueOnce({ error: { message: 'push nere' } } as never);
    expect((await post()).status).toBe(201);
    expect(h.delivered).toHaveLength(0);
    expect(messages()[0].notified_at).toBeNull();
    expect((await post(MESSAGE, { key: 'message-igen' })).status).toBe(201);
    expect(h.delivered).toHaveLength(1);
    expect(messages()[0].notified_at).not.toBeNull();
  });

  it('samma messageId med en annan text: 409 message_conflict, det sparade orört', async () => {
    await post();
    const res = await post({ ...MESSAGE, body: 'Något annat.' }, { key: 'message-annan' });
    expect(res.status).toBe(409);
    expect(res.body.errorDetails.code).toBe('message_conflict');
    expect(messages()[0].body).toBe(MESSAGE.body);
  });

  it('okänt jobb, eller ett id som inget jobb kan ha: 404 unknown_job, ingenting sparat', async () => {
    for (const quoteId of ['q-okand', '...']) {
      const res = await post(MESSAGE, { quoteId, key: `message-${quoteId}` });
      expect(res.status, quoteId).toBe(404);
      expect(res.body.errorDetails.code).toBe('unknown_job');
    }
    expect(messages()).toHaveLength(0);
  });

  it('arbetsordern borttagen: 409 work_order_removed', async () => {
    h.db = database({ work_order_id: null });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.errorDetails.code).toBe('work_order_removed');
    expect(messages()).toHaveLength(0);
  });

  it('jobbet tas emot just nu: 503 job_not_ready med Retry-After, och nyckeln släpps så att omförsöket körs', async () => {
    h.db = database({ work_order_id: null, work_order_created_at: null });
    const busy = await post();
    expect(busy.status).toBe(503);
    expect(busy.body.errorDetails.code).toBe('job_not_ready');
    expect(busy.headers.get('Retry-After')).toBe('30');
    Object.assign(h.db.tables.crm_portal_jobs[0], { work_order_id: 'wo-1', work_order_created_at: '2026-09-27T10:00:00Z' });
    expect((await post()).status).toBe(201);
    expect(messages()).toHaveLength(1);
  });

  it('kroppen: 400 invalid_json, invalid_text (nolltecken), validation_error med fältets sökväg', async () => {
    expect((await post('{', { key: 'k-1' })).body.errorDetails.code).toBe('invalid_json');
    expect((await post({ ...MESSAGE, body: 'a\u0000b' }, { key: 'k-2' })).body.errorDetails.code).toBe('invalid_text');
    for (const [key, broken, path] of [
      ['k-3', { ...MESSAGE, body: '   \n ' }, 'body'],
      ['k-4', { ...MESSAGE, authorName: '' }, 'authorName'],
      ['k-5', { ...MESSAGE, messageId: 'har mellanslag' }, 'messageId'],
      ['k-6', { ...MESSAGE, sentAt: 'i går' }, 'sentAt'],
      ['k-7', { ...MESSAGE, body: 'a'.repeat(5001) }, 'body'],
    ] as const) {
      const res = await post(broken, { key });
      expect(res.status, key).toBe(400);
      expect(res.body.errorDetails.code, key).toBe('validation_error');
      expect(res.body.errorDetails.details.issues[0].path, key).toBe(path);
    }
    expect(messages()).toHaveLength(0);
  });

  it('5000 tecken som Postgres räknar dem: 5000 emoji tas emot (10 000 i JavaScript)', async () => {
    const res = await post({ ...MESSAGE, body: '😀'.repeat(5000) });
    expect(res.status).toBe(201);
  });
});
