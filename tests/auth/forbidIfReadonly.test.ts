import { describe, it, expect, vi, beforeEach } from 'vitest';

// Skrivspärren för externa parter på planeringens service-role-rutter och orderuppslaget. Kräver
// app.staff (intern personal) sedan 2026-09-26 — förr en rollista (isReadonlyRole) som failade ÖPPET.
//
// forbidIfReadonly anropar getCurrentUser INOM samma modul, så den mockas inte här: sessionsklienten
// gör det, och getCurrentUser körs äkta. Det är precis den vägen fail-open-felet gick.

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  profile: { role: 'member', full_name: 'Test' } as Record<string, unknown> | null,
  effective: new Set<string>(['app.staff']),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: h.profile, error: null }) };
      return b;
    },
  }),
}));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.effective) };
});

import { forbidIfReadonly } from '@/lib/auth/route';

beforeEach(() => {
  h.user = { id: 'u1' };
  h.profile = { role: 'member', full_name: 'Test' };
  h.effective = new Set(['app.staff']);
});

describe('forbidIfReadonly', () => {
  it('släpper igenom intern personal (app.staff)', async () => {
    expect(await forbidIfReadonly()).toBeNull();
  });

  it('nekar en extern part utan app.staff', async () => {
    h.profile = { role: 'konsult' };
    h.effective = new Set(['crm.access', 'crm.workorder.read']);
    expect((await forbidIfReadonly())?.status).toBe(403);
  });

  // 🧨 FAIL-OPEN-FELET. Misslyckas profilläsningen svarar getCurrentUser() `role || 'member'` — en
  // konsult blev då 'member' och passerade den gamla rollistan. Nyckeln avgör nu, och ett misslyckat
  // nyckeluppslag är en tom mängd: nej.
  it('nekar när profilen inte gick att läsa och nycklarna saknas', async () => {
    h.profile = null;
    h.effective = new Set();
    expect((await forbidIfReadonly())?.status).toBe(403);
  });

  // Det VERKLIGA fallet: profilläsningen fallerar (rollen blir 'member'), men behörighetsuppslaget
  // lyckas och svarar med konsultens nycklar. En grind som föll tillbaka på rollen hade släppt igenom.
  it('nekar en konsult vars profil inte gick att läsa', async () => {
    h.profile = null;
    h.effective = new Set(['crm.access', 'crm.workorder.read', 'fortnox.read']);
    expect((await forbidIfReadonly())?.status).toBe(403);
  });

  it('401 utan inloggning', async () => {
    h.user = null;
    expect((await forbidIfReadonly())?.status).toBe(401);
  });
});
