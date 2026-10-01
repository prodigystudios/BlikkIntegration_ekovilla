import { describe, it, expect, vi } from 'vitest';
import { FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { emptyPortalArticleFields, type PortalArticleFields } from '@/lib/domains/portal/articleFields';
import {
  loadPricelistDraft,
  publishPricelist,
  readRegisterArticles,
  type PricelistSources,
} from '@/lib/domains/portal/pricelistPublish';
import { loadPricelistBatch, type PricelistBatchSources, type PricelistHistory } from '@/lib/domains/portal/pricelistBatchSources';
import type { PartnerPricelistSources } from '@/lib/domains/portal/partnerPricelistSources';
import type { PortalStoreCard } from '@/lib/domains/portal/partnerPricelists';
import { PORTAL_SIGNATURE_HEADER, PORTAL_TIMESTAMP_HEADER, verifyPortalSignature } from '@/lib/domains/portal/signature';

/**
 * Publiceringen (fas 2b), mot en minnesdatabas som sessionen och service-rollen delar. Det som skyddas:
 *   - avstängd integration, fel datum, tom lista och en lista som ändrats sedan förhandsvisningen sparar INGENTING;
 *   - utkastet byggs om på servern: klienten skickar bara datum och hashen den såg;
 *   - publiceringen sparas med sessionen, händelsen köas och skickas med service-rollen;
 *   - anropet till portalen går till rätt route, med nyckeln och en signatur som CRM:ets egen kontroll godkänner;
 *   - samma lista och datum som den SENASTE publiceringen: ingen ny rad, ingen ny händelse;
 *   - samma lista efter en annan (X, Y, X), eller efter ett nej från portalen: en ny publicering som skickas.
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
        let limit = Infinity;
        const orders: [string, boolean][] = [];
        const filters: ((r: Row) => boolean)[] = [];
        const run = () => {
          log.push({ client: name, table, op, values });
          const failure = failures[`${name}:${table}:${op}`];
          if (failure) return { data: null, error: failure };
          const rows = tables[table] ?? (tables[table] = []);
          if (op === 'upsert') {
            // Flera rader i ett anrop, som PostgREST: en rad vars nyckel finns hoppas över.
            const written: Row[] = [];
            for (const value of Array.isArray(values) ? values : [values!]) {
              if (rows.some((r) => r[onConflict] === value[onConflict])) continue;
              const row = { id: `${table}-${rows.length + 1}`, seq: rows.length + 1, status: 'pending', attempts: 0, ...value };
              rows.push(row);
              written.push({ ...row });
            }
            return { data: written, error: null };
          }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === 'update') hit.forEach((r) => Object.assign(r, values));
          const sorted = [...hit].sort((a, b) => {
            for (const [column, ascending] of orders) {
              if (a[column] === b[column]) continue;
              return (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          return { data: sorted.slice(0, limit).map((r) => ({ ...r })), error: null };
        };
        const chain: any = {
          upsert: (v: Row | Row[], o: { onConflict: string }) => ((op = 'upsert'), (values = v as Row), (onConflict = o.onConflict), chain),
          update: (v: Row) => ((op = 'update'), (values = v), chain),
          select: () => chain,
          order: (c: string, o?: { ascending?: boolean }) => (orders.push([c, o?.ascending !== false]), chain),
          limit: (n: number) => ((limit = n), chain),
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

/** Inga butiker med kundkort och ingen historik: publiceringen är bara lista 160, som före 10b2. */
const NO_PARTNERS: PartnerPricelistSources = { stores: async () => [], cardListCode: async () => null, listPrices: async () => [] };
const NO_HISTORY = async (): Promise<PricelistHistory> => ({ everOwn: new Set(), notInPortal: new Set() });

function batchSources(src: PricelistSources, partner: PartnerPricelistSources = NO_PARTNERS, history = NO_HISTORY): PricelistBatchSources {
  return { pricelist: src, partner, history };
}

async function publish(opts: {
  db?: ReturnType<typeof fakeDb>;
  env?: Record<string, string | undefined>;
  src?: ReturnType<typeof sources>;
  partner?: PartnerPricelistSources;
  history?: () => Promise<PricelistHistory>;
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
    {
      session: db.session,
      admin: db.admin,
      env: opts.env ?? ENV,
      loadBatch: () => loadPricelistBatch(batchSources(src, opts.partner, opts.history)),
      today: TODAY,
      actor: { id: 'user-1', name: 'Admin Adminsson' },
      fetchImpl,
    },
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
    const key = `pricelist-2026-10-01-${hash}-1`;
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

    const delivery = expect.objectContaining({ status: 'sent', attempts: 1, lastHttpStatus: 201, lastError: null, nextAttemptAt: null });
    expect(result).toEqual({
      kind: 'published',
      created: true,
      idempotencyKey: key,
      articleCount: 1,
      delivery,
      lists: [{ resellerId: null, code: '160', articleCount: 1, idempotencyKey: key, delivery }],
    });

    expect(db.tables.crm_portal_pricelist_publications).toEqual([
      expect.objectContaining({
        valid_from: '2026-10-01',
        content_hash: hash,
        sequence: 1,
        idempotency_key: key,
        payload,
        article_count: 1,
        published_by: 'user-1',
        published_by_name: 'Admin Adminsson',
        reseller_id: null,
        price_list_code: '160',
      }),
    ]);
    // Vem som skrev vad: publiceringen med sessionen, kön bara med service-rollen.
    expect(new Set(db.log.filter((l) => l.table === 'crm_portal_pricelist_publications').map((l) => l.client))).toEqual(
      new Set(['session']),
    );
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
    expect(first.db.tables.crm_portal_pricelist_publications.map((r) => [r.valid_from, r.sequence])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-15', 2],
    ]);
  });

  it('🧨 X, sedan Y, sedan X igen med samma datum: X skickas igen, annars räknar butikerna på Y', async () => {
    const x = sources();
    const y = sources({ prices: async () => [{ articleNumber: '2410509', fromQuantity: 0, price: 399 }] });
    const first = await publish({ src: x });
    const second = await publish({ db: first.db, src: y, expectedHash: await currentHash(y) });
    const third = await publish({ db: first.db, src: sources() });
    expect(second.result).toMatchObject({ kind: 'published', created: true });
    expect(third.result).toMatchObject({ kind: 'published', created: true, delivery: { status: 'sent' } });
    expect(third.fetchImpl).toHaveBeenCalledTimes(1);
    const rows = first.db.tables.crm_portal_pricelist_publications;
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(rows[2].content_hash).toBe(rows[0].content_hash);
    expect(rows[2].idempotency_key).not.toBe(rows[0].idempotency_key);
  });

  it('en lista portalen nekade kan publiceras igen, och går då fram', async () => {
    const first = await publish({ fetchImpl: portalFetch(404) });
    expect(first.result).toMatchObject({ delivery: { status: 'dead' } });
    const again = await publish({ db: first.db });
    expect(again.result).toMatchObject({ kind: 'published', created: true, delivery: { status: 'sent' } });
    expect(first.db.tables.crm_portal_pricelist_publications.map((r) => r.sequence)).toEqual([1, 2]);
  });

  it('portalen svarar 503: publicerad, och väntar i kön med felet', async () => {
    const { result, db } = await publish({ fetchImpl: portalFetch(503) });
    expect(result).toMatchObject({ kind: 'published', created: true, delivery: { status: 'pending', lastHttpStatus: 503 } });
    // Sidan visar när nästa försök görs: "Skicka väntande nu" tar den inte före det.
    expect(result.kind === 'published' && result.delivery?.nextAttemptAt).toBe(db.tables.portal_outbound_events[0].next_attempt_at);
    expect(result.kind === 'published' && result.delivery?.nextAttemptAt).toEqual(expect.any(String));
    expect(db.tables.portal_outbound_events[0].status).toBe('pending');
  });

  it('portalen nekar (422): publicerad men nekad, med portalens svar', async () => {
    const { result } = await publish({ fetchImpl: portalFetch(422) });
    expect(result).toMatchObject({ kind: 'published', delivery: { status: 'dead', lastHttpStatus: 422, lastError: 'HTTP 422: ok' } });
  });

  it('kön går inte att skriva: ett fel, men publiceringen står kvar och samma publicering igen köar den', async () => {
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

  it('registret läses för varje artikel på lista 160, också omarkerade, så att de syns som "inte med"', async () => {
    const src = sources({
      prices: async () => [
        { articleNumber: '2410509', fromQuantity: 0, price: 342 },
        { articleNumber: '13102', fromQuantity: 0, price: 195.3 },
      ],
      register: async (numbers) =>
        numbers.map((n) => ({ article_number: n, description: `Fortnox ${n}`, unit: 'st', active: true })),
    });
    const draft = await loadPricelistDraft(src);
    expect(draft.unmarked).toEqual([{ articleNumber: '13102', name: 'Fortnox 13102', unitCost: 195.3 }]);
  });

  it('registret läses med sessionen, i delar om 150, och ett fel stoppar', async () => {
    const calls: number[] = [];
    const session = {
      from: (table: string) => {
        expect(table).toBe('fortnox_articles_cache');
        const chain: any = {
          select: () => chain,
          in: (_c: string, numbers: string[]) => (
            calls.push(numbers.length),
            Promise.resolve({ data: numbers.map((n) => ({ article_number: n, description: n, unit: 'st', active: true })), error: null })
          ),
        };
        return chain;
      },
    } as never;
    const numbers = Array.from({ length: 400 }, (_, i) => String(i));
    expect(await readRegisterArticles(session, numbers)).toHaveLength(400);
    expect(calls).toEqual([150, 150, 100]);
    expect(await readRegisterArticles(session, [])).toEqual([]);

    const failing = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'nere' } }) }) }) } as never;
    await expect(readRegisterArticles(failing, ['1'])).rejects.toThrow(/Artikelregistret gick inte att läsa: nere/);
  });

  it('utkastet byggs om på servern ur källorna, också registret för alla artiklar på listan', async () => {
    const { src } = await publish();
    expect(src.calls).toEqual(expect.arrayContaining(['fields', 'prices', 'register:2410509']));
  });
});

