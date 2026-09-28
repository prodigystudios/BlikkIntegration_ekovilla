import { describe, it, expect, vi } from 'vitest';
import { PORTAL_OUTBOX_MAX_ATTEMPTS, dispatchPortalOutbox, preparationFailureUpdate } from '@/lib/domains/portal/outbox';
import { PORTAL_DOCUMENT_REQUEST_TIMEOUT_MS, preparePortalPayload, sha256Hex } from '@/lib/domains/portal/outboundContent';
import {
  PORTAL_JOB_DOCUMENTS_BUCKET,
  PORTAL_JOB_DOCUMENT_MAX_BYTES,
  buildPortalJobDocumentEvent,
  portalJobDocumentPath,
} from '@/lib/domains/portal/jobDocuments';
import { verifyPortalSignature } from '@/lib/domains/portal/signature';
import { memoryAdmin } from './helpers/memoryAdmin';

// Köns kropp för ett dokument (fas 7): kön bär en referens, och utskicket bygger base64-kroppen ur den frysta filen vid
// varje försök. Det som skyddas:
//   - samma Idempotency-Key ger ALLTID samma byte (portalen svarar 422 på annat), också efter ett omförsök;
//   - en fil som inte stämmer med kön skickas aldrig, och en som saknas ges upp i stället för att blockera jobbet;
//   - kroppen följer kontraktet (strikt base64, %PDF-) och ryms under Vercels 4,5 MB.

const NOW = new Date('2026-10-12T08:30:00.000Z');
const SECRET = 'a'.repeat(64);
const LOCAL_ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:55321',
  PORTAL_CRM_SHARED_SECRET: SECRET,
  RESELLER_PORTAL_URL: 'http://localhost:3001',
};
const DOC_ID = '7d0b8f5e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
// Portalens eget prov (lib/crm/events.ts): bara alfabetet, rätt längd och utfyllnad.
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const pdf = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  for (let i = 5; i < size; i += 1) bytes[i] = (i * 31) % 256;
  return bytes;
};

function stored(bytes: Uint8Array, over: Partial<Parameters<typeof buildPortalJobDocumentEvent>[0]> = {}) {
  const row = {
    id: DOC_ID,
    quoteId: 'q-1',
    kind: 'order_confirmation' as const,
    name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
    sha256: sha256Hex(bytes),
    byteSize: bytes.length,
    readyAt: '2026-10-12T08:29:00.000Z',
    ...over,
  };
  return buildPortalJobDocumentEvent(row);
}

/** Dokumentets rad, som utskicket läser för att se att det är det senast beslutade av sin sort. */
const docRow = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  quote_id: 'q-1',
  kind: 'order_confirmation',
  status: 'ready',
  created_at: '2026-10-12T08:28:00.000Z',
  ...over,
});

