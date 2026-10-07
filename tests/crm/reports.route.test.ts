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
import { fetchFirstActivityDay, fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { fetchInvoicedValue, fetchTrendData } from '@/lib/domains/crm/reports';
import { GET } from '@/app/api/crm/reports/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockTimeLoader = vi.mocked(fetchTimeReportData);
const mockOrderStock = vi.mocked(fetchOrderStockRows);
const mockInvoicedValue = vi.mocked(fetchInvoicedValue);
const mockTrendData = vi.mocked(fetchTrendData);
const mockFirstActivity = vi.mocked(fetchFirstActivityDay);

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
    expect(mockTrendData).toHaveBeenCalledWith(expect.anything(), { from: '2026-06-29', to: '2026-10-07' });
    expect(json.data.trend.points.map((p: any) => p.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(json.data.trend.points.filter((p: any) => p.inPeriod).map((p: any) => p.period)).toEqual(['2026-09']);
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

describe('GET /api/crm/reports — målet för fakturerat', () => {
  // En klient som beter sig som PostgREST: den lämnar BARA ut de kolumner frågan ber om. Tappar
  // ruttens målfråga invoiced_value_target får fakturerat inget mål — tyst, utan fel.
  function goalsAdmin(rows: Array<Record<string, unknown>>) {
    return {
      from(table: string) {
        let columns: string[] = [];
        const chain: Record<string, unknown> = {};
        chain.select = (cols: string) => { columns = cols.split(',').map((c) => c.trim()); return chain; };
        chain.eq = () => chain;
        chain.in = () => chain;
        chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(
          table === 'crm_goals'
            ? { data: rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))), error: null }
            : { data: null, error: { message: `oväntad tabell ${table}` } },
        ).then(ok);
        return chain;
      },
    };
  }

  it('läser invoiced_value_target och ger fakturerat en målstapel', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValueOnce(goalsAdmin([
      { period_start: '2026-09-01', calls_target: 10, quotes_target: 10, quote_value_target: 100, order_count_target: 1, order_value_target: 100, invoiced_value_target: 900_000 },
    ]) as any);
    const { json } = await body(salesUser);
    const invoiced = json.data.periodSummary.metrics.find((m: any) => m.key === 'invoicedValue');
    expect(invoiced.target).toBe(900_000);
  });
});
