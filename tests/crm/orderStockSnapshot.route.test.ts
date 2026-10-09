import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Orderstockens ögonblicksbild: körs varje timme av Vercels cron med `Authorization: Bearer <CRON_SECRET>`.
// Ingen session — grinden är hemligheten, och routen är vitlistad i middleware.ts.

vi.mock('@/lib/supabase/server', () => ({ getOptionalSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@/lib/domains/crm/reportKpisLoader', () => ({
  fetchOrderStockRows: vi.fn(async () => [
    { status: 'draft', amount: 4_000, vat_percent: 0, invoice_rounds: [] },
    { status: 'partially_invoiced', amount: 10_000, vat_percent: 0, invoice_rounds: [{ amount: 3_000 }] },
  ]),
}));
vi.mock('@/lib/domains/crm/orderStockHistoryLoader', () => ({ upsertStockSnapshot: vi.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { GET, POST, fetchCache } from '@/app/api/crm/reports/order-stock-snapshot/route';
import { upsertStockSnapshot } from '@/lib/domains/crm/orderStockHistoryLoader';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const mockUpsert = vi.mocked(upsertStockSnapshot);
const req = (auth?: string) => new NextRequest('http://localhost/api/crm/reports/order-stock-snapshot', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'hemligt');
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('/api/crm/reports/order-stock-snapshot', () => {
  it('utan eller med fel hemlighet: 401, och inget skrivs', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer fel'))).status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('utan CRON_SECRET i miljön är routen avstängd (503) — inte ens en tom bearer släpps in', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(req('Bearer '))).status).toBe(503);
    expect((await GET(req())).status).toBe(503);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skriver dagens rad, på den SVENSKA dagen', async () => {
    // 23.55 svensk tid den 9 oktober = 21.55 UTC; kl. 00.30 den 10:e = 22.30 UTC den 9:e.
    vi.setSystemTime(new Date('2026-10-09T21:55:00Z'));
    const res = await GET(req('Bearer hemligt'));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const snapshot = mockUpsert.mock.calls[0][1];
    expect(snapshot).toMatchObject({ day: '2026-10-09', totalCount: 2, totalValue: 11_000 });

    vi.setSystemTime(new Date('2026-10-09T22:30:00Z'));
    await POST(req('Bearer hemligt'));
    expect(mockUpsert.mock.calls[1][1].day).toBe('2026-10-10');
  });

  it('ett skrivfel blir 500 — jobbet ska synas som misslyckat', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('nere'));
    expect((await GET(req('Bearer hemligt'))).status).toBe(500);
  });

  it('utan service-roll: 500', async () => {
    vi.mocked(getOptionalSupabaseAdmin).mockReturnValueOnce(null as any);
    expect((await GET(req('Bearer hemligt'))).status).toBe(500);
  });

  it('kommer aldrig ur en cache', () => {
    expect(fetchCache).toBe('force-no-store');
  });
});