function withFile(bytes: Uint8Array | null, rows: Record<string, unknown>[] = [docRow()]) {
  const db = memoryAdmin({ crm_portal_job_documents: rows });
  if (bytes) db.files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/${portalJobDocumentPath('q-1', DOC_ID)}`, bytes);
  return db;
}

describe('preparePortalPayload', () => {
  it('en händelse utan referens skickas som den köades', async () => {
    const { admin, calls } = withFile(null);
    const payload = { type: 'job.scheduled', data: { quoteId: 'q-1' } };
    expect(await preparePortalPayload(admin, payload)).toEqual({ kind: 'ready', payload });
    expect(calls).toEqual([]);
  });

  it('ett dokument: kontraktets kropp i fast ordning, med filens byte i strikt base64', async () => {
    const bytes = pdf(1000);
    const { admin } = withFile(bytes);
    const prepared = await preparePortalPayload(admin, stored(bytes).payload);
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') return;
    expect(prepared.timeoutMs).toBe(PORTAL_DOCUMENT_REQUEST_TIMEOUT_MS);
    const body = prepared.payload as { type: string; occurredAt: string; data: Record<string, string> };
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        type: 'job.document',
        occurredAt: '2026-10-12T08:29:00.000Z',
        data: {
          quoteId: 'q-1',
          kind: 'order_confirmation',
          name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
          contentBase64: Buffer.from(bytes).toString('base64'),
        },
      }),
    );
    expect(body.data.contentBase64).toMatch(STRICT_BASE64);
    expect(new Uint8Array(Buffer.from(body.data.contentBase64, 'base64'))).toEqual(bytes);
    expect(body).not.toHaveProperty('contentRef');
  });

  it('🧨 aldrig andra byte under samma nyckel: en fil som inte stämmer med hashen skickas inte', async () => {
    const bytes = pdf(1000);
    const other = pdf(1000);
    other[500] ^= 0xff;
    const { admin } = withFile(other);
    expect(await preparePortalPayload(admin, stored(bytes).payload)).toEqual({
      kind: 'dead',
      error: 'dokumentet: filen stämmer inte med kön (storlek, PDF eller hash)',
    });
  });

  it('en fil med annan storlek (hashen täcker den), eller som inte är en PDF, skickas inte', async () => {
    const bytes = pdf(1000);
    const { admin, files } = withFile(pdf(999));
    expect((await preparePortalPayload(admin, stored(bytes).payload)).kind).toBe('dead');
    const html = new TextEncoder().encode('<html>inte en pdf</html>');
    files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/${portalJobDocumentPath('q-1', DOC_ID)}`, html);
    expect((await preparePortalPayload(admin, stored(html).payload)).kind).toBe('dead');
  });

  it('en fil som saknas ges upp: den kommer inte tillbaka, och jobbets kö ska inte stå still i två dygn', async () => {
    const { admin } = withFile(null);
    expect(await preparePortalPayload(admin, stored(pdf()).payload)).toEqual({ kind: 'dead', error: 'dokumentet: den frysta filen finns inte' });
  });

  it('lagringen som inte svarar görs om', async () => {
    const bytes = pdf();
    const { admin, failOn } = withFile(bytes);
    failOn((c) => c.table === `storage:${PORTAL_JOB_DOCUMENTS_BUCKET}`, { message: 'upstream timeout' });
    expect(await preparePortalPayload(admin, stored(bytes).payload)).toEqual({
      kind: 'retry',
      error: 'dokumentet: filen kunde inte hämtas: upstream timeout',
    });
  });

  it('filen läses bara ur sin egen bucket, på sökvägen som härleds ur jobbet och id:t', async () => {
    const bytes = pdf();
    const { admin, calls } = withFile(bytes);
    await preparePortalPayload(admin, stored(bytes).payload);
    expect(calls.filter((c) => c.table.startsWith('storage:'))).toEqual([
      { table: `storage:${PORTAL_JOB_DOCUMENTS_BUCKET}`, op: 'select', values: `q-1/${DOC_ID}.pdf`, filters: [] },
    ]);
  });

  it('🧨 ett senare beslut av samma sort finns: skickas aldrig, och filen läses inte', async () => {
    const bytes = pdf();
    const { admin, calls } = withFile(bytes, [
      docRow(),
      docRow({ id: 'd-senare', created_at: '2026-10-12T08:29:00.000Z' }),
    ]);
    expect(await preparePortalPayload(admin, stored(bytes).payload)).toEqual({ kind: 'skip', error: 'dokumentet: ersatt av ett senare' });
    expect(calls.filter((c) => c.table.startsWith('storage:'))).toEqual([]);
  });

  it('ett senare som gavs upp i kön ersätter ändå: det senast beslutade gäller, aldrig en tyst äldre version', async () => {
    // Det senare syns som "Kom inte fram" och skickas om; det äldre kunde ha inaktuellt innehåll (jobDocumentsDecision.ts).
    const bytes = pdf();
    const later = docRow({ id: 'd-senare', created_at: '2026-10-12T08:29:00.000Z' });
    const { admin, tables } = withFile(bytes, [docRow(), later]);
    for (const status of ['dead', 'pending', 'sending', 'sent', 'superseded']) {
      tables.portal_outbound_events = [{ id: 'e', seq: 1, idempotency_key: 'job.document-d-senare', status }];
      expect((await preparePortalPayload(admin, stored(bytes).payload)).kind, status).toBe('skip');
    }
  });

  it('ett senare som inte är fryst, eller av en annan sort, eller på ett annat jobb, ersätter inte', async () => {
    const bytes = pdf();
    for (const later of [
      docRow({ id: 'd-2', created_at: '2026-10-12T08:29:00.000Z', status: 'building' }),
      docRow({ id: 'd-3', created_at: '2026-10-12T08:29:00.000Z', status: 'failed' }),
      docRow({ id: 'd-4', created_at: '2026-10-12T08:29:00.000Z', kind: 'self_inspection' }),
      docRow({ id: 'd-5', created_at: '2026-10-12T08:29:00.000Z', quote_id: 'q-2' }),
    ]) {
      const { admin } = withFile(bytes, [docRow(), later]);
      expect((await preparePortalPayload(admin, stored(bytes).payload)).kind, String(later.id)).toBe('ready');
    }
  });

  it('markerad misslyckad på arbetsordern (ersatt, avbrutet) före sändningen: skickas inte, och ges inte upp', async () => {
    const bytes = pdf();
    const { admin } = withFile(bytes, [docRow({ status: 'failed' })]);
    expect(await preparePortalPayload(admin, stored(bytes).payload)).toEqual({
      kind: 'skip',
      error: 'dokumentet: skickas inte (markerat på arbetsordern)',
    });
  });

  it('en rad som inte stämmer med kön (saknas, annat jobb, annan sort) ges upp', async () => {
    const bytes = pdf();
    for (const rows of [[], [docRow({ quote_id: 'q-2' })], [docRow({ kind: 'self_inspection' })]]) {
      const { admin } = withFile(bytes, rows);
      expect(await preparePortalPayload(admin, stored(bytes).payload), JSON.stringify(rows)).toEqual({
        kind: 'dead',
        error: 'dokumentet: raden stämmer inte med kön',
      });
    }
  });

  it('regeln går inte att fråga: kastar, och utskicket gör om (inte uppgiven)', async () => {
    const bytes = pdf();
    const { admin, failOn } = withFile(bytes);
    // Andra frågan mot tabellen är regeln (den första läser dokumentets egen rad).
    let reads = 0;
    failOn((c) => c.table === 'crm_portal_job_documents' && ++reads === 2, { message: 'nere' });
    await expect(preparePortalPayload(admin, stored(bytes).payload)).rejects.toThrow('nere');
  });

  it('en köad rad i ett läge som inte kan finnas (byggs) ges upp och syns på portalsidan', async () => {
    const bytes = pdf();
    const { admin } = withFile(bytes, [docRow({ status: 'building' })]);
    expect(await preparePortalPayload(admin, stored(bytes).payload)).toEqual({ kind: 'dead', error: 'dokumentet: raden har läget building' });
  });

  it('raden går inte att läsa: görs om', async () => {
    const bytes = pdf();
    const { admin, failOn } = withFile(bytes);
    failOn((c) => c.table === 'crm_portal_job_documents', { message: 'nere' });
    expect((await preparePortalPayload(admin, stored(bytes).payload)).kind).toBe('retry');
  });

  it('en trasig referens ges upp utan att något läses', async () => {
    const bytes = pdf();
    const { admin, calls } = withFile(bytes);
    const payload = stored(bytes).payload;
    for (const broken of [
      { ...payload, data: { ...payload.data, kind: 'invoice' } },
      { ...payload, contentRef: { ...payload.contentRef, documentId: '../../pdfs/Egenkontroller/x' } },
      { ...payload, contentRef: { ...payload.contentRef, sha256: 'abc' } },
      { ...payload, type: 'job.message' },
      { ...payload, contentRef: null },
    ]) {
      expect((await preparePortalPayload(admin, broken)).kind, JSON.stringify(broken)).toBe('dead');
    }
    expect(calls).toEqual([]);
  });

  it('en referens över portalens gräns ges upp utan att filen läses', async () => {
    const { admin, calls } = withFile(null);
    const payload = stored(pdf(), { byteSize: PORTAL_JOB_DOCUMENT_MAX_BYTES + 1 }).payload;
    expect((await preparePortalPayload(admin, payload)).kind).toBe('dead');
    expect(calls).toEqual([]);
  });

  it('den största PDF:en ryms: högst 4 400 000 tecken base64, och hela kroppen under Vercels 4,5 MB', async () => {
    const bytes = pdf(PORTAL_JOB_DOCUMENT_MAX_BYTES);
    const { admin } = withFile(bytes);
    const prepared = await preparePortalPayload(admin, stored(bytes, { name: 'N'.repeat(200) }).payload);
    if (prepared.kind !== 'ready') throw new Error(prepared.kind);
    const body = prepared.payload as { data: { contentBase64: string } };
    expect(body.data.contentBase64.length).toBeLessThanOrEqual(4_400_000);
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThan(4_500_000);
  });
});

