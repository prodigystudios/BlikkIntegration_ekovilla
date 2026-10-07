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
import { fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { fetchInvoicedValue } from '@/lib/domains/crm/reports';
import { GET } from '@/app/api/crm/reports/route';
import { reportRange } from '@/app/crm/rapportering/reportRanges';

const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockTimeLoader = vi.mocked(fetchTimeReportData);
const mockOrderStock = vi.mocked(fetchOrderStockRows);
const mockInvoicedValue = vi.mocked(fetchInvoicedValue);

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
    // En period långt bakåt, så att den aldrig kan sammanfalla med förra månaden — med standard-
    // anropets september hade testet varit grönt i oktober 2026 även om rutten mätt mot perioden.
    mockGetUser.mockResolvedValue(salesUser as any);
    const res = await GET(new Request('http://localhost/api/crm/reports?from=2025-01-01&to=2025-01-31'));
    const json = await res.json();
    const basis = json.data.overview.orderStock.basis;
    expect(mockInvoicedValue).toHaveBeenCalledWith(expect.anything(), basis.range);
    // Förra hela månaden i svensk tid — samma snabbval som rapportsidans "Förra månaden". Den
    // valda perioden i anropet är september; den syns inte här.
    expect(basis.range).toEqual(reportRange('prevMonth'));
    expect(basis.invoiced).toBe(70_000);
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
