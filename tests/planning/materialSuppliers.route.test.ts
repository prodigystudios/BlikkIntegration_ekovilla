import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Routerna bakom leverantörsregistret. Domänen och schemana har egna tester
// (materialSuppliers.test.ts); det som prövas HÄR är de rader som bär grenens två beslut, och som
// annars är osynliga för sviten.
//
// 🧨 BESLUT 1 — NYCKELN. Registret läses med planning.depot.manage, INTE planning.schedule.read.
// Raden bär fabrikens mailadress och kontaktperson, och `konsult` håller schedule.read
// (20260611_planning_permissions.sql:30). Frestelsen att "harmonisera" med depots/route.ts intill —
// som mycket riktigt läser på board-nivå — är konkret: etapp 4 behöver en mottagarväljare på tavlan,
// där bara schedule.read finns. Sänks nyckeln svarar routen 200 med tom lista (RLS håller emot),
// och nästa steg är att nå efter getSupabaseAdmin() för att "fixa" det. Då är routegrinden enda
// kvarvarande skydd — och det är den här filen som märker att den försvann.
//
// 🧨 BESLUT 2 — 404 PÅ NOLL RADER. PostgREST svarar `{ data: null, error: null }` när en UPDATE
// eller DELETE inte träffade någon rad. Routen skiljer på det; utan vakt hade en PATCH mot en
// leverantör som kollegan just raderat svarat 200, useEntityCrud toastat "Sparad", och etapp 4:s
// beställningsmail gått till den gamla adressen.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/planning/materialSuppliers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/materialSuppliers')>();
  return {
    ...actual,
    listAllSuppliers: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deleteSupplier: vi.fn(),
  };
});

// Klienterna MÄRKS, så testet kan säga vilken som gick vart. Utan märkningen ser en route som
// eleverar läsningen identisk ut för sviten — och service-role kringgår hela RLS-halvan av grinden.
const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({ __client: 'session' })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  listAllSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '@/lib/domains/planning/materialSuppliers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { GET, POST } from '@/app/api/crm/planering/material-suppliers/route';
import { PATCH, DELETE } from '@/app/api/crm/planering/material-suppliers/[id]/route';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

const ID = '11111111-2222-4333-8444-555555555555';
const ROW = {
  id: ID,
  name: 'Ekovilla AB',
  email: 'order@ekovilla.se',
  contact_name: null,
  phone: null,
  materials: [MATERIAL_SHORTS[0]],
  lead_time_days: 5,
  note: null,
  active: true,
};
const BODY = { name: 'Ekovilla AB', email: 'order@ekovilla.se', materials: [MATERIAL_SHORTS[0]] };

function asRole(user: typeof adminUser) {
  (getCurrentUser as any).mockResolvedValue(user);
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole(user.role));
}

const post = (body: unknown = BODY) =>
  POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown = { name: 'Nytt namn' }, id = ID) =>
  PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });
const del = (id = ID) => DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  (listAllSuppliers as any).mockResolvedValue({ data: [ROW], error: null });
  (createSupplier as any).mockResolvedValue({ data: ROW, error: null });
  (updateSupplier as any).mockResolvedValue({ data: ROW, error: null });
  (deleteSupplier as any).mockResolvedValue({ data: { id: ID }, error: null });
});

describe('behörighetsgrinden — planning.depot.manage, aldrig schedule.read', () => {
  // Rollerna är valda för att vara exakt de som HAR schedule.read men INTE depot.manage. Sänks
  // nyckeln till schedule.read blir båda de här testerna röda, vilket är hela poängen.
  for (const user of [konsultUser, salesUser]) {
    it(`nekar ${user.role} — håller schedule.read men inte depot.manage`, async () => {
      asRole(user);
      expect((await GET()).status).toBe(403);
      expect((await post()).status).toBe(403);
      expect((await patch()).status).toBe(403);
      expect((await del()).status).toBe(403);
    });
  }

  it('förutsättning: rollerna ovan har verkligen schedule.read', () => {
    // Utan den här raden kunde 403:orna komma av att rollerna saknar planeringsnycklar över huvud
    // taget — då hade testet ovan varit tomt.
    for (const user of [konsultUser, salesUser]) {
      const keys = effectivePermissionsForRole(user.role);
      expect(keys.has('planning.schedule.read')).toBe(true);
      expect(keys.has('planning.depot.manage')).toBe(false);
    }
  });

  it('släpper in admin', async () => {
    asRole(adminUser);
    expect((await GET()).status).toBe(200);
    expect((await post()).status).toBe(201);
    expect((await patch()).status).toBe(200);
    expect((await del()).status).toBe(200);
  });

  it('nekar en utloggad', async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    (getEffectivePermissions as any).mockResolvedValue(new Set());
    expect((await GET()).status).toBe(401);
  });

  // 🧨 Grinden är tvådelad: routens nyckel OCH RLS. Elevaras läsningen till service-role faller
  // RLS-halvan bort, och routens if-sats blir enda skyddet.
  it('läser med SESSIONSKLIENTEN, aldrig service-role', async () => {
    asRole(adminUser);
    await GET();
    await post();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect((listAllSuppliers as any).mock.calls[0][0]).toEqual({ __client: 'session' });
    expect((createSupplier as any).mock.calls[0][0]).toEqual({ __client: 'session' });
  });
});

describe('PostgREST svarar error: null på noll rader', () => {
  beforeEach(() => asRole(adminUser));

  it('PATCH mot en rad som inte längre finns ger 404, inte 200', async () => {
    (updateSupplier as any).mockResolvedValue({ data: null, error: null });
    const res = await patch();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/finns inte längre/);
  });

  it('DELETE mot en rad som inte längre finns ger 404, inte 200', async () => {
    (deleteSupplier as any).mockResolvedValue({ data: null, error: null });
    expect((await del()).status).toBe(404);
  });
});

describe('dubblettnamnet översätts, inte vidarebefordras', () => {
  beforeEach(() => asRole(adminUser));

  // Unikt index på lower(btrim(name)) where active. Utan grenen hade "duplicate key value violates
  // unique constraint" gått rakt ut till någon som tryckte på en knapp.
  it('23505 från POST blir 409 på svenska', async () => {
    (createSupplier as any).mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/aktiv leverantör med det namnet/);
  });

  // Nås när en AVAKTIVERAD dubblett aktiveras igen — det partiella indexet gäller bara `where active`.
  it('23505 från PATCH blir 409 på svenska', async () => {
    (updateSupplier as any).mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect((await patch({ active: true })).status).toBe(409);
  });

  it('ett annat databasfel blir 500, inte 409', async () => {
    (updateSupplier as any).mockResolvedValue({ data: null, error: { code: '23514', message: 'check violation' } });
    expect((await patch()).status).toBe(500);
  });
});

describe('validering', () => {
  beforeEach(() => asRole(adminUser));

  it('avvisar en okänd materialkod innan den når databasen', async () => {
    expect((await post({ ...BODY, materials: ['KNAUF'] })).status).toBe(400);
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('avvisar ett ogiltigt id utan att röra databasen', async () => {
    expect((await patch({ name: 'X' }, 'inte-ett-uuid')).status).toBe(400);
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('avvisar en tom patch', async () => {
    expect((await patch({})).status).toBe(400);
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  // created_by måste vara anroparen — RLS insert-policyn kräver created_by = auth.uid(), så en
  // route som skickar något annat får sin insert nekad av databasen.
  it('sätter created_by till den inloggade', async () => {
    await post();
    expect((createSupplier as any).mock.calls[0][1].actorUserId).toBe(adminUser.id);
  });
});
