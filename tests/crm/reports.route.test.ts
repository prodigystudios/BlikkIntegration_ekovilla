import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, konsultUser, memberUser, ekonomiUser, effectivePermissionsForRole } from './helpers/supabase';

// 🔴 GRINDEN FRAMFÖR TIDSDELEN.
//
// Rapportsidan gatas på `crm.access`, som sales och konsult också har, och rutten läser med
// SERVICE-ROLL — alltså förbi RLS. Tidsdelen bär namngiven arbetad tid OCH frånvaro per person,
// och `crm_time_entries_select` öppnar andras rader först på `time.entry.read.all` (admin,
// ekonomi). Policyns egen kommentar säger rakt ut att det är mekanismen som hindrar en
// sjukfrånvarorad från att synas för besättningskollegorna.
//
// Utan den här grinden såg varje säljare sina kollegors sjukskrivningar vid namn. Samma misstag
// som #202, där `crm.access` gav bort försäljningssiffror förbi RLS.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@/lib/domains/crm/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/reports')>();
  return {
    ...actual,
    fetchReportData: vi.fn(async () => ({ quotes: [], orders: [], invoiceRounds: [], calls: [], sellers: [] })),
    fetchInvoicedValue: vi.fn(async () => 70_000),
    fetchTrendData: vi.fn(async () => ({ quotes: [], orders: [], invoiceRounds: [] })),
  };
});
vi.mock('@/lib/domains/crm/reportKpisLoader', () => ({
  fetchOrderStockRows: vi.fn(async () => [
    { status: 'scheduled', amount: 20_000, vat_percent: 0, invoice_rounds: [] },
    { status: 'completed', amount: 10_000, vat_percent: 0, invoice_rounds: [] },
  ]),
  fetchOpenQuoteRows: vi.fn(async () => [
    { status: 'draft', amount: 5_000, vat_percent: 0, valid_until: '2000-01-01', follow_up_date: null },
  ]),
  fetchFirstActivityDay: vi.fn(async () => '2026-06-29'),
  fetchCustomerOrderRows: vi.fn(async () => [
    { status: 'invoiced', created_at: '2026-08-10T08:00:00Z', customer_id: 'k1', client_name: 'Kund 1' },
    { status: 'scheduled', created_at: '2026-09-10T08:00:00Z', customer_id: 'k1', client_name: 'Kund 1' },
    { status: 'scheduled', created_at: '2026-09-10T08:00:00Z', customer_id: 'k2', client_name: 'Kund 2' },
    // Efter periodens slut (september): gör inte k2 återkommande i september.
    { status: 'scheduled', created_at: '2026-10-03T08:00:00Z', customer_id: 'k2', client_name: 'Kund 2' },
  ]),
}));
vi.mock('@/lib/domains/crm/reportProductLoader', () => ({
  fetchOrderLineItems: vi.fn(async () => new Map()),
  fetchOrderSegments: vi.fn(async () => []),
  fetchDepots: vi.fn(async () => [{ id: 'sv', name: 'Sandviken', active: true }]),
}));
vi.mock('@/lib/domains/planning/productionLoader', () => ({
  fetchProductionData: vi.fn(async () => ({ data: { reports: [], segments: [], trucks: [] }, error: null })),
}));
vi.mock('@/lib/domains/planning/insights', () => ({
  loadScheduledScopes: vi.fn(async () => ({ data: { values: [], labels: new Map(), truckNames: new Map(), spans: [] }, error: null })),
  computeBacklogValue: vi.fn(async () => ({ data: { revenue: 0, sacks: 0, count: 0 }, error: null })),
}));
vi.mock('@/lib/domains/time/reportLoader', () => ({
  fetchTimeReportData: vi.fn(async () => ({
    data: {
      entries: [
        { user_id: 'u1', work_date: '2026-09-07', kind: 'work_order', minutes_worked: 480 },
        { user_id: 'u2', work_date: '2026-09-08', kind: 'absence', minutes_worked: 480, absence_reason: 'Sjukfrånvaro' },
      ],
      people: [{ id: 'u1', full_name: 'Anna Andersson' }, { id: 'u2', full_name: 'Bo Bengtsson' }],
    },
    error: null,
  })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { fetchTimeReportData } from '@/lib/domains/time/reportLoader';
import { fetchCustomerOrderRows, fetchFirstActivityDay, fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { fetchInvoicedValue, fetchReportData, fetchTrendData } from '@/lib/domains/crm/reports';
import { fetchDepots, fetchOrderLineItems, fetchOrderSegments } from '@/lib/domains/crm/reportProductLoader';
import { GET } from '@/app/api/crm/reports/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockTimeLoader = vi.mocked(fetchTimeReportData);
const mockOrderStock = vi.mocked(fetchOrderStockRows);
const mockInvoicedValue = vi.mocked(fetchInvoicedValue);
const mockTrendData = vi.mocked(fetchTrendData);
const mockReportData = vi.mocked(fetchReportData);
const mockFirstActivity = vi.mocked(fetchFirstActivityDay);
const mockCustomerOrders = vi.mocked(fetchCustomerOrderRows);
const mockLineItems = vi.mocked(fetchOrderLineItems);
const mockSegments = vi.mocked(fetchOrderSegments);
const mockDepots = vi.mocked(fetchDepots);

const req = () => new Request('http://localhost/api/crm/reports?from=2026-09-01&to=2026-09-30');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue(adminUser as any);
  mockPermissions.mockImplementation(async () => effectivePermissionsForRole((await mockGetUser())?.role) as any);
});

async function body(user: unknown) {
  mockGetUser.mockResolvedValue(user as any);
  const res = await GET(req());
  return { status: res.status, json: await res.json() };
}

describe('GET /api/crm/reports — datumen', () => {
  it('en dag som inte finns är ett 400, inte ett 500', async () => {
    for (const q of ['from=2026-02-30&to=2026-03-31', 'from=2026-02-01&to=2026-02-30', 'from=2026-13-01&to=2026-12-31']) {
      const res = await GET(new Request(`http://localhost/api/crm/reports?${q}`));
      expect(res.status, q).toBe(400);
    }
    expect(mockReportData).not.toHaveBeenCalled();
  });
});

describe('GET /api/crm/reports — tidsdelens grind', () => {
  it('admin ser tiden', async () => {
    const { status, json } = await body(adminUser);
    expect(status).toBe(200);
    expect(json.data.time).not.toBeNull();
    expect(json.data.time.workOrderMinutes).toBe(480);
  });

  it('ekonomi nekas HELA sidan — rollen saknar crm.access med flit', async () => {
    // ⚠️ Inte en lucka, utan ett fattat beslut: `crm.access` gav bort försäljningssiffror förbi
    // RLS (#202), så ekonomi fick `crm.workorder.read` i stället. Följden här är att tidsdelen i
    // praktiken bara syns för ADMIN — den enda roll som har både crm.access och
    // time.entry.read.all. Skulle ekonomi behöva rapportsidan är det en egen ändring av sidans
    // grind, inte av tidsdelens.
    const { status } = await body(ekonomiUser);
    expect(status).toBe(403);
  });

  it('🔴 SÄLJARE FÅR INTE SE ANDRAS TID', async () => {
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    expect(json.data.time).toBeNull();
    // Och inget namn eller frånvaroskäl får ha läckt någon annanstans i svaret.
    const payload = JSON.stringify(json);
    expect(payload).not.toContain('Sjukfrånvaro');
    expect(payload).not.toContain('Bo Bengtsson');
  });

  it('🔴 KONSULT FÅR INTE SE ANDRAS TID', async () => {
    const { json } = await body(konsultUser);
    expect(json.data.time).toBeNull();
    expect(JSON.stringify(json)).not.toContain('Sjukfrånvaro');
  });

  it('läsningen görs INTE ens när behörighet saknas', async () => {
    // ⚠️ Inte bara en filtrering av svaret. Hämtas raderna ändå ligger kollegornas frånvaro i
    // serverns minne och en framtida ändring kan råka skicka med dem — och det är en onödig
    // fråga mot databasen för varje säljare som öppnar sidan.
    await body(salesUser);
    expect(mockTimeLoader).not.toHaveBeenCalled();

    await body(adminUser);
    expect(mockTimeLoader).toHaveBeenCalledTimes(1);
  });

  it('nekar member helt — rapportsidan kräver crm.access', async () => {
    const { status } = await body(memberUser);
    expect(status).toBe(403);
  });

  it('nekar utan session', async () => {
    const { status } = await body(null);
    expect(status).toBe(401);
  });
});

describe('GET /api/crm/reports — tiden får inte sänka rapporten', () => {
  it('en trasig tidsläsning lämnar säljsiffrorna orörda och märker delen som oräknad', async () => {
    mockTimeLoader.mockResolvedValueOnce({ data: { entries: [], people: [] }, error: { message: 'nekad' } } as any);
    const { status, json } = await body(adminUser);
    expect(status).toBe(200);
    // `unavailable` = kunde inte räknas. Skilt från null, som betyder "får inte visas".
    expect(json.data.time.unavailable).toBe(true);
    expect(json.data.salesOverTime).toBeDefined();
  });
});

describe('GET /api/crm/reports — översiktens nyckeltal', () => {
  it('skickar med orderstock, öppna offerter och hit rate', async () => {
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    expect(json.data.overview.orderStock).toMatchObject({ value: 30_000, count: 2, completed: { count: 1, value: 10_000 } });
    expect(json.data.overview.openQuotes).toMatchObject({ count: 1, value: 5_000, expired: { count: 1, drafts: 1 } });
    expect(json.data.overview.hitRate).toMatchObject({ quotes: 0, won: 0, percent: null });
  });

  it('mäter veckotalet mot FÖRRA HELA kalendermånaden, inte den valda perioden', async () => {
    // Klockan låst till 7 oktober 2026 (bara Date — anropen ska fortfarande lösas), och en vald period
    // långt bakåt, så att de två aldrig kan sammanfalla: med standardanropets september hade testet
    // varit grönt i oktober även om rutten mätt mot den valda perioden.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      mockGetUser.mockResolvedValue(salesUser as any);
      const res = await GET(new Request('http://localhost/api/crm/reports?from=2025-01-01&to=2025-01-31'));
      const json = await res.json();
      const basis = json.data.overview.orderStock.basis;
      expect(basis.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
      expect(mockInvoicedValue).toHaveBeenCalledWith(expect.anything(), basis.range);
      expect(basis.invoiced).toBe(70_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('en trasig orderstock blir null och lämnar resten orört', async () => {
    // "Orderstock 0 kr" hade varit ett påstående om verksamheten. null = kunde inte räknas.
    mockOrderStock.mockRejectedValueOnce(new Error('nekad'));
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    expect(json.data.overview.orderStock).toBeNull();
    expect(json.data.overview.openQuotes).not.toBeNull();
    expect(json.data.periodSummary).toBeDefined();
  });

  it('en trasig faktureringsläsning tar bara bort veckotalet, inte stocken', async () => {
    mockInvoicedValue.mockRejectedValueOnce(new Error('nekad'));
    const { json } = await body(salesUser);
    expect(json.data.overview.orderStock.value).toBe(30_000);
    expect(json.data.overview.orderStock.weeks).toBeNull();
    expect(json.data.overview.orderStock.basis).toBeNull();
  });
});

describe('GET /api/crm/reports — standardperiod och trend', () => {
  // Klockan låst till 7 oktober 2026 (bara Date — anropen ska fortfarande lösas).
  async function atOctoberSeventh(url: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      mockGetUser.mockResolvedValue(salesUser as any);
      const res = await GET(new Request(url));
      return { status: res.status, json: await res.json() };
    } finally {
      vi.useRealTimers();
    }
  }

  it('öppnar på DENNA MÅNAD när inget datum skickas (beslut 2026-10-07, tidigare 12 månader)', async () => {
    const { json } = await atOctoberSeventh('http://localhost/api/crm/reports');
    expect(json.data.range).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('trenden följer INTE perioden: tolv månader bakåt, men aldrig före första aktiviteten', async () => {
    const { json } = await atOctoberSeventh('http://localhost/api/crm/reports?from=2026-09-01&to=2026-09-30');
    expect(json.data.trend.range).toEqual({ from: '2026-06-29', to: '2026-10-07' });
    // Läsningen tar hela tolvmånadersfönstret, parallellt med första aktivitetsdagen; fönstret kortas
    // av i beräkningen.
    expect(mockTrendData).toHaveBeenCalledWith(expect.anything(), { from: '2025-11-01', to: '2026-10-07' });
    expect(json.data.trend.points.map((p: any) => p.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(json.data.trend.points.filter((p: any) => p.inPeriod).map((p: any) => p.period)).toEqual(['2026-09']);
  });

  it('"Senaste 12 mån" återanvänder periodens rader i stället för att läsa trenden en gång till', async () => {
    const { json } = await atOctoberSeventh('http://localhost/api/crm/reports?from=2025-11-01&to=2026-10-07');
    expect(mockTrendData).not.toHaveBeenCalled();
    expect(json.data.trend.range).toEqual({ from: '2026-06-29', to: '2026-10-07' });
  });

  it('okänd första aktivitet ger tolv månader, inte ett fel', async () => {
    mockFirstActivity.mockRejectedValueOnce(new Error('nekad'));
    const { json } = await atOctoberSeventh('http://localhost/api/crm/reports');
    expect(json.data.trend.range).toEqual({ from: '2025-11-01', to: '2026-10-07' });
  });

  it('en trasig trendläsning blir null och lämnar resten orört', async () => {
    mockTrendData.mockRejectedValueOnce(new Error('nekad'));
    const { status, json } = await atOctoberSeventh('http://localhost/api/crm/reports');
    expect(status).toBe(200);
    expect(json.data.trend).toBeNull();
    expect(json.data.periodSummary).toBeDefined();
    expect(json.data.overview).not.toBeNull();
  });
});

// En klient som beter sig som PostgREST: den lämnar BARA ut de kolumner frågan ber om. Tappar
// ruttens målfråga invoiced_value_target får fakturerat inget mål — tyst, utan fel.
function goalsAdmin(rows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      let columns: string[] = [];
      let periodStarts: string[] | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => { columns = cols.split(',').map((c) => c.trim()); return chain; };
      chain.eq = () => chain;
      // Filtret respekteras, som i PostgREST: en fråga på för få månader får för få rader.
      chain.in = (column: string, values: string[]) => { if (column === 'period_start') periodStarts = values; return chain; };
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(
        table === 'crm_goals'
          ? {
            data: rows
              .filter((row) => periodStarts == null || periodStarts.includes(String(row.period_start)))
              .map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))),
            error: null,
          }
          : { data: null, error: { message: `oväntad tabell ${table}` } },
      ).then(ok);
      return chain;
    },
  };
}

describe('GET /api/crm/reports — målet för fakturerat', () => {
  it('läser invoiced_value_target och ger fakturerat en målstapel', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValueOnce(goalsAdmin([
      { period_start: '2026-09-01', calls_target: 10, quotes_target: 10, quote_value_target: 100, order_count_target: 1, order_value_target: 100, invoiced_value_target: 900_000 },
    ]) as any);
    const { json } = await body(salesUser);
    const invoiced = json.data.periodSummary.metrics.find((m: any) => m.key === 'invoicedValue');
    expect(invoiced.target).toBe(900_000);
  });
});

describe('GET /api/crm/reports — trendens mål', () => {
  it('läser målen för trendens tolv månader, inte bara den valda periodens', async () => {
    // Förvalet är denna månad (oktober). Utan trendens månader i målfrågan hade augusti — en hel månad
    // med budget — stått utan målstreck i diagrammet, och inget test hade märkt det.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      const goalsRow = { calls_target: 0, quotes_target: 0, quote_value_target: 500_000, order_count_target: 0, order_value_target: 0, invoiced_value_target: 0 };
      vi.mocked(getSupabaseAdmin).mockReturnValueOnce(goalsAdmin([{ period_start: '2026-08-01', ...goalsRow }]) as any);
      mockGetUser.mockResolvedValue(salesUser as any);
      const res = await GET(new Request('http://localhost/api/crm/reports'));
      const json = await res.json();
      const august = json.data.trend.points.find((p: any) => p.period === '2026-08');
      expect(august.goals.quoteValue).toBe(500_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /api/crm/reports — Försäljningens nyckeltal', () => {
  const quote = (status: string, quote_date: string, quote_type = 'business') => ({
    amount: 1000, vat_percent: 0, status, quote_date, assigned_to: null, customer_name: null, quote_type,
  });
  const order = (amount: number, quote_type: string, status = 'scheduled') => ({
    amount, vat_percent: 0, status, created_at: '2026-09-10T08:00:00Z', fortnox_invoiced_at: null,
    partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type,
  });

  async function atOctoberSeventh() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      mockGetUser.mockResolvedValue(salesUser as any);
      const res = await GET(req());
      return { status: res.status, json: await res.json() };
    } finally {
      vi.useRealTimers();
    }
  }

  it('räknar per kundtyp och typisk order på PERIODENS rader, utan avbrutna order', async () => {
    mockReportData.mockResolvedValueOnce({
      quotes: [quote('won', '2026-09-03', 'private'), quote('sent', '2026-09-04', 'private'), quote('won', '2026-09-05')],
      orders: [order(10_000, 'business'), order(30_000, 'business'), order(99_000, 'business', 'cancelled'), order(8_000, 'private')],
      invoiceRounds: [],
      calls: [],
      sellers: [],
    } as any);
    const { json } = await atOctoberSeventh();
    expect(json.data.sales.hitRateByCustomerType).toMatchObject({
      preliminary: true,
      private: { quotes: 2, won: 1, percent: 50 },
      business: { quotes: 1, won: 1, percent: 100 },
    });
    expect(json.data.sales.typicalOrder.business).toEqual({ count: 2, median: 20_000, mean: 20_000 });
    expect(json.data.sales.typicalOrder.private).toEqual({ count: 1, median: 8_000, mean: 8_000 });
  });

  it('hit rate per offertmånad läser TRENDENS offerter och fönster, inte periodens', async () => {
    mockTrendData.mockResolvedValueOnce({
      quotes: [quote('won', '2026-07-10'), quote('sent', '2026-07-11'), quote('won', '2026-09-20')],
      orders: [],
      invoiceRounds: [],
    } as any);
    const { json } = await atOctoberSeventh();
    const months = json.data.sales.hitRateByMonth;
    expect(months.map((m: any) => m.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(months.find((m: any) => m.period === '2026-07')).toMatchObject({ quotes: 2, won: 1, percent: 50, preliminary: false });
    expect(months.find((m: any) => m.period === '2026-09')).toMatchObject({ quotes: 1, won: 1, preliminary: true, inPeriod: true });
  });

  it('en trasig trendläsning tar bara bort hit rate per månad', async () => {
    mockTrendData.mockRejectedValueOnce(new Error('nekad'));
    const { status, json } = await atOctoberSeventh();
    expect(status).toBe(200);
    expect(json.data.sales.hitRateByMonth).toBeNull();
    expect(json.data.sales.hitRateByCustomerType).toBeDefined();
    expect(json.data.sales.typicalOrder).toBeDefined();
  });

  it('tratten är borta ur svaret', async () => {
    const { json } = await body(salesUser);
    expect(json.data).not.toHaveProperty('funnel');
  });
});

describe('GET /api/crm/reports — Omsättningens nyckeltal', () => {
  const order = (over: Record<string, unknown>) => ({
    amount: 10_000, vat_percent: 0, status: 'scheduled', created_at: '2026-09-10T08:00:00Z', fortnox_invoiced_at: null,
    partial_invoicing_started_at: null, assigned_to: null, client_name: 'Kund 1', quote_type: 'business',
    customer_id: 'k1', rot_enabled: null, customer: { sni_code: '41200' }, ...over,
  });

  it('räknar fakturerat per kundtyp, segment, kunder och orderstock per läge', async () => {
    mockReportData.mockResolvedValueOnce({
      quotes: [],
      orders: [
        order({}),
        order({ customer_id: 'k2', client_name: 'Kund 2', customer: { sni_code: '68204' } }),
        order({ status: 'invoiced', quote_type: 'private', customer_id: null, client_name: 'Anna', customer: null, rot_enabled: true, created_at: '2026-09-01T08:00:00Z', fortnox_invoiced_at: '2026-09-08T08:00:00Z' }),
        // Avbruten: varken ordervärde, segment eller kund.
        order({ status: 'cancelled', amount: 99_000, customer_id: 'k9', client_name: 'Kund 9' }),
      ],
      invoiceRounds: [],
      calls: [],
      sellers: [],
    } as any);
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    const revenue = json.data.revenue;
    expect(revenue.invoiced).toMatchObject({ total: 10_000, private: 10_000, privateShare: 100 });
    expect(revenue.bookToBill).toBe(3);
    expect(revenue.leadTime).toMatchObject({ count: 1, median: 7 });
    expect(revenue.rot).toMatchObject({ privateOrders: 1, withRot: 1, share: 100 });
    expect(revenue.segments.find((s: any) => s.segment === 'construction')).toMatchObject({ orderValue: 10_000, customers: 1 });
    expect(revenue.segments.find((s: any) => s.segment === 'real_estate')).toMatchObject({ orderValue: 10_000 });
    // k1 har två order sedan start (loaderns mock), k2 en och Anna ingen i räkningen.
    expect(revenue.customers).toMatchObject({ customers: 3, recurring: 1 });
    // Orderstockens mock: en planerad på 20 000 och en klar på 10 000.
    expect(revenue.stockByStage.map((s: any) => [s.key, s.value])).toEqual([
      ['draft', 0], ['scheduled', 20_000], ['in_progress', 0], ['partially_invoiced', 0], ['completed', 10_000],
    ]);
  });

  it('book-to-bill för föregående period räknas på föregående periods rader', async () => {
    mockReportData
      .mockResolvedValueOnce({ quotes: [], orders: [order({ status: 'invoiced', created_at: '2026-09-01T08:00:00Z', fortnox_invoiced_at: '2026-09-08T08:00:00Z' })], invoiceRounds: [], calls: [], sellers: [] } as any)
      .mockResolvedValueOnce({
        quotes: [],
        orders: [
          order({ status: 'invoiced', created_at: '2026-08-05T08:00:00Z', fortnox_invoiced_at: '2026-08-10T08:00:00Z' }),
          order({ created_at: '2026-08-06T08:00:00Z' }),
        ],
        invoiceRounds: [],
        calls: [],
        sellers: [],
      } as any);
    const { json } = await body(salesUser);
    expect(json.data.revenue.bookToBill).toBe(1);
    expect(json.data.revenue.bookToBillPrevious).toBe(2);
  });

  it('en trasig läsning av kundernas order tar bara bort "återkommande"', async () => {
    mockCustomerOrders.mockRejectedValueOnce(new Error('nekad'));
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    expect(json.data.revenue.customers.recurring).toBeNull();
    expect(json.data.revenue.stockByStage).not.toBeNull();
    expect(json.data.overview.orderStock).not.toBeNull();
  });

  it('en trasig trendläsning tar bara bort fakturerat per månad', async () => {
    mockTrendData.mockRejectedValueOnce(new Error('nekad'));
    const { json } = await body(salesUser);
    expect(json.data.revenue.invoicedByMonth).toBeNull();
    expect(json.data.revenue.segments).toHaveLength(7);
  });

  it('fakturerat per månad läser trendens fönster, inte periodens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      mockTrendData.mockResolvedValueOnce({
        quotes: [],
        orders: [order({ status: 'invoiced', quote_type: 'private', fortnox_invoiced_at: '2026-07-15T08:00:00Z', created_at: '2026-07-01T08:00:00Z' })],
        invoiceRounds: [],
      } as any);
      const { json } = await body(salesUser);
      const months = json.data.revenue.invoicedByMonth;
      expect(months.map((m: any) => m.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
      expect(months.find((m: any) => m.period === '2026-07')).toMatchObject({ private: 10_000, business: 0, inPeriod: false });
      expect(months.find((m: any) => m.period === '2026-09').inPeriod).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /api/crm/reports — Produkt & marknad', () => {
  const order = (id: string, over: Record<string, unknown> = {}) => ({
    id, amount: 10_000, vat_percent: 0, status: 'scheduled', created_at: '2026-09-10T08:00:00Z', fortnox_invoiced_at: null,
    partial_invoicing_started_at: null, assigned_to: null, client_name: 'Kund 1', quote_type: 'business',
    customer_id: 'k1', rot_enabled: null, customer: null, ...over,
  });
  const m3Row = (m2: number, price: number, construction = 'vind') => ({
    pricing_mode: 'm3', m2: String(m2), thickness_mm: '100', unit_price: String(price), article_name: 'Ekovilla lösull', construction,
  });

  async function atOctoberSeventh() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    try {
      mockGetUser.mockResolvedValue(salesUser as any);
      const res = await GET(req());
      return { status: res.status, json: await res.json() };
    } finally {
      vi.useRealTimers();
    }
  }

  it('räknar m³ på periodens skapade order och m³ per månad på trendens, med en läsning av raderna', async () => {
    mockReportData.mockResolvedValueOnce({
      quotes: [],
      orders: [
        order('sep1'),
        order('sep2', { created_at: '2026-09-20T08:00:00Z' }),
        order('avbruten', { status: 'cancelled' }),
        // Fakturerad i september men skapad i augusti: fakturerat, inte sålt i perioden.
        order('aug', { status: 'invoiced', created_at: '2026-08-20T08:00:00Z', fortnox_invoiced_at: '2026-09-05T08:00:00Z' }),
      ],
      invoiceRounds: [],
      calls: [],
      sellers: [],
    } as any);
    mockTrendData.mockResolvedValueOnce({
      quotes: [],
      orders: [order('jul', { created_at: '2026-07-10T08:00:00Z' }), order('sep1')],
      invoiceRounds: [],
    } as any);
    mockLineItems.mockResolvedValueOnce(new Map<string, unknown>([
      ['sep1', [m3Row(100, 400)]],
      ['sep2', [m3Row(200, 600, 'vagg')]],
      ['avbruten', [m3Row(999, 999)]],
      ['jul', [m3Row(50, 500)]],
      // Skapad i augusti: hade den kommit med i periodens m³ hade rutten räknat på fel order.
      ['aug', [m3Row(500, 500)]],
    ]));
    const { status, json } = await atOctoberSeventh();
    expect(status).toBe(200);
    // Läsningen tog periodens OCH trendens skapade order, en gång var — inte de avbrutna.
    expect(mockLineItems).toHaveBeenCalledTimes(1);
    expect([...(mockLineItems.mock.calls[0][1] as string[])].sort()).toEqual(['jul', 'sep1', 'sep2']);
    const product = json.data.product;
    expect(product.volume.total).toEqual({ m3: 30, value: 16_000, pricePerM3: 16_000 / 30, orders: 2 });
    expect(product.volume.byConstruction.map((c: any) => c.construction)).toEqual(['vagg', 'vind']);
    expect(product.volumeByMonth.map((m: any) => [m.period, m.m3])).toEqual([
      ['2026-06', 0], ['2026-07', 5], ['2026-08', 0], ['2026-09', 10], ['2026-10', 0],
    ]);
  });

  it('fakturerat per depå går ihop med Fakturerat, och schemat läses för fakturornas och stockens order', async () => {
    mockReportData.mockResolvedValueOnce({
      quotes: [],
      orders: [order('o1', { status: 'invoiced', fortnox_invoiced_at: '2026-09-12T08:00:00Z' })],
      invoiceRounds: [
        { amount: 4_000, created_at: '2026-09-20T08:00:00Z', work_order_id: 'o2', work_order: { status: 'partially_invoiced', assigned_to: null, client_name: 'K', quote_type: 'business' } },
      ],
      calls: [],
      sellers: [],
    } as any);
    mockOrderStock.mockResolvedValueOnce([
      { id: 's1', status: 'scheduled', amount: 20_000, vat_percent: 0, invoice_rounds: [] },
    ] as any);
    mockSegments.mockResolvedValueOnce([
      { work_order_id: 'o1', start_day: '2026-09-07', end_day: '2026-09-08', truck: { depot_id: 'sv' } },
      { work_order_id: 's1', start_day: '2026-10-20', end_day: '2026-10-20', truck: { depot_id: null } },
    ]);
    const { json } = await body(salesUser);
    expect([...(mockSegments.mock.calls[0][1] as string[])].sort()).toEqual(['o1', 'o2', 's1']);
    const rows = json.data.product.depots;
    expect(rows.map((r: any) => [r.kind, r.name, r.invoiced, r.stock])).toEqual([
      ['depot', 'Sandviken', 10_000, 0],
      ['no_depot', null, 0, 20_000],
      ['unplanned', null, 4_000, 0],
    ]);
    const invoiced = json.data.periodSummary.metrics.find((m: any) => m.key === 'invoicedValue').actual;
    expect(rows.reduce((t: number, r: any) => t + r.invoiced, 0)).toBe(invoiced);
  });

  it('trasiga orderrader tar bara m³-delarna — null, aldrig "0 m³"', async () => {
    mockLineItems.mockRejectedValueOnce(new Error('nekad'));
    const { status, json } = await body(salesUser);
    expect(status).toBe(200);
    expect(json.data.product.volume).toBeNull();
    expect(json.data.product.volumeByMonth).toBeNull();
    expect(json.data.product.depots).not.toBeNull();
    expect(json.data.revenue).not.toBeNull();
  });

  it('ett trasigt schema eller depåregister tar bara depådelen', async () => {
    mockSegments.mockRejectedValueOnce(new Error('nekad'));
    let { json } = await body(salesUser);
    expect(json.data.product.depots).toBeNull();
    expect(json.data.product.volume).not.toBeNull();
    mockDepots.mockRejectedValueOnce(new Error('nekad'));
    ({ json } = await body(salesUser));
    expect(json.data.product.depots).toBeNull();
  });

  it('en trasig orderstock tar bara depåernas orderstock, inte deras fakturerat', async () => {
    mockOrderStock.mockRejectedValueOnce(new Error('nekad'));
    const { json } = await body(salesUser);
    const rows = json.data.product.depots;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.stock === null)).toBe(true);
  });

  it('en trasig trendläsning tar bara m³ per månad', async () => {
    mockTrendData.mockRejectedValueOnce(new Error('nekad'));
    const { json } = await atOctoberSeventh();
    expect(json.data.product.volumeByMonth).toBeNull();
    expect(json.data.product.volume).not.toBeNull();
  });
});
