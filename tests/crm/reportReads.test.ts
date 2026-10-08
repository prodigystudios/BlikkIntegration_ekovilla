import { describe, it, expect } from 'vitest';
import { fetchInvoicedValue, fetchReportData } from '@/lib/domains/crm/reports';
import { fetchOpenQuoteRows, fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { fetchDepots, fetchOrderLineItems, fetchOrderSegments } from '@/lib/domains/crm/reportProductLoader';

// Rapportens läsvägar, till skillnad från de rena aggregaten i reports.test.ts och reportKpis.test.ts.
//
// 🧨 PostgREST kapar ett svar vid 1000 rader UTAN att fela. fetchReportData läste förut varje tabell
// i ett enda anrop, så med fler än 1000 offerter i perioden räknades hela rapporten tyst på en kapad
// mängd. Klienten nedan beter sig som PostgREST: den lämnar högst 1000 rader per svar, oavsett vad
// som begärs — så ett test som bara läser första sidan ser 1000 och blir rött.

const CAP = 1000;

type Call = { table: string; orders: string[]; ranges: Array<[number, number]>; filters: string[] };

function makeClient(tables: Record<string, unknown[]>, opts: { failTable?: string; failFrom?: number } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, orders: [], ranges: [], filters: [] };
      calls.push(call);
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      for (const m of ['in', 'eq', 'gte', 'lte', 'or']) {
        chain[m] = (column: string, value: unknown) => { call.filters.push(`${m}:${column}:${JSON.stringify(value)}`); return chain; };
      }
      chain.order = (column: string) => { call.orders.push(column); return chain; };
      chain.range = (f: number, t: number) => { from = f; to = t; call.ranges.push([f, t]); return chain; };
      chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
        if (opts.failTable === table && from >= (opts.failFrom ?? 0)) {
          return Promise.resolve({ data: null, error: { message: 'nekad' } }).then(ok, fail);
        }
        const rows = tables[table] ?? [];
        // PostgRESTs tak: aldrig fler än CAP rader i ett svar, vad som än begärs.
        const end = Math.min(to + 1, from + CAP);
        return Promise.resolve({ data: rows.slice(from, end), error: null }).then(ok, fail);
      };
      return chain;
    },
  };
  return { client: client as never, calls };
}

const RANGE = { from: '2026-01-01', to: '2026-12-31' };

