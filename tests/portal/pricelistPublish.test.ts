import { describe, it, expect, vi } from 'vitest';
import { FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { emptyPortalArticleFields, type PortalArticleFields } from '@/lib/domains/portal/articleFields';
import { publishPricelist, loadPricelistDraft, type PricelistSources } from '@/lib/domains/portal/pricelistPublish';
import { PORTAL_SIGNATURE_HEADER, PORTAL_TIMESTAMP_HEADER, verifyPortalSignature } from '@/lib/domains/portal/signature';

/**
 * Publiceringen (fas 2b), mot en minnesdatabas som sessionen och service-rollen delar. Det som skyddas:
 *   - avstängd integration, fel datum, tom lista och en lista som ändrats sedan förhandsvisningen sparar INGENTING;
 *   - utkastet byggs om på servern: klienten skickar bara datum och hashen den såg;
 *   - publiceringen sparas med sessionen, händelsen köas och skickas med service-rollen;
 *   - anropet till portalen går till rätt route, med nyckeln och en signatur som CRM:ets egen kontroll godkänner;
 *   - samma lista och datum igen: ingen ny rad, ingen ny händelse.
 */

const SECRET = 'b'.repeat(64);
const ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:55321',
  PORTAL_CRM_SHARED_SECRET: SECRET,
  RESELLER_PORTAL_URL: 'http://localhost:3001',
};
const TODAY = '2026-09-28';

type Row = Record<string, any>;

/** Minnesdatabas: två klienter, samma tabeller. `failures` gör ett anrop fel: `session:tabell:op`. */
function fakeDb() {
  const tables: Record<string, Row[]> = { crm_portal_pricelist_publications: [], portal_outbound_events: [] };
  const log: { client: string; table: string; op: string; values?: Row }[] = [];
  const failures: Record<string, { code: string; message: string }> = {};

  function client(name: 'session' | 'admin') {
    return {
      from(table: string) {
        let op = 'select';
        let values: Row | undefined;
        let onConflict = '';
        const filters: ((r: Row) => boolean)[] = [];
        const run = () => {
          log.push({ client: name, table, op, values });
          const failure = failures[`${name}:${table}:${op}`];
          if (failure) return { data: null, error: failure };
          const rows = tables[table] ?? (tables[table] = []);
          if (op === 'upsert') {
            if (rows.some((r) => r[onConflict] === values![onConflict])) return { data: [], error: null };
            const row = { id: `${table}-${rows.length + 1}`, seq: rows.length + 1, status: 'pending', attempts: 0, ...values };
            rows.push(row);
            return { data: [{ ...row }], error: null };
          }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === 'update') hit.forEach((r) => Object.assign(r, values));
          return { data: hit.map((r) => ({ ...r })), error: null };
        };
        const chain: any = {
          upsert: (v: Row, o: { onConflict: string }) => ((op = 'upsert'), (values = v), (onConflict = o.onConflict), chain),
          update: (v: Row) => ((op = 'update'), (values = v), chain),
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
          lt: (c: string, v: any) => (filters.push((r) => r[c] < v), chain),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain),
          maybeSingle: async () => {
            const r = run();
            return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
          },
          then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
        };
        return chain;
      },
      // claim_portal_outbound_events: allt som väntar blir "sending".
      rpc: async () => {
        log.push({ client: name, table: 'claim_portal_outbound_events', op: 'rpc' });
        const due = tables.portal_outbound_events.filter((r) => r.status === 'pending');
        for (const r of due) Object.assign(r, { status: 'sending', attempts: r.attempts + 1, claimed_at: '2026-09-28T08:00:00Z' });
        return { data: due.map((r) => ({ ...r })), error: null };
      },
    };
  }
  return { session: client('session') as never, admin: client('admin') as never, tables, log, failures };
}

function field(articleNumber: string, patch: Partial<PortalArticleFields> = {}): PortalArticleFields {
  return { ...emptyPortalArticleFields(articleNumber), customer_name: `Kund ${articleNumber}`, category: 'losull', publish: true, ...patch };
}

function sources(overrides: Partial<PricelistSources> = {}): PricelistSources & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fields: async () => (calls.push('fields'), [field('2410509', { labor_share: 0.45, sort_order: 10 })]),
    register: async (numbers) => (
      calls.push(`register:${numbers.join(',')}`),
      [{ article_number: '2410509', description: 'EKOVILLA cellulosa vind', unit: 'M3', active: true }]
    ),
    prices: async () => (calls.push('prices'), [{ articleNumber: '2410509', fromQuantity: 0, price: 342 }]),
    ...overrides,
  };
}

