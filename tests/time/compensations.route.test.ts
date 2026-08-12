import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Route-tester för traktamenten, utlägg och milersättning. Samma gränser som tidraderna, av samma
// skäl: det här är löneunderlag och personuppgift.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/time/compensations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/compensations')>();
  return { ...actual, listCompensations: vi.fn(), createCompensation: vi.fn(), updateCompensation: vi.fn(), deleteCompensation: vi.fn() };
});

vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, explainWriteMiss: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listCompensations, createCompensation, updateCompensation, deleteCompensation } from '@/lib/domains/time/compensations';
import { explainWriteMiss } from '@/lib/domains/time/approvals';

const { GET, POST } = await import('@/app/api/time/compensations/route');
const { PATCH, DELETE } = await import('@/app/api/time/compensations/[id]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCompensations);
const mockCreate = vi.mocked(createCompensation);
const mockUpdate = vi.mocked(updateCompensation);
const mockDelete = vi.mocked(deleteCompensation);
const mockExplain = vi.mocked(explainWriteMiss);

const ITEM_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockList.mockResolvedValue({ data: [], error: null } as any);
  mockCreate.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
  mockUpdate.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
  mockDelete.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
  mockExplain.mockResolvedValue({ locked: false });
});

function req(url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, options);
}

function jsonReq(method: 'POST' | 'PATCH', payload: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

const TRAVEL = { entry_date: '2026-08-14', kind: 'travel', quantity: 12.5, amount: 306.25 };

describe('GET /api/time/compensations', () => {
  it('kräver inloggning och ett giltigt intervall', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req('/api/time/compensations?from=2026-08-01&to=2026-08-31'))).status).toBe(401);

    mockUser.mockResolvedValue(memberUser);
    expect((await GET(req('/api/time/compensations'))).status).toBe(400);
    expect((await GET(req('/api/time/compensations?from=2026-08-31&to=2026-08-01'))).status).toBe(400);
  });

  it('läser bara den egna listan', async () => {
    mockUser.mockResolvedValue(memberUser);
    await GET(req('/api/time/compensations?from=2026-08-01&to=2026-08-31&userId=annan'));
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { from: '2026-08-01', to: '2026-08-31' }, { userId: memberUser.id });
  });
});

describe('POST /api/time/compensations', () => {
  it('kräver time.entry.write', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', TRAVEL)))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sparar för den inloggade, aldrig för någon annan', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await POST(req('/api/time/compensations', jsonReq('POST', { ...TRAVEL, user_id: adminUser.id })));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), memberUser.id, expect.objectContaining({ kind: 'travel', amount: 306.25 }));
  });

  it('nollar kvantitet på utlägg — beloppet är hela sanningen där', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', { entry_date: '2026-08-14', kind: 'expense', quantity: 3, amount: 89 })));
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ quantity: null });
  });

  it('avvisar negativt belopp, okänd sort och trasigt datum', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...TRAVEL, amount: -1 })))).status).toBe(400);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...TRAVEL, kind: 'fika' })))).status).toBe(400);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...TRAVEL, entry_date: '14/8' })))).status).toBe(400);
  });

  it('gör periodlåset till 409 — ersättningar fryser med månaden', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Perioden är inlämnad eller attesterad och kan inte ändras' } } as any);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', TRAVEL)))).status).toBe(409);
  });
});

describe('PATCH /api/time/compensations/[id]', () => {
  it('kräver time.entry.write och ett uuid', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 100 })), { params: { id: ITEM_ID } })).status).toBe(403);

    mockUser.mockResolvedValue(memberUser);
    expect((await PATCH(req('/api/time/compensations/x', jsonReq('PATCH', { amount: 100 })), { params: { id: 'x' } })).status).toBe(400);
  });

  it('skriver bara de fält klienten faktiskt skickade', async () => {
    // Zod fyller i defaults för utelämnade fält; sparas de nollas kolumner ingen rörde.
    mockUser.mockResolvedValue(memberUser);
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 100 })), { params: { id: ITEM_ID } });
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), ITEM_ID, memberUser.id, { amount: 100 });
  });

  it('avvisar en tom uppdatering', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', {})), { params: { id: ITEM_ID } })).status).toBe(400);
  });

  it('skiljer på låst period och saknad post', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 100 })), { params: { id: ITEM_ID } })).status).toBe(404);

    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är inlämnad.' });
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 100 })), { params: { id: ITEM_ID } })).status).toBe(409);
  });
});

describe('DELETE /api/time/compensations/[id]', () => {
  it('raderar bara sin egen post', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await DELETE(req(`/api/time/compensations/${ITEM_ID}`), { params: { id: ITEM_ID } });
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), ITEM_ID, memberUser.id);
  });

  it('svarar 409 när perioden är låst', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockDelete.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är attesterad.' });
    expect((await DELETE(req(`/api/time/compensations/${ITEM_ID}`), { params: { id: ITEM_ID } })).status).toBe(409);
  });
});
