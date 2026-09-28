import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PORTAL_DOCUMENT_ABANDONED_MS,
  PORTAL_DOCUMENT_RETRY_WINDOW_MS,
  listPortalJobDocuments,
  openPortalJobDocument,
  sendPortalJobDocument,
  sweepPortalJobDocuments,
  type PortalDocumentSourceResult,
  type PortalDocumentSources,
} from '@/lib/domains/portal/jobDocumentsStore';
import { sha256Hex } from '@/lib/domains/portal/outboundContent';
import { PORTAL_JOB_DOCUMENTS_BUCKET, PORTAL_JOB_DOCUMENT_MAX_BYTES } from '@/lib/domains/portal/jobDocuments';
import { memoryAdmin } from './helpers/memoryAdmin';

// Dokumenten mot databasen (fas 7). Sessionen och service-rollen är samma minnesklient här; vem som får läsa och skicka
// prövas mot en riktig databas i supabase/checks/portal_job_documents.sql. Det som skyddas:
//   - besluten (William 2026-09-28): orderbekräftelsen automatiskt en gång efter den levererade bekräftelsen, sedan med
//     knappen; egenkontrollen med knappen; inga dokument till ett avbrutet jobb, och inget före bekräftelsen;
//   - att butiken bara får sitt eget jobbs fil: egenkontrollen ur just den här orderns kommentarer, med orderns nummer i
//     filnamnet, och den som kortet visade;
//   - att filen fryses en gång (samma id = samma fil), och att kön får en referens med hashen;
//   - storleksgränsen, och att den automatiska försöker igen när Fortnox inte svarar men inte när det aldrig går.

const NOW = new Date('2026-10-12T08:30:00.000Z');
const WO = '11111111-2222-4333-8444-555555555555';
const DOC = '7d0b8f5e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const CONFIRMED_KEY = 'job.confirmed-q-1-2026-10-10T10:00:00.000Z';
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;

const pdf = (size = 64, seed = 1) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  for (let i = 5; i < size; i += 1) bytes[i] = (i * seed * 31) % 256;
  return bytes;
};

const job = (over: Record<string, unknown> = {}) => ({
  quote_id: 'q-1',
  work_order_id: WO,
  work_order_created_at: '2026-10-01T10:00:00.000Z',
  sync_state: { confirmedKey: CONFIRMED_KEY },
  ...over,
});
const workOrder = (over: Record<string, unknown> = {}) => ({
  id: WO,
  status: 'scheduled',
  assigned_to: 'u-seller',
  order_number: 'AO-20261001-DF3269',
  fortnox_order_number: '26',
  project_name: 'Rönnvägen 18, Gävle',
  work_address: { street_address: 'Rönnvägen 18', postal_code: '80250', city: 'Gävle' },
  rot_details: {},
  ...over,
});
const confirmed = (over: Record<string, unknown> = {}) => ({
  id: 'ev-confirmed',
  seq: 1,
  idempotency_key: CONFIRMED_KEY,
  payload: { type: 'job.confirmed', data: { quoteId: 'q-1', ekovillaOrderNumber: '26' } },
  ordering_key: 'job:q-1',
  status: 'sent',
  sent_at: ago(5 * MINUTE),
  ...over,
});
const archiveLink = (file: string) => `https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2F${file}`;
const comment = (file: string, created_at: string) => ({
  work_order_id: WO,
  body: `Egenkontroll gjord 2026-10-11\nLadda ner här: ${archiveLink(file)}`,
  created_at,
});

