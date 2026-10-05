import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, memberUser, konsultUser, effectivePermissionsForRole } from './helpers/supabase';

// Två olika klienter, så att testet ser VILKEN som går till räkningen. Det är hela poängen med
// rutten: sessionen ger en säljare bara de egna samtalen, och då stod kollegornas Samtal som 0.
const ADMIN_CLIENT = { kind: 'admin' };
const SESSION_CLIENT = { kind: 'session' };

// Mockar före modulimporter.
vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/domains/crm/weeklyScoreboard', () => ({ fetchWeeklyScoreboard: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => SESSION_CLIENT) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { fetchWeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import * as route from '@/app/api/crm/overview/scoreboard/route';

const { GET } = route;
const mockGetUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getEffectivePermissions);
const mockFetch = vi.mocked(fetchWeeklyScoreboard);

const WINDOW = 'today=2026-10-01&week_start=2026-09-28&week_end=2026-10-05';

function req(query: string) {
  return new Request(`http://localhost/api/crm/overview/scoreboard?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue(salesUser as any);
  mockPermissions.mockImplementation(async () => effectivePermissionsForRole((await mockGetUser())?.role) as any);
  mockFetch.mockResolvedValue({ sellers: [], truncated: [] } as any);
});

describe('GET /api/crm/overview/scoreboard — auth', () => {
  it('nekar utan session', async () => {
    mockGetUser.mockResolvedValue(null as any);
    expect((await GET(req(WINDOW))).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('nekar member', async () => {
    mockGetUser.mockResolvedValue(memberUser as any);
    expect((await GET(req(WINDOW))).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('tillåter sales och konsult — samma grind som rapporteringen', async () => {
    expect((await GET(req(WINDOW))).status).toBe(200);
    mockGetUser.mockResolvedValue(konsultUser as any);
    expect((await GET(req(WINDOW))).status).toBe(200);
  });
});

describe('GET /api/crm/overview/scoreboard — klienten', () => {
  it('räknar med admin-klienten, inte sessionen', async () => {
    await GET(req(WINDOW));
    expect(mockFetch).toHaveBeenCalledWith(ADMIN_CLIENT, { today: '2026-10-01', weekStart: '2026-09-28', weekEnd: '2026-10-05' });
  });

  it('lämnar svaret orört under data.scoreboard', async () => {
    mockFetch.mockResolvedValue({ weekStart: '2026-09-28', sellers: [{ userId: 'u1' }] } as any);
    const body = await (await GET(req(WINDOW))).json();
    expect(body.data.scoreboard).toEqual({ weekStart: '2026-09-28', sellers: [{ userId: 'u1' }] });
  });

  // Next 14 cachar fetch i en GET-route som inte läser kakan — också supabase-js. Raden är en
  // försäkring för den dag grinden flyttar, och testet ser till att den inte försvinner tyst.
  it('stänger av fetch-cachen', () => {
    expect(route.fetchCache).toBe('force-no-store');
  });
});

describe('GET /api/crm/overview/scoreboard — fönstret', () => {
  it('kräver alla tre datumen', async () => {
    expect((await GET(req('today=2026-10-01&week_start=2026-09-28'))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('avvisar datum som inte är datum', async () => {
    expect((await GET(req('today=idag&week_start=2026-09-28&week_end=2026-10-05'))).status).toBe(400);
  });

  // Läsningen går förbi RLS, så fönstret får inte kunna vidgas: då hade vem som helst i CRM:et
  // kunnat begära lagets siffror över godtycklig historik — och fått fulltabellsskanningar.
  it('avvisar ett fönster som inte är exakt en vecka', async () => {
    for (const query of [
      'today=2026-10-01&week_start=2020-01-06&week_end=2026-10-05',
      'today=2026-10-01&week_start=2026-09-29&week_end=2026-10-05',
      'today=2026-10-01&week_start=2026-10-05&week_end=2026-09-28',
    ]) {
      const res = await GET(req(query));
      expect(res.status).toBe(400);
      expect((await res.json()).errorDetails.code).toBe('invalid_window');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('avvisar en dag utanför veckan', async () => {
    expect((await GET(req('today=2026-10-05&week_start=2026-09-28&week_end=2026-10-05'))).status).toBe(400);
    expect((await GET(req('today=2026-09-27&week_start=2026-09-28&week_end=2026-10-05'))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('godtar veckans första och sista dag', async () => {
    expect((await GET(req('today=2026-09-28&week_start=2026-09-28&week_end=2026-10-05'))).status).toBe(200);
    expect((await GET(req('today=2026-10-04&week_start=2026-09-28&week_end=2026-10-05'))).status).toBe(200);
  });

  it('svarar 500 med kod när räkningen fallerar', async () => {
    mockFetch.mockRejectedValue(new Error('call_window: db error'));
    const res = await GET(req(WINDOW));
    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_overview_scoreboard_failed');
  });
});
