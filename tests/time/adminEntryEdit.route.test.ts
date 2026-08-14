import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// PATCH/DELETE /api/admin/time/entries/[id] — adminrättelse av EN ANNAN PERSONS tidrad.
//
// Den här ytan skriver i någon annans löneunderlag, så gränserna prövas hårdare än vanligt: vem som
// kommer in, att ägaren aldrig kan komma från anropet, att servern räknar om minuterna, och att ett
// periodlås blir 409 med en förklaring i stället för "hittades inte".

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// buildTimeEntryRow körs på riktigt — det är den regel routen finns för att tillämpa.
vi.mock('@/lib/domains/time/entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/entries')>();
  return { ...actual, getTimeEntryForCorrection: vi.fn(), adminUpdateTimeEntry: vi.fn(), adminDeleteTimeEntry: vi.fn() };
});

vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, explainWriteMiss: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getTimeEntryForCorrection, adminUpdateTimeEntry, adminDeleteTimeEntry } from '@/lib/domains/time/entries';
import { explainWriteMiss } from '@/lib/domains/time/approvals';

const { PATCH, DELETE } = await import('@/app/api/admin/time/entries/[id]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockOwner = vi.mocked(getTimeEntryForCorrection);
const mockUpdate = vi.mocked(adminUpdateTimeEntry);
const mockDelete = vi.mocked(adminDeleteTimeEntry);
const mockExplain = vi.mocked(explainWriteMiss);

const ENTRY_ID = '77777777-7777-4777-8777-777777777777';
const OWNER_ID = '88888888-8888-4888-8888-888888888888';
const WORK_ORDER_ID = '99999999-9999-4999-8999-999999999999';

const ctx = { params: { id: ENTRY_ID } };

// Byråns exempel: 08–18 med en timmes rast är nio timmar, inte tio.
const SHIFT = {
  kind: 'work_order',
  work_date: '2026-08-14',
  work_order_id: WORK_ORDER_ID,
  start_time: '08:00',
  end_time: '18:00',
  break_minutes: 60,
};

function jsonReq(payload: unknown) {
  return new Request(`http://localhost/api/admin/time/entries/${ENTRY_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function plainReq() {
  return new Request(`http://localhost/api/admin/time/entries/${ENTRY_ID}`, { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockUser.mockResolvedValue(adminUser);
  mockOwner.mockResolvedValue({
    data: {
      id: ENTRY_ID, user_id: OWNER_ID, kind: 'work_order', work_date: '2026-08-14',
      work_order_id: WORK_ORDER_ID, internal_project_id: null, absence_type_id: null,
      start_time: '07:00:00', end_time: '16:00:00', break_minutes: 30, minutes_worked: 510,
      time_code_id: null, note: null,
    },
    error: null,
  } as any);
  mockUpdate.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockDelete.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockExplain.mockResolvedValue({ locked: false });
});

describe('adminrättelse — åtkomst', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await PATCH(jsonReq(SHIFT), ctx))!.status).toBe(401);
    expect((await DELETE(plainReq(), ctx))!.status).toBe(401);
  });

  // Egen nyckel och inte time.approve: att attestera är att godkänna det någon annan skrivit, att
  // rätta är att skriva i deras ställe. Ingen utom admin har den i seeden.
  it('kräver time.entry.write.all — member, sales och konsult nekas', async () => {
    for (const user of [memberUser, salesUser, konsultUser]) {
      mockUser.mockResolvedValue(user);
      expect((await PATCH(jsonReq(SHIFT), ctx))!.status).toBe(403);
      expect((await DELETE(plainReq(), ctx))!.status).toBe(403);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('avvisar ett id som inte är ett uuid', async () => {
    const bad = { params: { id: 'inte-ett-uuid' } };
    expect((await PATCH(jsonReq(SHIFT), bad))!.status).toBe(400);
    expect(mockOwner).not.toHaveBeenCalled();
  });
});

describe('adminrättelse — ägaren', () => {
  // Det farligaste misstaget den här routen kan göra: låta anroparen bestämma vems löneunderlag
  // raden hamnar i. Ägaren läses ur databasen, och user_id i kroppen ignoreras.
  it('läser ägaren ur databasen och bygger raden på DEN, inte på anropets user_id', async () => {
    await PATCH(jsonReq({ ...SHIFT, user_id: 'någon-annan' }), ctx);
    const row = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(row.user_id).toBe(OWNER_ID);
  });

  it('svarar 404 när raden inte finns', async () => {
    mockOwner.mockResolvedValue({ data: null, error: null } as any);
    expect((await PATCH(jsonReq(SHIFT), ctx))!.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('adminrättelse — regeln', () => {
  it('räknar om minuterna på servern och lämnar hours till triggern', async () => {
    await PATCH(jsonReq(SHIFT), ctx);
    const row = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(row.minutes_worked).toBe(540);
    expect(row).not.toHaveProperty('hours');
  });

  it('avvisar en rad utan klockslag — kravet gäller även en rättelse', async () => {
    const res = (await PATCH(jsonReq({ ...SHIFT, start_time: null, end_time: null }), ctx))!;
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('adminrättelse — periodlåset', () => {
  // Attesterad tid ändras inte, inte ens av en admin: låstriggern prövar RADENS ÄGARE. Svaret ska
  // säga varför och vad man gör åt det, inte "hittades inte" om en rad som syns i listan.
  it('översätter triggerns P0001 till 409', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'augusti 2026 är attesterad' } } as any);
    const res = (await PATCH(jsonReq(SHIFT), ctx))!;
    expect(res.status).toBe(409);
  });

  it('förklarar noll träffar med periodens status i stället för 404', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är attesterad och kan inte ändras.' });
    const res = (await PATCH(jsonReq(SHIFT), ctx))!;
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('attesterad');
  });

  it('frågar om ÄGARENS period, inte adminens', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    await PATCH(jsonReq(SHIFT), ctx);
    expect(mockExplain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: OWNER_ID }));
  });

  it('gäller lika hårt vid radering', async () => {
    mockDelete.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är inlämnad.' });
    expect((await DELETE(plainReq(), ctx))!.status).toBe(409);
  });
});

describe('adminrättelse — radering', () => {
  it('läser ägaren FÖRE raderingen — efteråt finns ingen rad att förklara med', async () => {
    await DELETE(plainReq(), ctx);
    expect(mockOwner).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), ENTRY_ID);
  });

  it('svarar 200 med radens id när den togs bort', async () => {
    const res = (await DELETE(plainReq(), ctx))!;
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(ENTRY_ID);
  });
});