const quotes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i}`, amount: 100, vat_percent: 0, status: 'sent', quote_date: '2026-05-01', assigned_to: null, customer_name: null }));

describe('fetchReportData — sidindelad', () => {
  it('läser ALLA rader förbi 1000-taket', async () => {
    const { client, calls } = makeClient({ crm_quotes: quotes(2_345) });
    const data = await fetchReportData(client, RANGE);

    expect(data.quotes).toHaveLength(2_345);
    // Tre sidor: 0–999, 1000–1999, 2000–2999 (den sista kortare, och där slutar läsningen).
    const quoteCalls = calls.filter((c) => c.table === 'crm_quotes');
    expect(quoteCalls.flatMap((c) => c.ranges)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('sorterar varje läsning på id — den unika nyckel sidorna vilar på', async () => {
    // Utan unik sortering är det odefinierat vilka rader som hamnar på vilken sida: rader kan både
    // dubbleras och hoppas över.
    const { client, calls } = makeClient({});
    await fetchReportData(client, RANGE);
    const tables = ['crm_quotes', 'crm_work_orders', 'crm_work_order_invoices', 'crm_calls', 'profiles'];
    for (const table of tables) {
      const call = calls.find((c) => c.table === table);
      expect(call, table).toBeDefined();
      expect(call!.orders.at(-1), table).toBe('id');
      expect(call!.ranges.length, table).toBeGreaterThan(0);
    }
  });

  it('kastar hellre än lämnar ett halvt underlag när en senare sida felar', async () => {
    // De 1000 första raderna kom; sida två felade. Ett svar med bara dem hade sett komplett ut.
    const { client } = makeClient({ crm_calls: Array.from({ length: 1_500 }, (_, i) => ({ id: `c${i}`, user_id: 'u1', call_at: '2026-05-01T09:00:00Z' })) }, { failTable: 'crm_calls', failFrom: 1000 });
    await expect(fetchReportData(client, RANGE)).rejects.toThrow(/crm_calls: nekad/);
  });
});

describe('fetchInvoicedValue', () => {
  it('räknar fakturerat precis som rapporten: per faktura, rundorna i stället för ordern', async () => {
    const { client } = makeClient({
      crm_work_orders: [
        // I ett svep, fakturerad i perioden.
        { id: 'o1', amount: 1000, vat_percent: 0, status: 'invoiced', created_at: '2026-03-01T08:00:00Z', fortnox_invoiced_at: '2026-05-02T08:00:00Z', partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'A' },
        // Delfakturerad och slutfakturerad: rundorna räknas, inte ordern — annars dubbelt. Ordern
        // säger 12 000 i dag (raderna ändrades efteråt), rundorna 9 000: fakturan är det som gick ut.
        { id: 'o2', amount: 12000, vat_percent: 0, status: 'invoiced', created_at: '2026-03-01T08:00:00Z', fortnox_invoiced_at: '2026-05-10T08:00:00Z', partial_invoicing_started_at: '2026-04-01T08:00:00Z', assigned_to: 'u1', client_name: 'B' },
        // Avbruten: aldrig omsättning.
        { id: 'o3', amount: 5000, vat_percent: 0, status: 'cancelled', created_at: '2026-05-01T08:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'C' },
      ],
      crm_work_order_invoices: [
        { amount: 4000, created_at: '2026-05-03T08:00:00Z', work_order: { status: 'invoiced', assigned_to: 'u1', client_name: 'B' } },
        { amount: 5000, created_at: '2026-05-10T08:00:00Z', work_order: { status: 'invoiced', assigned_to: 'u1', client_name: 'B' } },
      ],
    });
    expect(await fetchInvoicedValue(client, { from: '2026-05-01', to: '2026-05-31' })).toBe(10_000);
  });
});

describe('ögonblicksbildernas läsningar', () => {
  it('orderstocken läses sidindelad och bara på stockens statusar', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) => ({ id: `o${i}`, status: 'scheduled', amount: 1, vat_percent: 0, invoice_rounds: [] }));
    const { client, calls } = makeClient({ crm_work_orders: rows });
    expect(await fetchOrderStockRows(client)).toHaveLength(1_200);
    const call = calls[0];
    expect(call.orders.at(-1)).toBe('id');
    expect(call.filters).toContain('in:status:["draft","scheduled","ready","in_progress","completed","partially_invoiced"]');
  });

  it('de öppna offerterna läses sidindelade, på utkast, skickade och uppföljningar', async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => ({ id: `q${i}`, status: 'draft', amount: 1, vat_percent: 0, valid_until: null, follow_up_date: null }));
    const { client, calls } = makeClient({ crm_quotes: rows });
    expect(await fetchOpenQuoteRows(client)).toHaveLength(1_001);
    expect(calls.flatMap((c) => c.ranges)).toEqual([[0, 999], [1000, 1999]]);
    expect(calls[0].filters).toContain('in:status:["draft","sent","follow_up"]');
  });

  it('kastar när läsningen felar — rutten gör det till null, aldrig till en nolla', async () => {
    const { client } = makeClient({}, { failTable: 'crm_work_orders' });
    await expect(fetchOrderStockRows(client)).rejects.toThrow(/orderstock: nekad/);
  });
});

describe('Produkt & marknads läsningar', () => {
  // En klient som också respekterar `.in()`, som PostgREST: bara raderna vars kolumn finns i listan.
  function inClient(tables: Record<string, Array<Record<string, unknown>>>, opts: { failTable?: string } = {}) {
    const calls: Array<{ table: string; select: string; inColumn: string; inValues: unknown[]; orders: string[]; ranges: Array<[number, number]> }> = [];
    const client = {
      from(table: string) {
        const call = { table, select: '', inColumn: '', inValues: [] as unknown[], orders: [] as string[], ranges: [] as Array<[number, number]> };
        calls.push(call);
        let from = 0;
        let to = Number.MAX_SAFE_INTEGER;
        const chain: Record<string, unknown> = {};
        chain.select = (cols: string) => { call.select = cols; return chain; };
        chain.in = (column: string, values: unknown[]) => { call.inColumn = column; call.inValues = values; return chain; };
        chain.order = (column: string) => { call.orders.push(column); return chain; };
        chain.range = (f: number, t: number) => { from = f; to = t; call.ranges.push([f, t]); return chain; };
        chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
          if (opts.failTable === table) return Promise.resolve({ data: null, error: { message: 'nekad' } }).then(ok, fail);
          const rows = (tables[table] ?? []).filter((row) => !call.inColumn || call.inValues.includes(row[call.inColumn]));
          return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + CAP)), error: null }).then(ok, fail);
        };
        return chain;
      },
    };
    return { client: client as never, calls };
  }

  it('orderraderna läses i klumpar om 100 id:n, varje klump sorterad och sidindelad', async () => {
    const orders = Array.from({ length: 250 }, (_, i) => ({ id: `o${i}`, line_items: [{ m2: String(i) }] }));
    const { client, calls } = inClient({ crm_work_orders: orders });
    // Dubbletter i listan läses en gång.
    const map = await fetchOrderLineItems(client, [...orders.map((o) => o.id), 'o0']);
    expect(map.size).toBe(250);
    expect(map.get('o249')).toEqual([{ m2: '249' }]);
    expect(calls.map((c) => c.inValues.length)).toEqual([100, 100, 50]);
    expect(calls.every((c) => c.inColumn === 'id' && c.orders.at(-1) === 'id' && c.ranges.length > 0)).toBe(true);
  });

  it('inga id:n: ingen fråga', async () => {
    const { client, calls } = inClient({});
    expect((await fetchOrderLineItems(client, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('segmenten läses på orderns id, sidindelat förbi 1000-taket, med bilen utpekad', async () => {
    const segments = Array.from({ length: 1_200 }, (_, i) => ({ id: `s${i}`, work_order_id: 'o1', start_day: '2026-09-07', end_day: '2026-09-07', truck: { depot_id: 'd' } }));
    const { client, calls } = inClient({ ops_segments: [...segments, { id: 'annan', work_order_id: 'o2', start_day: '2026-09-07', end_day: '2026-09-07', truck: null }] });
    expect(await fetchOrderSegments(client, ['o1'])).toHaveLength(1_200);
    expect(calls[0].inColumn).toBe('work_order_id');
    expect(calls.flatMap((c) => c.ranges)).toEqual([[0, 999], [1000, 1999]]);
    expect(calls[0].select).toContain('truck:ops_trucks!ops_segments_truck_id_fkey(depot_id)');
  });

  it('depåerna läses alla, även inaktiva', async () => {
    const { client, calls } = inClient({ ops_depots: [{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: false }] });
    expect(await fetchDepots(client)).toHaveLength(2);
    expect(calls[0].inColumn).toBe('');
  });

  it('kastar när en läsning felar — rutten gör det till null, aldrig till nollor', async () => {
    await expect(fetchOrderLineItems(inClient({}, { failTable: 'crm_work_orders' }).client, ['o1'])).rejects.toThrow(/orderrader: nekad/);
    await expect(fetchOrderSegments(inClient({}, { failTable: 'ops_segments' }).client, ['o1'])).rejects.toThrow(/schemat: nekad/);
    await expect(fetchDepots(inClient({}, { failTable: 'ops_depots' }).client)).rejects.toThrow(/depåerna: nekad/);
  });
});