async function currentHash(s: PricelistSources) {
  return (await loadPricelistDraft(s)).hash;
}

function portalFetch(status = 201) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('ok', { status }));
}

async function publish(opts: {
  db?: ReturnType<typeof fakeDb>;
  env?: Record<string, string | undefined>;
  src?: ReturnType<typeof sources>;
  validFrom?: string;
  expectedHash?: string;
  fetchImpl?: ReturnType<typeof portalFetch>;
} = {}) {
  const db = opts.db ?? fakeDb();
  const src = opts.src ?? sources();
  const fetchImpl = opts.fetchImpl ?? portalFetch();
  const expectedHash = opts.expectedHash ?? (await currentHash(sources()));
  src.calls.length = 0;
  const result = await publishPricelist(
    { session: db.session, admin: db.admin, env: opts.env ?? ENV, sources: src, today: TODAY, actor: { id: 'user-1', name: 'Admin Adminsson' }, fetchImpl },
    { validFrom: opts.validFrom ?? '2026-10-01', expectedHash },
  );
  return { result, db, src, fetchImpl };
}

describe('publishPricelist: det som stoppar', () => {
  it('avstängd integration (ingen hemlighet): ingenting läses, sparas eller köas', async () => {
    const { result, db, src } = await publish({ env: { ...ENV, PORTAL_CRM_SHARED_SECRET: '' } });
    expect(result.kind).toBe('integration_off');
    expect(src.calls).toEqual([]);
    expect(db.log).toEqual([]);
  });

  it('en adress miljön inte får skicka till räknas som avstängd', async () => {
    const { result, db } = await publish({ env: { ...ENV, RESELLER_PORTAL_URL: 'https://partner.ekovilla.se' } });
    expect(result.kind).toBe('integration_off');
    expect(db.log).toEqual([]);
  });

  it.each(['2026-09-27', '2026-02-30', 'i morgon'])('giltig från %s: nekas', async (validFrom) => {
    const { result, db } = await publish({ validFrom });
    expect(result.kind).toBe('invalid_valid_from');
    expect(db.log).toEqual([]);
  });

  it('i dag går bra', async () => {
    const { result } = await publish({ validFrom: TODAY });
    expect(result.kind).toBe('published');
  });

  it('Fortnox inte kopplat: ett läsbart fel, ingenting sparas', async () => {
    const src = sources({ prices: async () => Promise.reject(new FortnoxNotConnectedError()) });
    const { result, db } = await publish({ src, expectedHash: 'a'.repeat(64) });
    expect(result).toEqual({ kind: 'source_error', message: expect.stringMatching(/^Lista 160 gick inte att läsa: Fortnox är inte kopplat/) });
    expect(db.log).toEqual([]);
  });

  it('en tom lista publiceras inte', async () => {
    const src = sources({ fields: async () => [field('2410509', { publish: false })] });
    const { result, db } = await publish({ src, expectedHash: await currentHash(src) });
    expect(result.kind).toBe('empty');
    expect(db.log).toEqual([]);
  });

  it('en lista som ändrats sedan förhandsvisningen: ingenting sparas', async () => {
    const { result, db } = await publish({ expectedHash: 'c'.repeat(64) });
    expect(result.kind).toBe('changed');
    expect(db.log).toEqual([]);
  });

  it('RLS nekar publiceringen: ingenting köas', async () => {
    const db = fakeDb();
    db.failures['session:crm_portal_pricelist_publications:upsert'] = { code: '42501', message: 'rls' };
    const { result } = await publish({ db });
    expect(result.kind).toBe('forbidden');
    expect(db.tables.portal_outbound_events).toEqual([]);
  });
});