// ------------------------------------------------------------------------------------------- butikernas listor (10b2)

describe('publishPricelist: butikernas egna listor (10b2)', () => {
  const store = (resellerId: string, customerId: string): PortalStoreCard => ({
    resellerId,
    storeName: `Butik ${resellerId}`,
    customerId,
    customerName: `Kort ${customerId}`,
    customerNumber: `nr-${customerId}`,
    cardVisible: true,
  });
  // r-b1 och r-b2 på ett kort med lista B, r-160 på ett kort med A. r-old har haft en egen lista men saknar kort nu,
  // och r-b2:s inbjudan har inte gått fram.
  const partner = (cards: Record<string, string | Error> = { 'nr-k1': 'B', 'nr-k2': 'A' }): PartnerPricelistSources => ({
    stores: async () => [store('r-b1', 'k1'), store('r-b2', 'k1'), store('r-160', 'k2')],
    cardListCode: async (n) => {
      const v = cards[n];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
    listPrices: async () => [{ articleNumber: '2410509', fromQuantity: 0, price: 300 }],
  });
  const history = async (): Promise<PricelistHistory> => ({ everOwn: new Set(['r-old']), notInPortal: new Set(['r-b2']) });

  async function batchHash(p = partner()) {
    return (await loadPricelistBatch(batchSources(sources(), p, history))).batch.hash;
  }

  it('lista 160 och en egen lista per butik, var och en i butikens ordning; en butik som väntar på inbjudan får ingen', async () => {
    const { result, db, fetchImpl } = await publish({ partner: partner(), history, expectedHash: await batchHash() });
    const shared = await currentHash(sources());
    const own = db.tables.crm_portal_pricelist_publications.find((r) => r.reseller_id === 'r-b1')!.content_hash;

    expect(result).toMatchObject({ kind: 'published', created: true });
    expect(result.kind === 'published' && result.lists.map((l) => [l.resellerId, l.code, l.idempotencyKey])).toEqual([
      [null, '160', `pricelist-2026-10-01-${shared}-1`],
      ['r-b1', 'B', `pricelist-2026-10-01-${own}-1-r-b1`],
      // Har haft en egen lista: får 160 som egen, annars hade portalen räknat på den gamla för alltid.
      ['r-old', '160', `pricelist-2026-10-01-${shared}-1-r-old`],
    ]);
    expect(db.tables.crm_portal_pricelist_publications.map((r) => [r.reseller_id, r.price_list_code, r.sequence])).toEqual([
      [null, '160', 1],
      ['r-b1', 'B', 1],
      ['r-old', '160', 1],
    ]);
    expect(db.tables.portal_outbound_events.map((e) => [e.ordering_key, e.payload.resellerId, e.status])).toEqual([
      ['pricelist', null, 'sent'],
      ['pricelist:r-b1', 'r-b1', 'sent'],
      ['pricelist:r-old', 'r-old', 'sent'],
    ]);
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies.map((b) => [b.resellerId, b.articles[0].unitCost])).toEqual([
      [null, 342],
      ['r-b1', 300],
      ['r-old', 342],
    ]);
  });

  it('förhandsvisningens hash är hela publiceringens: lista 160:s egen hash räcker inte när butiker har egna listor', async () => {
    const { result, db } = await publish({ partner: partner(), history, expectedHash: await currentHash(sources()) });
    expect(result.kind).toBe('changed');
    expect(db.log).toEqual([]);
  });

  it('🧨 ett kort som inte går att läsa: ingenting publiceras, inte heller lista 160', async () => {
    const broken = partner({ 'nr-k1': new FortnoxNotConnectedError(), 'nr-k2': 'A' });
    const { result, db, fetchImpl } = await publish({ partner: broken, history, expectedHash: await batchHash(broken) });
    expect(result).toEqual({ kind: 'blocked', problems: [expect.stringMatching(/^Kundkortet Kort k1: /)] });
    expect(db.log).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('samma listor igen: ingen ny rad eller händelse; en lista som nekats ger en ny publicering av alla', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Response('nej', { status: JSON.parse(init!.body as string).resellerId === 'r-b1' ? 422 : 201 }),
    );
    const first = await publish({ partner: partner(), history, expectedHash: await batchHash(), fetchImpl });
    expect(first.result.kind === 'published' && first.result.lists.map((l) => l.delivery?.status)).toEqual(['sent', 'dead', 'sent']);

    const again = await publish({ db: first.db, partner: partner(), history, expectedHash: await batchHash() });
    expect(again.result).toMatchObject({ kind: 'published', created: true });
    expect(first.db.tables.crm_portal_pricelist_publications.map((r) => r.sequence)).toEqual([1, 1, 1, 2, 2, 2]);

    const third = await publish({ db: first.db, partner: partner(), history, expectedHash: await batchHash() });
    expect(third.result).toMatchObject({ kind: 'published', created: false });
    expect(first.db.tables.crm_portal_pricelist_publications).toHaveLength(6);
    expect(third.fetchImpl).not.toHaveBeenCalled();
  });
});