describe('preparationFailureUpdate', () => {
  it('ersatt: aldrig skickad, och räknas inte som ett misslyckande', () => {
    expect(preparationFailureUpdate({ attempts: 1 }, { kind: 'skip', error: 'x' }, NOW)).toEqual({
      status: 'superseded',
      last_http_status: null,
      last_error: 'x',
    });
  });

  it('uppgiven med felet, utan HTTP-status', () => {
    expect(preparationFailureUpdate({ attempts: 1 }, { kind: 'dead', error: 'x' }, NOW)).toEqual({
      status: 'dead',
      last_http_status: null,
      last_error: 'x',
    });
  });

  it('görs om efter köns väntan, och ges upp efter sista försöket', () => {
    expect(preparationFailureUpdate({ attempts: 2 }, { kind: 'retry', error: 'x' }, NOW)).toEqual({
      status: 'pending',
      next_attempt_at: new Date(NOW.getTime() + 60_000).toISOString(),
      last_http_status: null,
      last_error: 'x',
    });
    expect(preparationFailureUpdate({ attempts: PORTAL_OUTBOX_MAX_ATTEMPTS }, { kind: 'retry', error: 'x' }, NOW)).toMatchObject({
      status: 'dead',
    });
  });

  it('felet går att spara i Postgres (inget nolltecken, inget ensamt surrogat)', () => {
    const update = preparationFailureUpdate({ attempts: 1 }, { kind: 'dead', error: 'a\u0000b\uD800' }, NOW);
    expect(update.last_error).toBe('ab\uFFFD');
  });
});

