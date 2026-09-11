import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';
import { stockholmTodayISO, addDaysISO } from '@/lib/domains/planning/timezone';

// Routen bakom "Stäm av saldo". Domänen har egna tester (stockCounts.test.ts); det som prövas HÄR är
// raderna som bär routens beslut och som annars är osynliga för sviten.
//
// 🧨 NYCKELN ÄR depot.manage, INTE schedule.write som leveransregistreringen intill. En för högt räknad
// siffra TYSTAR bristbanderollen, och en räkning kan dölja svinn. Frestelsen att "harmonisera" med
// depot-deliveries/route.ts — som mycket riktigt tar schedule.write — är konkret, och sales håller
// schedule.write. Sänks nyckeln kan varje säljare släcka en brist genom att skriva in ett högt tal.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/planning/stockCounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/stockCounts')>();
  return { ...actual, createStockCount: vi.fn() };
});

// Klienterna MÄRKS, så en elevering till service-role syns.
const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({ __client: 'session' })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { createStockCount } from '@/lib/domains/planning/stockCounts';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { POST } from '@/app/api/crm/planering/stock-counts/route';

const TODAY = stockholmTodayISO();
const BODY = { depot_id: '11111111-2222-4333-8444-555555555555', material: 'EKOVILLA', counted_sacks: 400, counted_on: TODAY };

function asRole(user: typeof adminUser) {
  (getCurrentUser as any).mockResolvedValue(user);
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole(user.role));
}
const post = (body: unknown = BODY) =>
  POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  (createStockCount as any).mockResolvedValue({ data: { id: 'c1' }, error: null });
});

describe('behörighetsgrinden — depot.manage, inte schedule.write', () => {
  it('nekar sales — håller schedule.write, som leveransregistreringen kräver, men inte depot.manage', async () => {
    asRole(salesUser);
    expect((await post()).status).toBe(403);
    expect(createStockCount).not.toHaveBeenCalled();
  });

  it('nekar konsult', async () => {
    asRole(konsultUser);
    expect((await post()).status).toBe(403);
  });

  it('förutsättning: sales HAR schedule.write — annars vore testet ovan tomt', () => {
    const keys = effectivePermissionsForRole('sales');
    expect(keys.has('planning.schedule.write')).toBe(true);
    expect(keys.has('planning.depot.manage')).toBe(false);
  });

  it('släpper in admin och skriver med SESSIONSKLIENTEN', async () => {
    asRole(adminUser);
    expect((await post()).status).toBe(201);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect((createStockCount as any).mock.calls[0][0]).toEqual({ __client: 'session' });
  });

  it('sätter created_by till den inloggade — RLS kräver created_by = auth.uid()', async () => {
    asRole(adminUser);
    await post();
    expect((createStockCount as any).mock.calls[0][1].actorUserId).toBe(adminUser.id);
  });
});

describe('validering', () => {
  beforeEach(() => asRole(adminUser));

  it('avvisar en räkning i framtiden innan den når databasen', async () => {
    expect((await post({ ...BODY, counted_on: addDaysISO(TODAY, 1) })).status).toBe(400);
    expect(createStockCount).not.toHaveBeenCalled();
  });

  it('godtar noll — en tom depå är ett svar', async () => {
    expect((await post({ ...BODY, counted_sacks: 0 })).status).toBe(201);
    expect((createStockCount as any).mock.calls[0][1].countedSacks).toBe(0);
  });

  it('avvisar ett tomt antal i stället för att spara det som noll', async () => {
    expect((await post({ ...BODY, counted_sacks: '' })).status).toBe(400);
    expect(createStockCount).not.toHaveBeenCalled();
  });
});

describe('databasfel översätts', () => {
  beforeEach(() => asRole(adminUser));

  it('23503 (depån finns inte) blir 404', async () => {
    (createStockCount as any).mockResolvedValue({ data: null, error: { code: '23503', message: 'fk' } });
    expect((await post()).status).toBe(404);
  });

  // Meddelandet gissar INTE på orsaken — se kommentaren i routen.
  it('42501 (RLS nekade) blir 403 utan att påstå att det var datumet', async () => {
    (createStockCount as any).mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } });
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).not.toMatch(/framtiden/);
  });

  it('ett annat fel blir 500', async () => {
    (createStockCount as any).mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect((await post()).status).toBe(500);
  });
});
