import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { salesUser, adminUser, konsultUser, ekonomiUser, effectivePermissionsForRole } from './helpers/supabase';

// GET /api/crm/reports/export — ägarnas Excel. Samma grind som rapportsidan (crm.access): filen visar
// inget som sidan inte redan visar, och lönebyrån (ekonomi) når den inte.

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
    fetchTrendData: vi.fn(async () => ({
      quotes: [{ amount: 10_000, vat_percent: 0, status: 'won', quote_date: '2026-09-02', assigned_to: 'u1', customer_name: 'Kund', quote_type: 'business' }],
      orders: [],
      invoiceRounds: [],
    })),
    fetchInvoicedValue: vi.fn(async () => 70_000),
  };
});
vi.mock('@/lib/domains/crm/reportKpisLoader', () => ({
  fetchOrderStockRows: vi.fn(async () => [{ status: 'scheduled', amount: 20_000, vat_percent: 0, invoice_rounds: [] }]),
}));
vi.mock('@/lib/domains/crm/orderStockHistoryLoader', () => ({
  fetchStockSnapshots: vi.fn(async () => []),
  fetchFirstSnapshotDay: vi.fn(async () => null),
  fetchReconstructOrders: vi.fn(async () => []),
}));
vi.mock('@/lib/domains/crm/reportOwnerExportLoader', () => ({
  fetchSellerGoals: vi.fn(async () => [{ user_id: 'u9', period_start: '2026-09-01', quote_value_target: 50_000, order_value_target: 40_000, invoiced_value_target: 30_000 }]),
  fetchProfileNames: vi.fn(async () => [{ id: 'u1', full_name: 'Anna Andersson' }, { id: 'u9', full_name: 'Gustav Slutat' }]),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { fetchTrendData } from '@/lib/domains/crm/reports';
import { fetchProfileNames, fetchSellerGoals } from '@/lib/domains/crm/reportOwnerExportLoader';
import { fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { fetchReconstructOrders, fetchStockSnapshots } from '@/lib/domains/crm/orderStockHistoryLoader';
import { GET, fetchCache } from '@/app/api/crm/reports/export/route';

const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockReportData = vi.mocked(fetchTrendData);
const mockNames = vi.mocked(fetchProfileNames);
const mockGoals = vi.mocked(fetchSellerGoals);
const mockStock = vi.mocked(fetchOrderStockRows);

beforeEach(() => {
  vi.clearAllMocks();
  // Bara klockan låses: exceljs och löftena behöver riktiga timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  mockGetUser.mockResolvedValue(adminUser as any);
  mockPermissions.mockImplementation(async () => effectivePermissionsForRole((await mockGetUser())?.role) as any);
});
afterEach(() => { vi.useRealTimers(); });

async function workbookOf(res: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  return workbook;
}

describe('GET /api/crm/reports/export', () => {
  it('utan inloggning: 401', async () => {
    mockGetUser.mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockReportData).not.toHaveBeenCalled();
  });

  it('ekonomi nekas — rollen saknar crm.access med flit, som på rapportsidan', async () => {
    mockGetUser.mockResolvedValue(ekonomiUser as any);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockReportData).not.toHaveBeenCalled();
  });

  it.each([['admin', adminUser], ['säljare', salesUser], ['konsult', konsultUser]])('%s får filen', async (_, user) => {
    mockGetUser.mockResolvedValue(user as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Forsaljningsrapport-2026-10-09.xlsx"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const workbook = await workbookOf(res);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Sammanfattning', 'Per vecka', 'Budget mot utfall']);
  });

  it('läser året hittills, räknat i svensk dag', async () => {
    await GET();
    expect(mockReportData).toHaveBeenCalledWith(expect.anything(), { from: '2026-01-01', to: '2026-10-09' });
    expect(mockGoals).toHaveBeenCalledWith(expect.anything(), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('nyårsnatten: kl. 00.30 svensk tid är det redan det nya året, fast UTC säger 31 december', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
    const res = await GET();
    expect(mockReportData).toHaveBeenCalledWith(expect.anything(), { from: '2027-01-01', to: '2027-01-01' });
    // Och filen heter efter den svenska dagen.
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Forsaljningsrapport-2027-01-01.xlsx"');
  });

  it('namnen läses för alla med siffror eller mål, oavsett roll — den som slutat står med sitt namn', async () => {
    const res = await GET();
    expect(mockNames).toHaveBeenCalledWith(expect.anything(), ['u1', 'u9']);
    const sheet = (await workbookOf(res)).getWorksheet('Sammanfattning')!;
    const names: string[] = [];
    sheet.eachRow((row) => names.push(String(row.getCell(1).value ?? '')));
    expect(names).toContain('Gustav Slutat');
    expect(names).not.toContain('Okänd användare');
  });

  it('namnen kunde inte läsas: filen kommer ändå, siffrorna under Okänd användare', async () => {
    mockNames.mockRejectedValueOnce(new Error('profiles: nere'));
    const res = await GET();
    expect(res.status).toBe(200);
    const sheet = (await workbookOf(res)).getWorksheet('Sammanfattning')!;
    const names: string[] = [];
    sheet.eachRow((row) => names.push(String(row.getCell(1).value ?? '')));
    expect(names).toContain('Okänd användare');
  });

  it('målen kunde inte läsas: filen kommer ändå, och budgetfliken säger varför den är tom', async () => {
    mockGoals.mockRejectedValueOnce(new Error('crm_goals: nere'));
    const res = await GET();
    expect(res.status).toBe(200);
    const workbook = await workbookOf(res);
    expect(workbook.getWorksheet('Budget mot utfall')!.getCell(2, 1).value).toBe('Budgeten kunde inte läsas när filen skapades — bara utfallet visas.');
  });

  it('orderstocken kunde inte läsas: filen kommer ändå och säger det', async () => {
    mockStock.mockRejectedValueOnce(new Error('nere'));
    const res = await GET();
    expect(res.status).toBe(200);
    const sheet = (await workbookOf(res)).getWorksheet('Sammanfattning')!;
    const texts: string[] = [];
    sheet.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')));
    expect(texts).toContain('Orderstocken kunde inte läsas när filen skapades.');
  });

  it('orderstockens historik: efterhandsräkningen läses från 10 augusti till igår när ingen bild finns', async () => {
    await GET();
    expect(vi.mocked(fetchReconstructOrders)).toHaveBeenCalledWith(expect.anything(), { from: '2026-08-10', to: '2026-10-08' });
  });

  it('orderstockens historik kunde inte läsas: filen kommer ändå, och blocket säger det', async () => {
    vi.mocked(fetchStockSnapshots).mockRejectedValueOnce(new Error('nere'));
    const res = await GET();
    expect(res.status).toBe(200);
    const sheet = (await workbookOf(res)).getWorksheet('Per vecka')!;
    const texts: string[] = [];
    sheet.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')));
    expect(texts).toContain('Orderstock vid veckans slut — kunde inte läsas');
  });

  it('försäljningssiffrorna kunde inte läsas: 500, ingen halv fil', async () => {
    mockReportData.mockRejectedValueOnce(new Error('crm_quotes: nere'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('kommer aldrig ur en cache', () => {
    expect(fetchCache).toBe('force-no-store');
  });
});
