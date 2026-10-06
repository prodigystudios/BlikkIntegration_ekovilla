import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, effectivePermissionsForRole, makeSupabaseMock } from './helpers/supabase';

// Orderlistans statusfilter (?statuses=) — rutten och räknarna. Valen och deras regler prövas i
// listStatusFilter.test.ts; här prövas att rutten läser parametern rätt och att domänen räknar
// per val.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    listCrmWorkOrdersWithFilters: vi.fn(),
    getCrmWorkOrderStatusCounts: vi.fn(async () => ({
      draft: 1, scheduled: 2, in_progress: 3, completed: 4, partially_invoiced: 5, invoiced: 6, cancelled: 7,
    })),
  };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listCrmWorkOrdersWithFilters } from '@/lib/domains/crm/work-orders';

const { GET } = await import('@/app/api/crm/work-orders/route');
const actualDomain = await vi.importActual<typeof import('@/lib/domains/crm/work-orders')>('@/lib/domains/crm/work-orders');

const mockList = vi.mocked(listCrmWorkOrdersWithFilters);

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(salesUser);
  vi.mocked(getEffectivePermissions).mockImplementation(async () => effectivePermissionsForRole('sales'));
  mockList.mockResolvedValue({ data: [], error: null, count: 0 } as any);
});

describe('GET /api/crm/work-orders — statusfiltret', () => {
  it('Planerad tar med den pensionerade ready', async () => {
    expect((await GET(req('/api/crm/work-orders?statuses=draft,scheduled'))).status).toBe(200);
    expect(mockList.mock.calls[0][1]).toMatchObject({ statusIn: ['draft', 'scheduled', 'ready'] });
  });

  it('en TOM parameter är "inget ikryssat" — inte "inget filter"', async () => {
    // 🧨 `|| undefined` hade gjort den tomma strängen till undefined och visat ALLA ordrar, också
    // de avslutade och avbrutna, när användaren just kryssat ur allt.
    expect((await GET(req('/api/crm/work-orders?statuses='))).status).toBe(200);
    expect(mockList.mock.calls[0][1]).toMatchObject({ statusIn: [] });
  });

  it('utan parameter filtreras det inte på status', async () => {
    await GET(req('/api/crm/work-orders'));
    expect((mockList.mock.calls[0][1] as any).statusIn).toBeUndefined();
  });

  it('ready är en status, inte ett val — 400', async () => {
    expect((await GET(req('/api/crm/work-orders?statuses=ready'))).status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('counts=1 ger räknarna per val', async () => {
    const body = await (await GET(req('/api/crm/work-orders?counts=1'))).json();
    expect(body.data.statusCounts).toMatchObject({ scheduled: 2, invoiced: 6, cancelled: 7 });
  });
});

describe('getCrmWorkOrderStatusCounts', () => {
  it('räknar varje val med head-frågor i samma sök- och ansvarig-skop', async () => {
    const supabase = makeSupabaseMock({ data: null, error: null, count: 4 } as any);
    const counts = await actualDomain.getCrmWorkOrderStatusCounts(supabase as any, { search: 'tak', assignedToIn: ['anna'] });

    expect(counts).toEqual({ draft: 4, scheduled: 4, in_progress: 4, completed: 4, partially_invoiced: 4, invoiced: 4, cancelled: 4 });
    expect((supabase._query.select as any).mock.calls[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect((supabase._query.or as any).mock.calls.length).toBe(7);
    expect((supabase._query.in as any).mock.calls).toContainEqual(['assigned_to', ['anna']]);
    // Planerad räknar också ready — annars hade räknaren och listan beskrivit olika mängder.
    expect((supabase._query.in as any).mock.calls).toContainEqual(['status', ['scheduled', 'ready']]);
  });
});