let ids = 0;
const defaults = (table: string): Record<string, unknown> =>
  table === 'crm_portal_job_documents'
    ? {
        id: `a0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
        status: 'building',
        name: null,
        byte_size: null,
        sha256: null,
        source_ref: null,
        error: null,
        attempts: 0,
        // Databasens now() vid insert: efter att varvet började (varvets klocka är NOW).
        next_attempt_at: new Date(NOW.getTime() + 1000).toISOString(),
        created_by: null,
        created_by_name: null,
        created_at: NOW.toISOString(),
        ready_at: null,
        queued_at: null,
      }
    : table === 'portal_outbound_events'
      ? { next_attempt_at: NOW.toISOString() }
      : {};

let canSend = true;

function db(initial: Record<string, Record<string, unknown>[]> = {}) {
  const made = memoryAdmin(
    {
      crm_portal_jobs: [job()],
      crm_work_orders: [workOrder()],
      portal_outbound_events: [confirmed()],
      crm_work_order_comments: [],
      ...initial,
    },
    { defaults, rpc: (name) => (name === 'crm_portal_job_message_can_reply' ? canSend : null) },
  );
  return made;
}

function sources(over: Partial<Record<keyof PortalDocumentSources, PortalDocumentSourceResult>> = {}, archive = pdf(300, 3)) {
  return {
    renderOrderConfirmation: vi.fn(async () => over.renderOrderConfirmation ?? { ok: true as const, bytes: pdf(500, 2) }),
    readArchive: vi.fn(async () => over.readArchive ?? { ok: true as const, bytes: archive }),
  };
}

const ACTOR = { id: 'u-seller', name: 'Anna Berg' };
const send = (admin: never, src: PortalDocumentSources, over: Partial<Parameters<typeof sendPortalJobDocument>[3]> = {}) =>
  sendPortalJobDocument(admin, admin, src, {
    workOrderId: WO,
    documentId: DOC,
    kind: 'order_confirmation',
    sourcePath: null,
    actor: ACTOR,
    ...over,
  }, () => NOW);

const docEvents = (tables: Record<string, Record<string, unknown>[]>) =>
  tables.portal_outbound_events.filter((e) => String(e.idempotency_key).startsWith('job.document-'));

beforeEach(() => {
  canSend = true;
  ids = 0;
});

describe('sendPortalJobDocument: orderbekräftelsen', () => {
  it('fryser PDF:en, bokför storlek och hash, och köar en referens i jobbets kö', async () => {
    const { admin, tables, files } = db();
    const src = sources();
    const result = await send(admin, src);

    expect(result).toMatchObject({ kind: 'sent', created: true, document: { id: DOC, status: 'ready', delivery: 'sending' } });
    expect(src.renderOrderConfirmation).toHaveBeenCalledWith(WO);
    const bytes = pdf(500, 2);
    expect(files.get(`${PORTAL_JOB_DOCUMENTS_BUCKET}/q-1/${DOC}.pdf`)).toEqual(bytes);
    const row = tables.crm_portal_job_documents[0];
    expect(row).toMatchObject({
      id: DOC,
      quote_id: 'q-1',
      kind: 'order_confirmation',
      status: 'ready',
      name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
      byte_size: 500,
      sha256: sha256Hex(bytes),
      source_ref: '26',
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      ready_at: NOW.toISOString(),
      queued_at: NOW.toISOString(),
    });
    expect(docEvents(tables)).toEqual([
      expect.objectContaining({
        idempotency_key: `job.document-${DOC}`,
        path: '/api/ekovilla/events',
        ordering_key: 'job:q-1',
        supersede_key: null,
        payload: {
          type: 'job.document',
          occurredAt: NOW.toISOString(),
          data: { quoteId: 'q-1', kind: 'order_confirmation', name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf' },
          contentRef: { documentId: DOC, sha256: sha256Hex(bytes), bytes: 500 },
        },
      }),
    ]);
  });

  it('kön ersätter inget när en ny köas: utskicket avgör (det senast beslutade vinner där)', async () => {
    const { admin, tables } = db({
      portal_outbound_events: [
        confirmed(),
        { id: 'ev-old', seq: 2, idempotency_key: 'job.document-old', payload: {}, ordering_key: 'job:q-1', supersede_key: 'job.document:q-1:order_confirmation', status: 'pending' },
      ],
    });
    await send(admin, sources());
    expect(tables.portal_outbound_events.find((e) => e.id === 'ev-old')?.status).toBe('pending');
    expect(docEvents(tables).find((e) => e.idempotency_key === `job.document-${DOC}`)?.supersede_key ?? null).toBeNull();
  });

  it('samma id igen: svarar med det som finns och renderar inget nytt', async () => {
    const { admin, tables } = db();
    const first = sources();
    await send(admin, first);
    const again = sources();
    const result = await send(admin, again);
    expect(result).toMatchObject({ kind: 'sent', created: false, document: { id: DOC, status: 'ready' } });
    expect(again.renderOrderConfirmation).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents).toHaveLength(1);
    expect(docEvents(tables)).toHaveLength(1);
  });

  it('samma id igen efter att jobbet avbrutits: svarar med det som skickades, inte "avbrutet"', async () => {
    const { admin, tables } = db();
    await send(admin, sources());
    tables.crm_work_orders[0].status = 'cancelled';
    expect(await send(admin, sources())).toMatchObject({ kind: 'sent', created: false, document: { id: DOC } });
  });

  it('avsändarens namn ur profilen; utan namn "Ekovilla"', async () => {
    const { admin, tables } = db();
    await send(admin, sources(), { actor: { id: 'u-seller', name: '  ' } });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ created_by: 'u-seller', created_by_name: 'Ekovilla' });
  });

  it('utan arbetsadress: projektnamnet som arbetsplats', async () => {
    const { admin, tables } = db({ crm_work_orders: [workOrder({ work_address: null, project_name: 'Vinden på Ekgatan' })] });
    await send(admin, sources());
    expect(tables.crm_portal_job_documents[0].name).toBe('Orderbekräftelse 26 – Vinden på Ekgatan.pdf');
  });

  it('samma id för en annan sort är en krock', async () => {
    const { admin } = db();
    await send(admin, sources());
    expect(await send(admin, sources(), { kind: 'self_inspection', sourcePath: 'Egenkontroller/x.pdf' })).toEqual({ kind: 'conflict' });
  });

  it('RLS nekar (varken ansvarig eller admin): inget renderas, inget sparas', async () => {
    const { admin, tables, failOn } = db();
    failOn((c) => c.table === 'crm_portal_job_documents' && c.op === 'upsert', { code: '42501', message: 'new row violates row-level security policy' });
    const src = sources();
    expect(await send(admin, src)).toEqual({ kind: 'forbidden' });
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents ?? []).toEqual([]);
  });

  it('ingen portalorder på arbetsordern', async () => {
    const { admin } = db({ crm_portal_jobs: [] });
    expect(await send(admin, sources())).toEqual({ kind: 'not_found' });
  });

  it('🧨 inget före bekräftelsen: en bekräftelse som väntar, eller är uppgiven, stoppar', async () => {
    for (const status of ['pending', 'sending', 'dead']) {
      const { admin, tables } = db({ portal_outbound_events: [confirmed({ status })] });
      const src = sources();
      expect(await send(admin, src), status).toMatchObject({ kind: 'blocked', reason: 'not_confirmed' });
      expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
      expect(tables.crm_portal_job_documents ?? []).toEqual([]);
    }
    const { admin } = db({ crm_portal_jobs: [job({ sync_state: {} })] });
    expect(await send(admin, sources())).toMatchObject({ kind: 'blocked', reason: 'not_confirmed' });
  });

  it('🧨 ett avbrutet eller borttaget jobb får inga dokument (William 2026-09-28)', async () => {
    // (En borttagen arbetsorder har ingen sida att trycka på; den prövas i cron.)
    const cases = [
      db({ crm_portal_jobs: [job({ sync_state: { confirmedKey: CONFIRMED_KEY, cancelled: true } })] }),
      db({ crm_work_orders: [workOrder({ status: 'cancelled' })] }),
    ];
    for (const { admin } of cases) {
      const src = sources();
      expect(await send(admin, src)).toMatchObject({ kind: 'blocked', reason: 'cancelled' });
      expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    }
  });

  it('ingen Fortnox-order (numret togs bort efter bekräftelsen): inget Fortnox-anrop, misslyckat', async () => {
    const { admin } = db({ crm_work_orders: [workOrder({ fortnox_order_number: null })] });
    const src = sources();
    expect(await send(admin, src)).toMatchObject({ kind: 'failed', document: { error: 'Ordern finns inte i Fortnox.' } });
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
  });

  it('ingen bekräftelse köad: kön frågas inte ens', async () => {
    const { admin, calls } = db({ crm_portal_jobs: [job({ sync_state: {} })] });
    expect(await send(admin, sources())).toMatchObject({ kind: 'blocked', reason: 'not_confirmed' });
    expect(calls.filter((c) => c.table === 'portal_outbound_events')).toEqual([]);
  });

  it('🧨 hann sopningen markera beslutet misslyckat medan filen frystes, väcks det inte till liv', async () => {
    const made = db();
    const withRace = memoryAdmin(made.tables, {
      defaults,
      rpc: (name) => (name === 'crm_portal_job_message_can_reply' ? canSend : null),
      beforeExecute: (call, t) => {
        const values = call.values as Record<string, unknown> | undefined;
        if (call.table === 'crm_portal_job_documents' && call.op === 'update' && values?.status === 'ready') {
          Object.assign(t.crm_portal_job_documents[0], { status: 'failed', error: 'Avbröts innan filen hann sparas. Skicka igen.' });
        }
      },
    });
    const result = await send(withRace.admin, sources());
    expect(result).toMatchObject({ kind: 'failed', document: { status: 'failed', error: 'Avbröts innan filen hann sparas. Skicka igen.' } });
    expect(withRace.tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed', sha256: null });
    expect(docEvents(withRace.tables)).toEqual([]);
  });

  it('för stor: inget köas, dokumentet står som misslyckat med storleken', async () => {
    const { admin, tables, files } = db();
    const result = await send(admin, sources({ renderOrderConfirmation: { ok: true, bytes: pdf(PORTAL_JOB_DOCUMENT_MAX_BYTES + 1) } }));
    expect(result).toMatchObject({
      kind: 'failed',
      document: { status: 'failed', error: 'Orderbekräftelsen är 3,4 MB. Butiken kan ta emot högst 3,3 MB.' },
    });
    expect(docEvents(tables)).toEqual([]);
    expect(files.size).toBe(0);
  });

  it('exakt på gränsen går', async () => {
    const { admin } = db();
    expect(await send(admin, sources({ renderOrderConfirmation: { ok: true, bytes: pdf(PORTAL_JOB_DOCUMENT_MAX_BYTES) } }))).toMatchObject({
      kind: 'sent',
    });
  });

  it('något som inte är en PDF skickas aldrig', async () => {
    const { admin, tables } = db();
    const result = await send(admin, sources({ renderOrderConfirmation: { ok: true, bytes: new TextEncoder().encode('<html>fel</html>') } }));
    expect(result).toMatchObject({ kind: 'failed', document: { error: 'Orderbekräftelsen är ingen PDF.' } });
    expect(docEvents(tables)).toEqual([]);
  });

  it('🧨 ROT påslagen: renderingen vägrar (samma läsning som den ritar ur), och inget går till butiken', async () => {
    // Själva provet står i getFortnoxOrderPdf({ refuseRot: true }) (tests/fortnox/orderPdfRefuseRot.test.ts); källan
    // översätter det till ett skäl som aldrig blir rätt av ett nytt försök.
    const { admin, tables } = db();
    const src = sources({
      renderOrderConfirmation: { ok: false, permanent: true, error: 'Ordern har ROT påslagen. Orderbekräftelsen skickas inte till butiken.' },
    });
    expect(await send(admin, src)).toMatchObject({ kind: 'failed', document: { error: expect.stringContaining('ROT') } });
    expect(docEvents(tables)).toEqual([]);
  });

  it('Fortnox svarar inte: misslyckat med Fortnox svar, och knappen går att trycka igen', async () => {
    const { admin } = db();
    const result = await send(admin, sources({ renderOrderConfirmation: { ok: false, permanent: false, error: 'Fortnox svarar inte.' } }));
    expect(result).toMatchObject({ kind: 'failed', document: { status: 'failed', error: 'Fortnox svarar inte.' } });
  });

  it('finns filen redan (processen dog efter uppladdningen) används DEN, och hashen räknas på den', async () => {
    const { admin, tables, files } = db();
    const earlier = pdf(400, 7);
    files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/q-1/${DOC}.pdf`, earlier);
    await send(admin, sources());
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ byte_size: 400, sha256: sha256Hex(earlier) });
    expect(files.get(`${PORTAL_JOB_DOCUMENTS_BUCKET}/q-1/${DOC}.pdf`)).toEqual(earlier);
  });

  it('kön svarar inte: filen står fryst och kortet säger "skickas"; cron köar den sedan', async () => {
    const { admin, tables, failOn } = db();
    failOn((c) => c.table === 'portal_outbound_events' && c.op === 'upsert', { message: 'nere' });
    const result = await send(admin, sources());
    expect(result).toMatchObject({ kind: 'sent', document: { status: 'ready', delivery: 'sending' } });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'ready', queued_at: null });
  });

  it('🧨 avbryts jobbet medan filen fryses köas den inte, och står som misslyckad', async () => {
    const { admin, tables } = db();
    const src = sources();
    src.renderOrderConfirmation.mockImplementation(async () => {
      tables.crm_work_orders[0].status = 'cancelled';
      return { ok: true, bytes: pdf(500, 2) };
    });
    expect(await send(admin, src)).toMatchObject({ kind: 'failed', document: { status: 'failed' } });
    expect(docEvents(tables)).toEqual([]);
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('avbrutet') });
  });
});

