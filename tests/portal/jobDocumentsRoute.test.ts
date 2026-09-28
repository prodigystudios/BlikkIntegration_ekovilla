import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ekonomiUser, salesUser } from '../crm/helpers/supabase';

/**
 * GET/POST /api/crm/portal/jobs/[workOrderId]/documents och GET …/documents/[documentId] (fas 7), dokumenten i kortet
 * "Butiken". Grinden före allt: utan inloggning 401, utan nyckeln 403 (läsa och öppna: crm.workorder.read, skicka:
 * crm.workorder.write), och då har ingen klient byggts och ingenting körts. Sedan id:n och kroppen (400), översättningen
 * av domänens utfall, att dokumentet skickas direkt efter svaret (i waitUntil, bara när det väntar), och att "Öppna"
 * svarar med exakt den frysta filen. Vem som får skicka avgör databasens svarsregel
 * (supabase/checks/portal_job_documents.sql).
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  listed: [] as unknown[][],
  sent: [] as unknown[][],
  opened: [] as unknown[][],
  view: null as unknown,
  result: null as unknown,
  file: null as unknown,
  waitUntil: vi.fn(),
  dispatch: vi.fn(),
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
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));
vi.mock('@/lib/domains/portal/outbox', () => ({ dispatchPortalOutbox: h.dispatch }));
vi.mock('@/lib/domains/portal/jobDocumentsStore', () => ({
  listPortalJobDocuments: vi.fn(async (...args: unknown[]) => (h.listed.push(args), h.view)),
  sendPortalJobDocument: vi.fn(async (...args: unknown[]) => (h.sent.push(args), h.result)),
  openPortalJobDocument: vi.fn(async (...args: unknown[]) => (h.opened.push(args), h.file)),
  portalDocumentSources: vi.fn(() => ({ kind: 'sources' })),
}));

const WO = '22222222-2222-4222-8222-222222222222';
const DOC_ID = 'c0ffee00-1111-4222-8333-444455556666';
const DOCUMENT = {
  id: DOC_ID,
  kind: 'order_confirmation',
  status: 'ready',
  name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
  sizeBytes: 500,
  error: null,
  createdByName: 'Anna Berg',
  createdAt: '2026-10-12T08:30:00.000Z',
  delivery: 'sent',
};
const SALES_KEYS = ['crm.access', 'crm.write', 'crm.workorder.read', 'crm.workorder.write'];

const route = () => import('@/app/api/crm/portal/jobs/[workOrderId]/documents/route');
const openRoute = () => import('@/app/api/crm/portal/jobs/[workOrderId]/documents/[documentId]/route');

async function get(id = WO) {
  const { GET } = await route();
  const res = await GET(new Request(`http://localhost/api/crm/portal/jobs/${id}/documents`), { params: { workOrderId: id } });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function post(body: unknown = { documentId: DOC_ID, kind: 'order_confirmation' }, id = WO) {
  const { POST } = await route();
  const res = await POST(
    new Request(`http://localhost/api/crm/portal/jobs/${id}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { workOrderId: id } },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function open(documentId = DOC_ID, id = WO, headers: Record<string, string> = {}) {
  const { GET } = await openRoute();
  return GET(new Request(`http://localhost/api/crm/portal/jobs/${id}/documents/${documentId}`, { headers }), {
    params: { workOrderId: id, documentId },
  });
}

beforeEach(() => {
  h.held = new Set(SALES_KEYS);
  h.user = { ...salesUser, name: 'Anna Berg' };
  h.clients = 0;
  h.listed = [];
  h.sent = [];
  h.opened = [];
  h.view = { canSend: true, blocked: null, latest: { order_confirmation: DOCUMENT, self_inspection: null }, selfInspection: null };
  h.result = { kind: 'sent', created: true, document: DOCUMENT };
  h.file = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf' };
  h.waitUntil.mockReset();
  h.dispatch.mockReset().mockResolvedValue({ ran: true });
});

describe('GET: dokumenten', () => {
  it('utan inloggning 401, utan crm.workorder.read 403; ingen klient, ingenting läst', async () => {
    h.user = null;
    expect((await get()).status).toBe(401);
    h.user = salesUser;
    h.held = new Set(['crm.access']);
    expect((await get()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.listed).toHaveLength(0);
  });

  it('200 med vyn; sessionen och service-rollen till domänen; ekonomi läser', async () => {
    const res = await get();
    expect(res).toEqual({ status: 200, body: { ok: true, data: h.view } });
    expect(h.listed[0]).toEqual([{ kind: 'session' }, { kind: 'admin' }, WO]);
    h.user = ekonomiUser;
    h.held = new Set(['crm.workorder.read']);
    expect((await get()).status).toBe(200);
  });

  it('ett id som inte är en uuid: 400; ingen portalorder: 404', async () => {
    expect((await get('inte-ett-id')).status).toBe(400);
    h.view = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.body.errorDetails.code).toBe('portal_job_not_found');
  });
});

describe('POST: skicka', () => {
  it('utan inloggning 401, utan crm.workorder.write 403 (ekonomi); ingen klient, ingenting skickat', async () => {
    h.user = null;
    expect((await post()).status).toBe(401);
    h.user = ekonomiUser;
    h.held = new Set(['crm.workorder.read']);
    expect((await post()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it('kroppen: fel id, okänd sort, egenkontroll utan vilken, trasig JSON: 400', async () => {
    for (const body of [
      { documentId: 'inte-en-uuid', kind: 'order_confirmation' },
      { documentId: DOC_ID, kind: 'invoice' },
      { documentId: DOC_ID, kind: 'self_inspection' },
      { documentId: DOC_ID, kind: 'self_inspection', sourcePath: '   ' },
      '{',
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post({ documentId: DOC_ID, kind: 'order_confirmation' }, 'inte-ett-id')).status).toBe(400);
    expect(h.sent).toHaveLength(0);
  });

  it('201; den inloggade som avsändare, källorna och båda klienterna till domänen', async () => {
    const res = await post();
    expect(res).toEqual({ status: 201, body: { ok: true, data: { document: DOCUMENT, created: true } } });
    const [session, admin, sources, input] = h.sent[0] as [unknown, unknown, unknown, Record<string, unknown>];
    expect(session).toEqual({ kind: 'session' });
    expect(admin).toEqual({ kind: 'admin' });
    expect(sources).toEqual({ kind: 'sources' });
    expect(input).toEqual({
      workOrderId: WO,
      documentId: DOC_ID,
      kind: 'order_confirmation',
      sourcePath: null,
      actor: { id: salesUser.id, name: 'Anna Berg' },
    });
  });

  it('🧨 en sökväg följer bara med för egenkontrollen, och bara för att jämföras', async () => {
    await post({ documentId: DOC_ID, kind: 'order_confirmation', sourcePath: 'Egenkontroller/x.pdf' });
    expect((h.sent[0][3] as Record<string, unknown>).sourcePath).toBeNull();
    await post({ documentId: DOC_ID, kind: 'self_inspection', sourcePath: ' Egenkontroller/Egenkontroll_K_26.pdf ' });
    expect((h.sent[1][3] as Record<string, unknown>).sourcePath).toBe('Egenkontroller/Egenkontroll_K_26.pdf');
  });

  it('skickas direkt EFTER svaret, i waitUntil, bara när dokumentet väntar', async () => {
    h.result = { kind: 'sent', created: true, document: { ...DOCUMENT, delivery: 'sending' } };
    let finish: (v: unknown) => void = () => {};
    h.dispatch.mockReturnValue(new Promise((r) => (finish = r)));
    expect((await post()).status).toBe(201);
    expect(h.dispatch.mock.calls[0]).toEqual([{ kind: 'admin' }, { env: process.env }]);
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    finish({});

    h.dispatch.mockReset();
    h.waitUntil.mockReset();
    for (const delivery of ['sent', 'failed', 'replaced']) {
      h.result = { kind: 'sent', created: false, document: { ...DOCUMENT, delivery } };
      expect((await post()).status).toBe(201);
    }
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.waitUntil).not.toHaveBeenCalled();
  });

  it('utskicket faller: ingen ohanterad avvisning (cron tar det)', async () => {
    h.result = { kind: 'sent', created: true, document: { ...DOCUMENT, delivery: 'sending' } };
    h.dispatch.mockRejectedValue(new Error('portalen nere'));
    expect((await post()).status).toBe(201);
    await expect(h.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it('domänens utfall; inget utskick', async () => {
    const failed = { ...DOCUMENT, status: 'failed', error: 'Egenkontrollen är 4,1 MB. Butiken kan ta emot högst 3,3 MB.', delivery: null };
    for (const [result, status, code, message] of [
      [{ kind: 'failed', document: failed }, 422, 'portal_document_failed', failed.error],
      [{ kind: 'blocked', reason: 'cancelled', message: 'Jobbet är avbrutet.' }, 409, 'portal_document_blocked', 'Jobbet är avbrutet.'],
      [{ kind: 'not_found' }, 404, 'portal_job_not_found', null],
      [{ kind: 'forbidden' }, 403, 'portal_document_forbidden', null],
      [{ kind: 'no_source' }, 404, 'portal_document_no_source', null],
      [{ kind: 'source_changed' }, 409, 'portal_document_source_changed', null],
      [{ kind: 'wrong_order' }, 422, 'portal_document_wrong_order', null],
      [{ kind: 'conflict' }, 409, 'portal_document_conflict', null],
    ] as const) {
      h.result = result;
      const res = await post();
      expect(res.status, code).toBe(status);
      expect(res.body.errorDetails.code).toBe(code);
      if (message) expect(res.body.error).toBe(message);
    }
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('ett oväntat fel: 500 utan detaljer', async () => {
    h.result = Promise.reject(new Error('hemligt databasfel'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hemligt');
  });
});

describe('GET …/[documentId]: öppna den skickade kopian', () => {
  it('utan inloggning 401, utan crm.workorder.read 403; ingen klient', async () => {
    h.user = null;
    expect((await open()).status).toBe(401);
    h.user = salesUser;
    h.held = new Set(['crm.access']);
    expect((await open()).status).toBe(403);
    expect(h.clients).toBe(0);
    expect(h.opened).toHaveLength(0);
  });

  it('PDF:en med butikens filnamn (svenska tecken i filename*), aldrig cachad', async () => {
    const res = await open();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename="Orderbekr_ftelse 26 _ R_nnv_gen 18, G_vle.pdf"; filename*=UTF-8''${encodeURIComponent('Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf')}`,
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(h.file && (h.file as { bytes: Uint8Array }).bytes);
    expect(h.opened[0]).toEqual([{ kind: 'session' }, { kind: 'admin' }, WO, DOC_ID]);
  });

  it('ogiltiga id:n 400, inget dokument 404; i en flik som en sida', async () => {
    expect((await open('inte-ett-id')).status).toBe(400);
    expect((await open(DOC_ID, 'inte-ett-id')).status).toBe(400);
    expect(h.opened).toHaveLength(0);
    h.file = null;
    const res = await open();
    expect(res.status).toBe(404);
    const page = await open(DOC_ID, WO, { 'sec-fetch-dest': 'document' });
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toContain('text/html');
  });

  it('en citattecken i namnet kan inte bryta headern', async () => {
    h.file = { bytes: new Uint8Array([1]), name: 'a"b.pdf' };
    const res = await open();
    expect(res.headers.get('content-disposition')).toContain('filename="a_b.pdf"');
  });

  it("filename* kodar också ' ( ) * (RFC 5987), som en adress kan ha", async () => {
    h.file = { bytes: new Uint8Array([1]), name: "Orderbekräftelse 26 – O'Brien väg 1 (bakgård)*.pdf" };
    const header = (await open()).headers.get('content-disposition') ?? '';
    const ext = header.split("filename*=UTF-8''")[1];
    expect(ext).toMatch(/^[A-Za-z0-9!#$&+\-.^_`|~%]+$/);
    expect(decodeURIComponent(ext)).toBe("Orderbekräftelse 26 – O'Brien väg 1 (bakgård)*.pdf");
  });

  it('🧨 fetchCache: ingen PDF får komma ur Next 14:s cache (routen har bara GET)', () => {
    const source = readFileSync('app/api/crm/portal/jobs/[workOrderId]/documents/[documentId]/route.ts', 'utf8');
    expect(source).toMatch(/^export const fetchCache = 'force-no-store';$/m);
    expect(source).toMatch(/^export const dynamic = 'force-dynamic';$/m);
  });
});