describe('publishPricelist: publiceringen', () => {
  it('sparar med sessionen, köar och skickar med service-rollen, och portalen tar emot den', async () => {
    const { result, db, fetchImpl } = await publish();
    const hash = await currentHash(sources());
    const key = `pricelist-2026-10-01-${hash}`;
    const payload = {
      validFrom: '2026-10-01',
      resellerId: null,
      articles: [
        {
          articleNumber: '2410509',
          name: 'EKOVILLA cellulosa vind',
          customerName: 'Kund 2410509',
          note: '',
          category: 'losull',
          unit: 'm3',
          unitCost: 342,
          laborShare: 0.45,
          sortOrder: 10,
        },
      ],
    };

    expect(result).toEqual({
      kind: 'published',
      created: true,
      idempotencyKey: key,
      articleCount: 1,
      delivery: expect.objectContaining({ status: 'sent', attempts: 1, lastHttpStatus: 201, lastError: null }),
    });

    expect(db.tables.crm_portal_pricelist_publications).toEqual([
      expect.objectContaining({
        valid_from: '2026-10-01',
        content_hash: hash,
        idempotency_key: key,
        payload,
        article_count: 1,
        published_by: 'user-1',
        published_by_name: 'Admin Adminsson',
      }),
    ]);
    // Vem som skrev vad: publiceringen med sessionen, kön bara med service-rollen.
    expect(db.log.filter((l) => l.table === 'crm_portal_pricelist_publications').map((l) => l.client)).toEqual(['session']);
    expect(new Set(db.log.filter((l) => l.table === 'portal_outbound_events').map((l) => l.client))).toEqual(new Set(['admin']));
    expect(db.tables.portal_outbound_events).toEqual([
      expect.objectContaining({ idempotency_key: key, path: '/api/ekovilla/pricelists', ordering_key: 'pricelist', payload, status: 'sent' }),
    ]);

    // Anropet: rätt adress, nyckeln, och en signatur som mottagarens kontroll godkänner.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, maybeInit] = fetchImpl.mock.calls[0];
    const init = maybeInit!;
    expect(url).toBe('http://localhost:3001/api/ekovilla/pricelists');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(key);
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(
      verifyPortalSignature({
        secret: SECRET,
        method: 'POST',
        path: '/api/ekovilla/pricelists',
        rawBody: init.body as string,
        timestampHeader: headers[PORTAL_TIMESTAMP_HEADER],
        signatureHeader: headers[PORTAL_SIGNATURE_HEADER],
        nowSeconds: Number(headers[PORTAL_TIMESTAMP_HEADER]),
      }),
    ).toEqual({ ok: true });
  });

  it('samma lista och datum igen: ingen ny rad, ingen ny händelse, och portalen får inget nytt anrop', async () => {
    const first = await publish();
    const again = await publish({ db: first.db });
    expect(again.result).toMatchObject({ kind: 'published', created: false, delivery: { status: 'sent' } });
    expect(first.db.tables.crm_portal_pricelist_publications).toHaveLength(1);
    expect(first.db.tables.portal_outbound_events).toHaveLength(1);
    expect(again.fetchImpl).not.toHaveBeenCalled();
  });

  it('samma lista med ett annat datum är en ny publicering', async () => {
    const first = await publish();
    const later = await publish({ db: first.db, validFrom: '2026-10-15' });
    expect(later.result).toMatchObject({ kind: 'published', created: true });
    expect(first.db.tables.crm_portal_pricelist_publications.map((r) => r.valid_from)).toEqual(['2026-10-01', '2026-10-15']);
  });

  it('portalen svarar 503: publicerad, och väntar i kön med felet', async () => {
    const { result, db } = await publish({ fetchImpl: portalFetch(503) });
    expect(result).toMatchObject({ kind: 'published', created: true, delivery: { status: 'pending', lastHttpStatus: 503 } });
    expect(db.tables.portal_outbound_events[0].status).toBe('pending');
  });

  it('portalen nekar (422): publicerad men nekad, med portalens svar', async () => {
    const { result } = await publish({ fetchImpl: portalFetch(422) });
    expect(result).toMatchObject({ kind: 'published', delivery: { status: 'dead', lastHttpStatus: 422, lastError: 'HTTP 422: ok' } });
  });

  it('kön går inte att skriva: ett fel, men publiceringen står kvar och en ny publicering köar den', async () => {
    const db = fakeDb();
    db.failures['admin:portal_outbound_events:upsert'] = { code: 'XX000', message: 'nere' };
    const { result } = await publish({ db });
    expect(result.kind).toBe('db_error');
    expect(db.tables.crm_portal_pricelist_publications).toHaveLength(1);

    delete db.failures['admin:portal_outbound_events:upsert'];
    const again = await publish({ db });
    expect(again.result).toMatchObject({ kind: 'published', created: false, delivery: { status: 'sent' } });
    expect(db.tables.portal_outbound_events).toHaveLength(1);
  });

  it('utkastet byggs om på servern ur källorna, också registret för alla artiklar på listan', async () => {
    const { src } = await publish();
    expect(src.calls).toEqual(expect.arrayContaining(['fields', 'prices', 'register:2410509']));
  });
});