describe('dispatchPortalOutbox med ett dokument', () => {
  // Kön i minnet, med claim-funktionens beteende: väntande som är dags blir "sending", med ett försök till.
  function queue(bytes: Uint8Array | null, over: Record<string, unknown> = {}) {
    const event = stored(pdf(2000));
    const db = memoryAdmin(
      {
        crm_portal_job_documents: [docRow()],
        portal_outbound_events: [
          {
            id: 'ev-doc',
            seq: 1,
            idempotency_key: event.idempotencyKey,
            path: event.path,
            payload: event.payload,
            ordering_key: event.orderingKey,
            status: 'pending',
            attempts: 0,
            next_attempt_at: NOW.toISOString(),
            ...over,
          },
        ],
      },
      {
        rpc: (name, _args, tables) => {
          if (name !== 'claim_portal_outbound_events') return null;
          const due = tables.portal_outbound_events.filter((r) => r.status === 'pending');
          for (const r of due) Object.assign(r, { status: 'sending', claimed_at: NOW.toISOString(), attempts: Number(r.attempts) + 1 });
          return structuredClone(due);
        },
      },
    );
    if (bytes) db.files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/${portalJobDocumentPath('q-1', DOC_ID)}`, bytes);
    return { ...db, event };
  }

  it('🧨 samma byte och samma nyckel vid varje försök, och signaturen gäller just de byten', async () => {
    const bytes = pdf(2000);
    const { admin, tables, event } = queue(bytes);
    const sent: { body: string; headers: Record<string, string> }[] = [];
    const statuses = [503, 200];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push({ body: String(init.body), headers: init.headers as Record<string, string> });
      return new Response('', { status: statuses.shift() });
    }) as unknown as typeof fetch;

    expect(await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ retried: 1 });
    tables.portal_outbound_events[0].next_attempt_at = NOW.toISOString();
    expect(await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ sent: 1 });

    expect(sent).toHaveLength(2);
    expect(sent[1].body).toBe(sent[0].body);
    expect(sent.map((s) => s.headers['Idempotency-Key'])).toEqual([event.idempotencyKey, event.idempotencyKey]);
    for (const s of sent) {
      const verdict = verifyPortalSignature({
        secret: SECRET,
        method: 'POST',
        path: '/api/ekovilla/events',
        rawBody: s.body,
        timestampHeader: s.headers['X-Ekovilla-Timestamp'],
        signatureHeader: s.headers['X-Ekovilla-Signature'],
        nowSeconds: NOW.getTime() / 1000,
      });
      expect(verdict).toMatchObject({ ok: true });
    }
    const body = JSON.parse(sent[0].body);
    expect(new Uint8Array(Buffer.from(body.data.contentBase64, 'base64'))).toEqual(bytes);
    // Kön behåller referensen: kroppen i databasen växer aldrig med filen.
    expect(tables.portal_outbound_events[0].payload).toEqual(event.payload);
  });

  it('en fil som inte stämmer: inget anrop, uppgiven med felet', async () => {
    const { admin, tables } = queue(pdf(1999));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ dead: 1, sent: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.portal_outbound_events[0]).toMatchObject({
      status: 'dead',
      last_http_status: null,
      last_error: 'dokumentet: filen stämmer inte med kön (storlek, PDF eller hash)',
    });
  });

  it('regeln kastar under utskicket: inget anrop, tillbaka i kön', async () => {
    const bytes = pdf(2000);
    const { admin, tables, failOn } = queue(bytes);
    let reads = 0;
    failOn((c) => c.table === 'crm_portal_job_documents' && ++reads === 2, { message: 'nere' });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ retried: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.portal_outbound_events[0]).toMatchObject({ status: 'pending', last_error: 'kroppen kunde inte byggas: Senare dokument gick inte att läsa: nere' });
  });

  it('lagringen som inte svarar: inget anrop, tillbaka i kön med nästa försök', async () => {
    const bytes = pdf(2000);
    const { admin, tables, failOn } = queue(bytes);
    failOn((c) => c.table.startsWith('storage:'), { message: 'nere' });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ retried: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.portal_outbound_events[0]).toMatchObject({
      status: 'pending',
      next_attempt_at: new Date(NOW.getTime() + 30_000).toISOString(),
      last_error: 'dokumentet: filen kunde inte hämtas: nere',
    });
  });

  it('🧨 en äldre som köades EFTER en nyare (granskningens förlopp) skickas aldrig; den nyare kommer fram', async () => {
    const older = pdf(2000);
    const newer = pdf(3000);
    const NEWER_ID = '8e1c9f6f-2b3c-4d4e-8f9a-1b2c3d4e5f60';
    const olderEvent = stored(older);
    const newerEvent = buildPortalJobDocumentEvent({
      id: NEWER_ID,
      quoteId: 'q-1',
      kind: 'order_confirmation',
      name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
      sha256: sha256Hex(newer),
      byteSize: newer.length,
      readyAt: '2026-10-12T08:29:30.000Z',
    });
    const row = (id: string, seq: number, e: ReturnType<typeof stored>) => ({
      id,
      seq,
      idempotency_key: e.idempotencyKey,
      path: e.path,
      payload: e.payload,
      ordering_key: e.orderingKey,
      status: 'pending',
      attempts: 0,
      next_attempt_at: NOW.toISOString(),
    });
    const db = memoryAdmin(
      {
        crm_portal_job_documents: [docRow(), docRow({ id: NEWER_ID, created_at: '2026-10-12T08:29:00.000Z' })],
        // Den nyare köades FÖRST (lägre seq), den äldre sist.
        portal_outbound_events: [row('ev-new', 1, newerEvent), row('ev-old', 2, olderEvent)],
      },
      {
        rpc: (name, _args, tables) => {
          if (name !== 'claim_portal_outbound_events') return null;
          // Claim-funktionens regel: den första väntande per jobb.
          const head = tables.portal_outbound_events.filter((r) => r.status === 'pending').sort((a, b) => Number(a.seq) - Number(b.seq))[0];
          if (!head) return [];
          Object.assign(head, { status: 'sending', claimed_at: NOW.toISOString(), attempts: Number(head.attempts) + 1 });
          return [structuredClone(head)];
        },
      },
    );
    db.files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/${portalJobDocumentPath('q-1', DOC_ID)}`, older);
    db.files.set(`${PORTAL_JOB_DOCUMENTS_BUCKET}/${portalJobDocumentPath('q-1', NEWER_ID)}`, newer);
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;

    expect(await dispatchPortalOutbox(db.admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ sent: 1 });
    expect(await dispatchPortalOutbox(db.admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW })).toMatchObject({ sent: 0, superseded: 1 });
    expect(bodies).toHaveLength(1);
    expect(new Uint8Array(Buffer.from(JSON.parse(bodies[0]).data.contentBase64, 'base64'))).toEqual(newer);
    expect(db.tables.portal_outbound_events.find((e) => e.id === 'ev-old')).toMatchObject({
      status: 'superseded',
      last_error: 'dokumentet: ersatt av ett senare',
    });
  });

  it('ett dokument får längre tid på sig än en statushändelse', async () => {
    const bytes = pdf(2000);
    const { admin } = queue(bytes);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    await dispatchPortalOutbox(admin, { env: LOCAL_ENV, fetchImpl, now: () => NOW });
    expect(timeout).toHaveBeenCalledWith(PORTAL_DOCUMENT_REQUEST_TIMEOUT_MS);
    timeout.mockRestore();
  });
});
