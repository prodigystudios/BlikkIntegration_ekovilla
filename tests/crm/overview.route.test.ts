import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, memberUser, effectivePermissionsForRole } from './helpers/supabase';

// Mockar före modulimporter.
vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/domains/crm/overviewSummary', () => ({ fetchCrmOverviewSummary: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { fetchCrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import { GET } from '@/app/api/crm/overview/route';

const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockFetch = vi.mocked(fetchCrmOverviewSummary);

const WINDOW = 'today=2026-08-17&since=2026-08-10&week_start=2026-08-17&week_end=2026-08-24';

function req(query: string) {
  return new Request(`http://localhost/api/crm/overview?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue(salesUser as any);
  // Samma koppling som de andra rutt-testerna: rollen läses ur getCurrentUser-mocken, inte ur
  // argumentet (guarden skickar in ett användar-id).
  mockPermissions.mockImplementation(async () => effectivePermissionsForRole((await mockGetUser())?.role) as any);
  mockFetch.mockResolvedValue({ truncated: [] } as any);
});

describe('GET /api/crm/overview — auth', () => {
  it('nekar utan session', async () => {
    mockGetUser.mockResolvedValue(null as any);
    expect((await GET(req(WINDOW))).status).toBe(401);
  });

  it('nekar member', async () => {
    mockGetUser.mockResolvedValue(memberUser as any);
    expect((await GET(req(WINDOW))).status).toBe(403);
  });

  it('tillåter sales', async () => {
    expect((await GET(req(WINDOW))).status).toBe(200);
  });
});

describe('GET /api/crm/overview — fönstret', () => {
  it('kräver alla fyra datumen', async () => {
    expect((await GET(req('today=2026-08-17'))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('avvisar datum som inte är datum', async () => {
    expect((await GET(req(`today=igår&since=2026-08-10&week_start=2026-08-17&week_end=2026-08-24`))).status).toBe(400);
  });

  it('avvisar en start som ligger efter idag', async () => {
    expect((await GET(req('today=2026-08-17&since=2026-08-20&week_start=2026-08-17&week_end=2026-08-24'))).status).toBe(400);
  });

  it('avvisar en vecka som slutar före den börjar', async () => {
    expect((await GET(req('today=2026-08-17&since=2026-08-10&week_start=2026-08-24&week_end=2026-08-17'))).status).toBe(400);
  });

  // Fönstret kommer från klienten, så det behöver ett TAK och inte bara en riktning: since=1970-01-01
  // hade förvandlat tre avgränsade läsningar till fulltabellsskanningar på begäran, för vilken
  // inloggad CRM-användare som helst (konsult inräknad). Sidan ber aldrig om mer än åtta dagar.
  it('avvisar ett fönster som är bredare än en månad', async () => {
    const res = await GET(req('today=2026-08-17&since=1970-01-01&week_start=2026-08-17&week_end=2026-08-24'));
    expect(res.status).toBe(400);
    expect((await res.json()).errorDetails.code).toBe('invalid_window');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('släpper igenom sidans eget fönster och skickar det vidare oförändrat', async () => {
    await GET(req(WINDOW));
    expect(mockFetch).toHaveBeenCalledWith(expect.anything(), {
      today: '2026-08-17', since: '2026-08-10', weekStart: '2026-08-17', weekEnd: '2026-08-24',
    });
  });

  it('svarar 500 med kod när räkningen fallerar', async () => {
    mockFetch.mockRejectedValue(new Error('quote_stocks: db error'));
    const res = await GET(req(WINDOW));
    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_overview_summary_failed');
  });
});