describe('sendPortalJobDocument: egenkontrollen', () => {
  const file = 'Egenkontroll_Rönnvägen_26.pdf';
  const encoded = 'Egenkontroll_R%C3%B6nnv%C3%A4gen_26.pdf';
  const path = `Egenkontroller/${file}`;

  it('läser just den här orderns senaste egenkontroll ur arkivet, den som kortet visade', async () => {
    const archive = pdf(300, 3);
    const { admin, tables } = db({
      crm_work_order_comments: [
        comment('Egenkontroll_Rönnvägen_26-1.pdf', ago(3 * 24 * 60 * MINUTE)),
        comment(encoded, ago(60 * MINUTE)),
        { work_order_id: 'annan-order', body: `Ladda ner här: ${archiveLink('Egenkontroll_X_26.pdf')}`, created_at: NOW.toISOString() },
      ],
    });
    const src = sources({}, archive);
    const result = await send(admin, src, { kind: 'self_inspection', sourcePath: path });
    expect(result).toMatchObject({ kind: 'sent', document: { kind: 'self_inspection', name: 'Egenkontroll 26 – Rönnvägen 18, Gävle.pdf' } });
    expect(src.readArchive).toHaveBeenCalledWith(path);
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ source_ref: path, sha256: sha256Hex(archive) });
  });

  it('ingen egenkontroll på ordern', async () => {
    const { admin } = db();
    expect(await send(admin, sources(), { kind: 'self_inspection', sourcePath: path })).toEqual({ kind: 'no_source' });
  });

  it('🧨 en nyare egenkontroll än den kortet visade: skickas inte', async () => {
    const { admin, tables } = db({ crm_work_order_comments: [comment(encoded, ago(MINUTE))] });
    const src = sources();
    expect(await send(admin, src, { kind: 'self_inspection', sourcePath: 'Egenkontroller/Egenkontroll_Rönnvägen_26-1.pdf' })).toEqual({
      kind: 'source_changed',
    });
    expect(src.readArchive).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents ?? []).toEqual([]);
  });

  it('🧨 en länk till en annan orders egenkontroll i kommentarerna skickas aldrig', async () => {
    const other = 'Egenkontroll_Annan_kund_6579.pdf';
    const { admin, tables } = db({ crm_work_order_comments: [comment(other, ago(MINUTE))] });
    const src = sources();
    expect(await send(admin, src, { kind: 'self_inspection', sourcePath: `Egenkontroller/${other}` })).toEqual({ kind: 'wrong_order' });
    expect(src.readArchive).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents ?? []).toEqual([]);
  });

  it('en länk utanför egenkontrollmappen räknas inte som egenkontroll', async () => {
    const { admin } = db({
      crm_work_order_comments: [
        { work_order_id: WO, body: 'Ladda ner här: https://app.ekovilla.se/api/storage/download?path=Kvitton%2FEgenkontroll_X_26.pdf', created_at: NOW.toISOString() },
      ],
    });
    expect(await send(admin, sources(), { kind: 'self_inspection', sourcePath: 'Kvitton/Egenkontroll_X_26.pdf' })).toEqual({ kind: 'no_source' });
  });

  it('arkivet har inte filen: misslyckat, med skälet', async () => {
    const { admin } = db({ crm_work_order_comments: [comment(encoded, ago(MINUTE))] });
    const result = await send(admin, sources({ readArchive: { ok: false, permanent: true, error: 'Egenkontrollen finns inte i arkivet.' } }), {
      kind: 'self_inspection',
      sourcePath: path,
    });
    expect(result).toMatchObject({ kind: 'failed', document: { error: 'Egenkontrollen finns inte i arkivet.' } });
  });

  it('för stor egenkontroll (två foton på 2 MB): säger hur stor den är', async () => {
    const { admin } = db({ crm_work_order_comments: [comment(encoded, ago(MINUTE))] });
    const result = await send(admin, sources({}, pdf(4_100_000)), { kind: 'self_inspection', sourcePath: path });
    expect(result).toMatchObject({ kind: 'failed', document: { error: 'Egenkontrollen är 4,1 MB. Butiken kan ta emot högst 3,3 MB.' } });
  });
});

