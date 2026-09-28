import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, ekonomiUser, salesUser } from '../crm/helpers/supabase';

/**
 * GET/POST /api/crm/portal/jobs/[workOrderId]/messages (fas 6), kortet "Butiken". Grinden före allt: utan inloggning
 * 401, utan nyckeln 403 (läsa: crm.workorder.read, svara: crm.workorder.write), och då har ingen klient byggts och
 * ingenting körts. Sedan id:t och kroppen (400), och översättningen av domänens utfall. Vem som får svara avgör RLS i
 * domänen (supabase/checks/portal_job_messages.sql); `canReply` räknas ur nycklarna som skickas med här.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  listed: [] as unknown[][],
  sent: [] as unknown[][],
  view: null as unknown,
  result: null as unknown,
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
vi.mock('@/lib/domains/portal/jobMessagesStore', () => ({
  listPortalJobMessages: vi.fn(async (...args: unknown[]) => (h.listed.push(args), h.view)),
  sendPortalJobReply: vi.fn(async (...args: unknown[]) => (h.sent.push(args), h.result)),
}));

const WO = '22222222-2222-4222-8222-222222222222';
const REPLY_ID = 'c0ffee00-1111-4222-8333-444455556666';
const MESSAGE = { id: 'm-1', direction: 'to_store', authorName: 'Anna Berg', department: 'Planering', body: 'Hej', sentAt: 'x', delivery: 'sent' };
const SALES_KEYS = ['crm.access', 'crm.write', 'crm.workorder.read', 'crm.workorder.write'];

async function route() {
  return import('@/app/api/crm/portal/jobs/[workOrderId]/messages/route');
}

async function get(id = WO) {
  const { GET } = await route();
  const res = await GET(new Request(`http://localhost/api/crm/portal/jobs/${id}/messages`), { params: { workOrderId: id } });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function post(body: unknown = { messageId: REPLY_ID, body: '  Vi kommer tisdag.  ', department: 'Planering' }, id = WO) {
  const { POST } = await route();
  const res = await POST(
    new Request(`http://localhost/api/crm/portal/jobs/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { workOrderId: id } },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  h.held = new Set(SALES_KEYS);
  h.user = { ...salesUser, name: 'Anna Berg' };
  h.clients = 0;
  h.listed = [];
  h.sent = [];
  h.view = { storeName: 'K-Bygg Sandviken', canReply: true, messages: [MESSAGE] };
  h.result = { kind: 'sent', created: true, message: MESSAGE };
});

describe('GET: tråden', () => {
  it('utan inloggning 401, utan crm.workorder.read 403; ingen klient, ingenting läst', async () => {
    h.user = null;
    expect((await get()).status).toBe(401);
    h.user = salesUser;
    h.held = new Set(['crm.access']);
    expect((await get()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.listed).toHaveLength(0);
  });

  it('ett id som inte är en uuid: 400', async () => {
    expect((await get('inte-ett-id')).status).toBe(400);
    expect(h.listed).toHaveLength(0);
  });

  it('200 med tråden; sessionen läser, och nycklarna avgör canReply (skrivnyckeln, admin)', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: h.view });
    const [client, workOrderId, viewer] = h.listed[0];
    expect(client).toEqual({ kind: 'session' });
    expect(workOrderId).toBe(WO);
    expect(viewer).toEqual({ userId: salesUser.id, canWrite: true, isAdmin: false });
  });

  it('ekonomi (bara läsnyckeln) läser, men utan skrivnyckeln; admin med crm.admin', async () => {
    h.user = ekonomiUser;
    h.held = new Set(['crm.workorder.read', 'crm.report.read']);
    await get();
    expect(h.listed[0][2]).toEqual({ userId: ekonomiUser.id, canWrite: false, isAdmin: false });
    h.user = adminUser;
    h.held = new Set([...SALES_KEYS, 'crm.admin']);
    await get();
    expect(h.listed[1][2]).toEqual({ userId: adminUser.id, canWrite: true, isAdmin: true });
  });

  it('ingen portalorder som du ser: 404', async () => {
    h.view = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.body.errorDetails.code).toBe('portal_job_not_found');
  });
});

describe('POST: svaret', () => {
  it('utan inloggning 401, utan crm.workorder.write 403 (ekonomi, konsult); ingen klient, ingenting skickat', async () => {
    h.user = null;
    expect((await post()).status).toBe(401);
    h.user = ekonomiUser;
    h.held = new Set(['crm.workorder.read']);
    expect((await post()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it('kroppen: tomt, för långt (tecken som Postgres räknar), fel avdelning, fel id, nolltecken, trasig JSON: 400', async () => {
    for (const body of [
      { messageId: REPLY_ID, body: '  \n ', department: 'Planering' },
      { messageId: REPLY_ID, body: 'a'.repeat(5001), department: 'Planering' },
      { messageId: REPLY_ID, body: 'Hej', department: '' },
      { messageId: REPLY_ID, body: 'Hej', department: 'Montage' },
      { messageId: 'inte-en-uuid', body: 'Hej', department: 'Planering' },
      { messageId: REPLY_ID, body: 'a\u0000b', department: 'Planering' },
      '{',
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await post({ messageId: REPLY_ID, body: 'Hej' }, 'inte-ett-id')).status).toBe(400);
    expect(h.sent).toHaveLength(0);
  });

  it('5000 emoji går igenom (5000 tecken för Postgres, 10 000 för JavaScript)', async () => {
    expect((await post({ messageId: REPLY_ID, body: '😀'.repeat(5000), department: 'Ekonomi' })).status).toBe(201);
  });

  it('201 med svaret; texten trimmad, svararen och namnet ur inloggningen, sessionen och service-rollen till domänen', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, data: { message: MESSAGE, created: true } });
    const [session, admin, input, deps] = h.sent[0] as [unknown, unknown, Record<string, unknown>, Record<string, unknown>];
    expect(session).toEqual({ kind: 'session' });
    expect(admin).toEqual({ kind: 'admin' });
    expect(input).toEqual({
      workOrderId: WO,
      messageId: REPLY_ID,
      body: 'Vi kommer tisdag.',
      department: 'Planering',
      actor: { id: salesUser.id, name: 'Anna Berg' },
    });
    expect(deps.env).toBe(process.env);
  });

  it('domänens nej: 403 forbidden, 404 not_found, 409 conflict', async () => {
    for (const [kind, status, code] of [
      ['forbidden', 403, 'portal_reply_forbidden'],
      ['not_found', 404, 'portal_job_not_found'],
      ['conflict', 409, 'portal_message_conflict'],
    ] as const) {
      h.result = { kind };
      const res = await post();
      expect(res.status, kind).toBe(status);
      expect(res.body.errorDetails.code, kind).toBe(code);
    }
  });
});