describe('listPortalJobDocuments', () => {
  it('den senaste per sort, med köns läge, vem som skickade, och egenkontrollen för den som får skicka', async () => {
    const { admin } = db({
      crm_portal_job_documents: [
        { id: 'd-old', quote_id: 'q-1', kind: 'order_confirmation', status: 'ready', name: 'Gammal.pdf', byte_size: 10, error: null, created_by: null, created_by_name: null, created_at: ago(60 * MINUTE), ready_at: ago(60 * MINUTE) },
        { id: 'd-new', quote_id: 'q-1', kind: 'order_confirmation', status: 'ready', name: 'Ny.pdf', byte_size: 20, error: null, created_by: 'u-seller', created_by_name: 'Anna Berg', created_at: ago(MINUTE), ready_at: ago(MINUTE) },
        { id: 'd-other-job', quote_id: 'q-2', kind: 'self_inspection', status: 'ready', name: 'Annan.pdf', byte_size: 20, error: null, created_by: 'u-x', created_by_name: 'X', created_at: NOW.toISOString(), ready_at: NOW.toISOString() },
      ],
      portal_outbound_events: [
        confirmed(),
        { id: 'e1', seq: 2, idempotency_key: 'job.document-d-new', ordering_key: 'job:q-1', status: 'dead', payload: {} },
      ],
      crm_work_order_comments: [comment('Egenkontroll_K_26.pdf', '2026-10-11T15:00:00.000Z')],
    });
    const view = await listPortalJobDocuments(admin, admin, WO);
    expect(view).toEqual({
      canSend: true,
      blocked: null,
      latest: {
        order_confirmation: {
          id: 'd-new',
          kind: 'order_confirmation',
          status: 'ready',
          name: 'Ny.pdf',
          sizeBytes: 20,
          error: null,
          createdByName: 'Anna Berg',
          createdAt: ago(MINUTE),
          delivery: 'failed',
        },
        self_inspection: null,
      },
      selfInspection: {
        path: 'Egenkontroller/Egenkontroll_K_26.pdf',
        fileName: 'Egenkontroll_K_26.pdf',
        commentedAt: '2026-10-11T15:00:00.000Z',
        belongsToOrder: true,
      },
    });
  });

  it('den automatiska visas utan namn; en annan orders egenkontroll märks', async () => {
    const { admin } = db({
      crm_portal_job_documents: [
        { id: 'd-auto', quote_id: 'q-1', kind: 'order_confirmation', status: 'ready', name: 'A.pdf', byte_size: 10, error: null, created_by: null, created_by_name: null, created_at: ago(MINUTE), ready_at: ago(MINUTE) },
      ],
      portal_outbound_events: [confirmed(), { id: 'e1', seq: 2, idempotency_key: 'job.document-d-auto', ordering_key: 'job:q-1', status: 'sent', payload: {} }],
      crm_work_order_comments: [comment('Egenkontroll_K_6579.pdf', NOW.toISOString())],
    });
    const view = await listPortalJobDocuments(admin, admin, WO);
    expect(view?.latest.order_confirmation).toMatchObject({ createdByName: null, delivery: 'sent' });
    expect(view?.selfInspection).toMatchObject({ belongsToOrder: false });
  });

  it('den som inte får skicka ser dokumenten men inte egenkontrollen', async () => {
    canSend = false;
    const { admin } = db({ crm_work_order_comments: [comment('Egenkontroll_K_26.pdf', NOW.toISOString())] });
    expect(await listPortalJobDocuments(admin, admin, WO)).toMatchObject({ canSend: false, selfInspection: null });
  });

  it('avbrutet: ingen egenkontroll att skicka, och det sägs', async () => {
    const { admin } = db({
      crm_work_orders: [workOrder({ status: 'cancelled' })],
      crm_work_order_comments: [comment('Egenkontroll_K_26.pdf', NOW.toISOString())],
    });
    expect(await listPortalJobDocuments(admin, admin, WO)).toMatchObject({ blocked: 'cancelled', selfInspection: null });
  });

  it('ingen portalorder: null', async () => {
    const { admin } = db({ crm_portal_jobs: [] });
    expect(await listPortalJobDocuments(admin, admin, WO)).toBeNull();
  });

  it('kön svarar inte: kortet visas ändå, med "skickas"', async () => {
    const { admin, failOn } = db({
      crm_portal_job_documents: [
        { id: 'd-1', quote_id: 'q-1', kind: 'order_confirmation', status: 'ready', name: 'A.pdf', byte_size: 10, error: null, created_by: null, created_by_name: null, created_at: ago(MINUTE), ready_at: ago(MINUTE) },
      ],
    });
    failOn((c) => c.table === 'portal_outbound_events' && c.filters.some(([k, col]) => k === 'in' && col === 'idempotency_key'), { message: 'nere' });
    const view = await listPortalJobDocuments(admin, admin, WO);
    expect(view?.latest.order_confirmation).toMatchObject({ id: 'd-1', delivery: 'sending' });
  });
});

describe('openPortalJobDocument', () => {
  it('den frysta filen, med namnet butiken fick', async () => {
    const { admin } = db();
    await send(admin, sources());
    expect(await openPortalJobDocument(admin, admin, WO, DOC)).toEqual({ bytes: pdf(500, 2), name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf' });
  });

  it('🧨 aldrig ett annat jobbs dokument genom den här arbetsordern', async () => {
    const { admin, files } = db({
      crm_portal_job_documents: [
        { id: DOC, quote_id: 'q-2', kind: 'order_confirmation', status: 'ready', name: 'Annan.pdf', byte_size: 10, created_at: NOW.toISOString() },
      ],
    });
    files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/q-2/${DOC}.pdf`, pdf());
    expect(await openPortalJobDocument(admin, admin, WO, DOC)).toBeNull();
  });

  it('inget att öppna innan filen är fryst, eller när den aldrig skickades', async () => {
    const { admin, files } = db({
      crm_portal_job_documents: [{ id: DOC, quote_id: 'q-1', kind: 'order_confirmation', status: 'failed', name: null, error: 'x', created_at: NOW.toISOString() }],
    });
    expect(await openPortalJobDocument(admin, admin, WO, DOC)).toBeNull();
    // Fryst men aldrig skickad (jobbet avbröts innan den köades): filen finns, men butiken fick den aldrig.
    const other = db({
      crm_portal_job_documents: [
        { id: DOC, quote_id: 'q-1', kind: 'order_confirmation', status: 'failed', name: 'Orderbekräftelse 26.pdf', error: 'Jobbet är avbrutet.', created_at: NOW.toISOString() },
      ],
    });
    other.files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/q-1/${DOC}.pdf`, pdf());
    expect(await openPortalJobDocument(other.admin, other.admin, WO, DOC)).toBeNull();
    void files;
  });
});

describe('sweepPortalJobDocuments', () => {
  const sweep = (admin: never, src: PortalDocumentSources, at = NOW) => sweepPortalJobDocuments(admin, { now: () => at, sources: src });

  it('orderbekräftelsen automatiskt, en gång, när bekräftelsen är levererad', async () => {
    const { admin, tables } = db();
    const src = sources();
    expect(await sweep(admin, src)).toEqual({ created: 1, queued: 1, failed: 0, retried: 0, errors: 0 });
    expect(tables.crm_portal_job_documents).toEqual([
      expect.objectContaining({ quote_id: 'q-1', kind: 'order_confirmation', status: 'ready', created_by: null, queued_at: NOW.toISOString() }),
    ]);
    expect(docEvents(tables)).toHaveLength(1);

    // Nästa varv gör ingenting nytt, också när en säljare skickat en ny med knappen under tiden.
    expect(await sweep(admin, src)).toEqual({ created: 0, queued: 0, failed: 0, retried: 0, errors: 0 });
    expect(src.renderOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('🧨 en orderbekräftelse som säljaren redan skickat: ingen automatisk till (butiken hade fått två)', async () => {
    const manual = (status: string) => ({
      ...defaults('crm_portal_job_documents'),
      id: 'd-manual',
      quote_id: 'q-1',
      kind: 'order_confirmation',
      status,
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      ...(status === 'failed' ? { error: 'Fortnox svarar inte.' } : {}),
    });
    for (const status of ['building', 'ready']) {
      const { admin, tables } = db({ crm_portal_job_documents: [manual(status)] });
      const src = sources();
      expect(await sweep(admin, src), status).toMatchObject({ created: 0 });
      expect(tables.crm_portal_job_documents.filter((d) => d.created_by === null), status).toEqual([]);
    }
    // En som misslyckades hindrar inte: butiken har ingen.
    const { admin } = db({ crm_portal_job_documents: [manual('failed')] });
    expect(await sweep(admin, sources())).toMatchObject({ created: 1, queued: 1 });
  });

  it('de senaste bekräftelserna först, och avbrutna jobb prövas inte en gång i minuten', async () => {
    const { admin, calls } = db({ crm_portal_jobs: [job({ sync_state: { confirmedKey: CONFIRMED_KEY, cancelled: true } })] });
    expect(await sweep(admin, sources())).toMatchObject({ created: 0, errors: 0 });
    const read = calls.find((c) => c.table === 'portal_outbound_events' && c.filters.some(([k]) => k === 'like'));
    // Senaste först, med en unik sista ordning: .range() får inte hoppa över eller upprepa rader mellan sidorna.
    expect(read?.orders).toEqual([
      { column: 'sent_at', ascending: false },
      { column: 'idempotency_key', ascending: false },
    ]);
    expect(read).toMatchObject({ offset: 0, limit: 500 });
    // Grinden (arbetsordern, bekräftelsens status) lästes aldrig för det avbrutna jobbet.
    expect(calls.filter((c) => c.table === 'crm_work_orders')).toEqual([]);
  });

  it('HELA fönstret läses, i sidor: en bekräftelse långt bak får också sin', async () => {
    // 500 senare bekräftelser (jobb som inte finns här) trycker q-1 till sida två.
    const later = Array.from({ length: 500 }, (_, i) =>
      confirmed({
        id: `ev-${i}`,
        seq: 10 + i,
        idempotency_key: `job.confirmed-q-x${i}-${i}`,
        payload: { type: 'job.confirmed', data: { quoteId: `q-x${i}` } },
        sent_at: ago(MINUTE),
      }),
    );
    const { admin, calls } = db({ portal_outbound_events: [confirmed({ sent_at: ago(60 * MINUTE) }), ...later] });
    expect(await sweep(admin, sources())).toMatchObject({ created: 1, queued: 1 });
    expect(calls.filter((c) => c.table === 'portal_outbound_events' && c.filters.some(([k]) => k === 'like')).map((c) => c.offset)).toEqual([0, 500]);
  });

  it('bygger bara så många som varvet får (knapparna på portalsidan: ett)', async () => {
    const auto = (quote: string) => ({ ...defaults('crm_portal_job_documents'), id: `d-${quote}`, quote_id: quote, kind: 'order_confirmation', next_attempt_at: ago(MINUTE) });
    const { admin } = db({
      crm_portal_jobs: [job(), job({ quote_id: 'q-2', work_order_id: WO })],
      portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })],
      crm_portal_job_documents: [auto('q-1'), auto('q-2')],
    });
    const src = sources();
    await sweepPortalJobDocuments(admin, { now: () => NOW, sources: src, builds: 1 });
    expect(src.renderOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('en säljares egenkontroll hindrar inte den automatiska orderbekräftelsen', async () => {
    const { admin, tables } = db({
      crm_portal_job_documents: [
        // Skickad (inte misslyckad): bara orderbekräftelser räknas, också när en egenkontroll kommit fram.
        { ...defaults('crm_portal_job_documents'), id: 'd-button', quote_id: 'q-1', kind: 'self_inspection', status: 'ready', name: 'E.pdf', byte_size: 64, sha256: 'c'.repeat(64), source_ref: 'Egenkontroller/x.pdf', ready_at: ago(MINUTE), queued_at: ago(MINUTE), created_by: 'u-seller', created_by_name: 'Anna Berg' },
      ],
    });
    expect(await sweep(admin, sources())).toMatchObject({ created: 1, queued: 1 });
    expect(tables.crm_portal_job_documents.filter((d) => d.created_by === null)).toHaveLength(1);
  });

  it('inte före bekräftelsen, inte för en gammal bekräftelse, och inte för ett avbrutet jobb', async () => {
    for (const setup of [
      db({ portal_outbound_events: [confirmed({ status: 'pending' })] }),
      db({ portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })] }),
      db({ crm_work_orders: [workOrder({ status: 'cancelled' })] }),
      db({ crm_portal_jobs: [job({ work_order_id: null })], crm_work_orders: [] }),
    ]) {
      const src = sources();
      expect(await sweep(setup.admin as never, src)).toMatchObject({ created: 0, queued: 0 });
      expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    }
  });

  it('🧨 två varv i samma stund skapar inte två (det unika indexet)', async () => {
    const { admin, tables, failOn } = db();
    failOn((c) => c.table === 'crm_portal_job_documents' && c.op === 'insert', { code: '23505', message: 'duplicate key value violates unique constraint "crm_portal_job_documents_one_automatic_idx"' });
    expect(await sweep(admin, sources())).toMatchObject({ created: 0, errors: 0 });
    expect(tables.crm_portal_job_documents ?? []).toEqual([]);
  });

  it('Fortnox svarar inte: försöker igen om 5 min, sedan 15; efter ett dygn misslyckat', async () => {
    const { admin, tables } = db();
    const down = sources({ renderOrderConfirmation: { ok: false, permanent: false, error: 'Fortnox svarar inte.' } });
    expect(await sweep(admin, down)).toMatchObject({ created: 1, retried: 1 });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({
      status: 'building',
      attempts: 1,
      next_attempt_at: new Date(NOW.getTime() + 5 * MINUTE).toISOString(),
    });

    // För tidigt: inget försök.
    expect(await sweep(admin, down, new Date(NOW.getTime() + 4 * MINUTE))).toMatchObject({ retried: 0 });
    expect(down.renderOrderConfirmation).toHaveBeenCalledTimes(1);

    const later = new Date(NOW.getTime() + 5 * MINUTE);
    expect(await sweep(admin, down, later)).toMatchObject({ retried: 1 });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({
      attempts: 2,
      next_attempt_at: new Date(later.getTime() + 15 * MINUTE).toISOString(),
    });

    tables.crm_portal_job_documents[0].next_attempt_at = ago(-PORTAL_DOCUMENT_RETRY_WINDOW_MS);
    const dayLater = new Date(NOW.getTime() + PORTAL_DOCUMENT_RETRY_WINDOW_MS);
    expect(await sweep(admin, down, dayLater)).toMatchObject({ failed: 1 });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed', error: 'Fortnox svarar inte.' });
  });

  it('det som aldrig går (ordern finns inte i Fortnox, ROT) försöker den inte igen', async () => {
    const { admin, tables } = db();
    const src = sources({ renderOrderConfirmation: { ok: false, permanent: true, error: 'Ordern finns inte i Fortnox.' } });
    expect(await sweep(admin, src)).toMatchObject({ created: 1, failed: 1, retried: 0 });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed' });
  });

  it('🧨 lånet: ett beslut som ett annat varv redan tagit byggs inte en gång till', async () => {
    const { admin, tables } = db({
      crm_portal_job_documents: [
        { ...defaults('crm_portal_job_documents'), id: 'd-auto', quote_id: 'q-1', kind: 'order_confirmation', next_attempt_at: ago(MINUTE) },
      ],
    });
    // Ett annat varv flyttar tiden precis innan vårt lån.
    const made = memoryAdmin(tables, {
      defaults,
      rpc: () => canSend,
      beforeExecute: (call, t) => {
        if (call.table === 'crm_portal_job_documents' && call.op === 'update' && (call.values as Record<string, unknown>).attempts === 1) {
          t.crm_portal_job_documents[0].next_attempt_at = NOW.toISOString();
        }
      },
    });
    const src = sources();
    await sweep(made.admin, src);
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    void admin;
  });

  it('en knapptryckning som dog med processen blir misslyckad efter tio minuter; en färsk lämnas', async () => {
    const base = defaults('crm_portal_job_documents');
    const { admin, tables } = db({
      portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })],
      crm_portal_job_documents: [
        // En gammal automatisk som väntar på nästa försök: den är cronens egen och räknas aldrig som en död knapptryckning.
        { ...base, id: 'd-auto', quote_id: 'q-1', kind: 'order_confirmation', created_at: ago(60 * MINUTE), next_attempt_at: ago(-30 * MINUTE) },
        // Ett tryck får databasens tid i båda (next_attempt_at = created_at): det är "dags" direkt, men byggs aldrig av cron.
        { ...base, id: 'd-dead', quote_id: 'q-1', kind: 'self_inspection', created_by: 'u-seller', created_by_name: 'Anna Berg', created_at: ago(PORTAL_DOCUMENT_ABANDONED_MS + 1), next_attempt_at: ago(PORTAL_DOCUMENT_ABANDONED_MS + 1) },
        { ...base, id: 'd-fresh', quote_id: 'q-1', kind: 'order_confirmation', created_by: 'u-seller', created_by_name: 'Anna Berg', created_at: ago(MINUTE), next_attempt_at: ago(MINUTE) },
      ],
    });
    const src = sources();
    expect(await sweep(admin, src)).toMatchObject({ failed: 1 });
    expect(tables.crm_portal_job_documents.find((d) => d.id === 'd-dead')).toMatchObject({ status: 'failed', error: expect.stringContaining('Skicka igen') });
    expect(tables.crm_portal_job_documents.find((d) => d.id === 'd-fresh')).toMatchObject({ status: 'building' });
    expect(tables.crm_portal_job_documents.find((d) => d.id === 'd-auto')).toMatchObject({ status: 'building' });
    // En knapptryckning byggs aldrig av cron: källan (vilken egenkontroll) visste bara den som tryckte, och en pågående
    // orderbekräftelse byggs redan av routen.
    expect(src.readArchive).not.toHaveBeenCalled();
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
  });

  it('en fryst fil som inte hann köas köas; en till ett avbrutet jobb blir misslyckad', async () => {
    const readyRow = (id: string, quote: string) => ({
      ...defaults('crm_portal_job_documents'),
      id,
      quote_id: quote,
      kind: 'order_confirmation',
      status: 'ready',
      name: 'Orderbekräftelse 26.pdf',
      byte_size: 64,
      sha256: 'a'.repeat(64),
      source_ref: '26',
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      ready_at: ago(2 * MINUTE),
    });
    const { admin, tables } = db({
      crm_portal_jobs: [job(), job({ quote_id: 'q-2', sync_state: { confirmedKey: 'k2', cancelled: true } })],
      crm_portal_job_documents: [
        readyRow('00000000-0000-4000-8000-000000000001', 'q-1'),
        readyRow('00000000-0000-4000-8000-000000000002', 'q-2'),
        // Redan köad: rörs inte.
        { ...readyRow('00000000-0000-4000-8000-000000000003', 'q-1'), queued_at: ago(MINUTE) },
      ],
      // Bekräftelsen utanför fönstret: ingen automatisk orderbekräftelse i det här varvet.
      portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })],
    });
    expect(await sweep(admin, sources())).toMatchObject({ queued: 1, failed: 1 });
    expect(docEvents(tables).map((e) => e.idempotency_key)).toEqual(['job.document-00000000-0000-4000-8000-000000000001']);
    expect(tables.crm_portal_job_documents.find((d) => d.quote_id === 'q-2')).toMatchObject({ status: 'failed', queued_at: null });
  });

  it('🧨 en fryst fil till en borttagen arbetsorder köas aldrig', async () => {
    const { admin, tables } = db({
      crm_portal_jobs: [job({ work_order_id: null })],
      crm_work_orders: [],
      portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })],
      crm_portal_job_documents: [
        {
          ...defaults('crm_portal_job_documents'),
          id: '00000000-0000-4000-8000-000000000004',
          quote_id: 'q-1',
          kind: 'order_confirmation',
          status: 'ready',
          name: 'Orderbekräftelse 26.pdf',
          byte_size: 64,
          sha256: 'a'.repeat(64),
          source_ref: '26',
          created_by: 'u-seller',
          created_by_name: 'Anna Berg',
          ready_at: ago(2 * MINUTE),
        },
      ],
    });
    expect(await sweep(admin, sources())).toMatchObject({ queued: 0, failed: 1 });
    expect(docEvents(tables)).toEqual([]);
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('avbrutet') });
  });

  it('🧨 den senast beslutade vinner: en äldre fryst som inte hann köas köas aldrig efter en nyare', async () => {
    const frozen = (id: string, created: string, over: Record<string, unknown> = {}) => ({
      ...defaults('crm_portal_job_documents'),
      id,
      quote_id: 'q-1',
      kind: 'order_confirmation',
      status: 'ready',
      name: 'Orderbekräftelse 26.pdf',
      byte_size: 64,
      sha256: 'a'.repeat(64),
      source_ref: '26',
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      created_at: created,
      ready_at: ago(2 * MINUTE),
      ...over,
    });
    const older = '00000000-0000-4000-8000-00000000000a';
    const newer = '00000000-0000-4000-8000-00000000000b';
    const { admin, tables } = db({
      portal_outbound_events: [
        confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) }),
        { id: 'ev-b', seq: 5, idempotency_key: `job.document-${newer}`, payload: {}, ordering_key: 'job:q-1', supersede_key: 'job.document:q-1:order_confirmation', status: 'pending' },
      ],
      crm_portal_job_documents: [frozen(older, ago(30 * MINUTE)), frozen(newer, ago(10 * MINUTE), { queued_at: ago(9 * MINUTE) })],
    });
    expect(await sweep(admin, sources())).toMatchObject({ queued: 0, failed: 1 });
    expect(tables.crm_portal_job_documents.find((d) => d.id === older)).toMatchObject({ status: 'failed', error: 'Ersattes av en nyare innan den hann skickas.' });
    // Den nyare står kvar i kön, inte ersatt av den äldre.
    expect(tables.portal_outbound_events.find((e) => e.id === 'ev-b')?.status).toBe('pending');
    expect(docEvents(tables).map((e) => e.idempotency_key)).toEqual([`job.document-${newer}`]);
  });

  it('en nyare egenkontroll ersätter inte en orderbekräftelse: bara samma sort räknas', async () => {
    const frozen = (id: string, kind: string, created: string) => ({
      ...defaults('crm_portal_job_documents'),
      id,
      quote_id: 'q-1',
      kind,
      status: 'ready',
      name: 'Dokument.pdf',
      byte_size: 64,
      sha256: 'a'.repeat(64),
      source_ref: '26',
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      created_at: created,
      ready_at: ago(2 * MINUTE),
      queued_at: kind === 'self_inspection' ? ago(MINUTE) : null,
    });
    const confirmation = '00000000-0000-4000-8000-00000000000c';
    const { admin, tables } = db({
      portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })],
      crm_portal_job_documents: [
        frozen(confirmation, 'order_confirmation', ago(30 * MINUTE)),
        frozen('00000000-0000-4000-8000-00000000000d', 'self_inspection', ago(10 * MINUTE)),
      ],
    });
    expect(await sweep(admin, sources())).toMatchObject({ queued: 1, failed: 0 });
    expect(docEvents(tables).map((e) => e.idempotency_key)).toEqual([`job.document-${confirmation}`]);
  });

  it('🧨 den automatiska som blir klar efter en manuell (Fortnox var nere) skickas inte', async () => {
    const { admin, tables } = db({
      crm_portal_job_documents: [
        { ...defaults('crm_portal_job_documents'), id: 'd-auto', quote_id: 'q-1', kind: 'order_confirmation', created_at: ago(120 * MINUTE), next_attempt_at: ago(MINUTE), attempts: 3 },
        {
          ...defaults('crm_portal_job_documents'),
          id: 'd-manual',
          quote_id: 'q-1',
          kind: 'order_confirmation',
          status: 'ready',
          name: 'Orderbekräftelse 26.pdf',
          byte_size: 64,
          sha256: 'b'.repeat(64),
          source_ref: '26',
          created_by: 'u-seller',
          created_by_name: 'Anna Berg',
          created_at: ago(30 * MINUTE),
          ready_at: ago(30 * MINUTE),
          queued_at: ago(30 * MINUTE),
        },
      ],
    });
    const src = sources();
    expect(await sweep(admin, src)).toMatchObject({ queued: 0, failed: 1 });
    expect(tables.crm_portal_job_documents.find((d) => d.id === 'd-auto')).toMatchObject({ status: 'failed', error: 'Ersattes av en nyare innan den hann skickas.' });
    expect(docEvents(tables)).toEqual([]);
    // Upptäckt FÖRE Fortnox: ingen rendering, ingen fil för något som ändå aldrig skickas.
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
  });

  it('en manuell som ännu byggs räcker också för att den automatiska inte renderas', async () => {
    const { admin, tables } = db({
      crm_portal_job_documents: [
        { ...defaults('crm_portal_job_documents'), id: 'd-auto', quote_id: 'q-1', kind: 'order_confirmation', created_at: ago(120 * MINUTE), next_attempt_at: ago(MINUTE), attempts: 3 },
        { ...defaults('crm_portal_job_documents'), id: 'd-manual', quote_id: 'q-1', kind: 'order_confirmation', created_by: 'u-seller', created_by_name: 'Anna Berg', created_at: ago(MINUTE), next_attempt_at: ago(MINUTE) },
      ],
    });
    const src = sources();
    await sweep(admin, src);
    expect(src.renderOrderConfirmation).not.toHaveBeenCalled();
    expect(tables.crm_portal_job_documents.find((d) => d.id === 'd-auto')).toMatchObject({ status: 'failed' });
  });

  it('någon annan hann köa den under tiden: räknas varken som köad eller misslyckad här', async () => {
    const readyRow = {
      ...defaults('crm_portal_job_documents'),
      id: '00000000-0000-4000-8000-00000000000e',
      quote_id: 'q-1',
      kind: 'order_confirmation',
      status: 'ready',
      name: 'Orderbekräftelse 26.pdf',
      byte_size: 64,
      sha256: 'a'.repeat(64),
      source_ref: '26',
      created_by: 'u-seller',
      created_by_name: 'Anna Berg',
      created_at: ago(30 * MINUTE),
      ready_at: ago(2 * MINUTE),
    };
    const newer = { ...readyRow, id: '00000000-0000-4000-8000-00000000000f', created_at: ago(10 * MINUTE), queued_at: ago(MINUTE) };
    const base = db({ portal_outbound_events: [confirmed({ sent_at: ago(8 * 24 * 60 * MINUTE) })], crm_portal_job_documents: [readyRow, newer] });
    const raced = memoryAdmin(base.tables, {
      defaults,
      rpc: () => canSend,
      beforeExecute: (call, t) => {
        const values = call.values as Record<string, unknown> | undefined;
        if (call.table === 'crm_portal_job_documents' && call.op === 'update' && values?.status === 'failed') {
          t.crm_portal_job_documents[0].queued_at = ago(0);
        }
      },
    });
    expect(await sweep(raced.admin, sources())).toMatchObject({ queued: 0, failed: 0, errors: 0 });
  });

  it('ett fel i en del stoppar inte de andra', async () => {
    const base = defaults('crm_portal_job_documents');
    const { admin, tables, failOn } = db({
      crm_portal_job_documents: [
        { ...base, id: 'd-dead', quote_id: 'q-1', kind: 'self_inspection', created_by: 'u', created_by_name: 'U', created_at: ago(PORTAL_DOCUMENT_ABANDONED_MS + 1) },
      ],
    });
    failOn((c) => c.table === 'portal_outbound_events' && c.op === 'select' && c.filters.some(([k]) => k === 'like'), { message: 'nere' });
    const summary = await sweep(admin, sources());
    expect(summary).toMatchObject({ errors: 1, failed: 1 });
    expect(tables.crm_portal_job_documents[0]).toMatchObject({ status: 'failed' });
  });
});
