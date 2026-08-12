import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, salesUser, konsultUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Route-tester för referensdatan (tidkoder, internprojekt, frånvarotyper).
//
// Den intressanta asymmetrin: LÄSNING kräver bara inloggning — varje anställd måste kunna välja
// frånvarotyp i formuläret, och namnen stod redan i Blikks dropdown för alla. SKRIVNING kräver
// time.reference.manage, som bara admin har: raderna bär lönesorten byrån räknar på.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/time/reference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/reference')>();
  return { ...actual, listTimeReference: vi.fn(), createTimeReference: vi.fn(), updateTimeReference: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listTimeReference, createTimeReference, updateTimeReference } from '@/lib/domains/time/reference';

const { GET } = await import('@/app/api/time/reference/route');
const { POST } = await import('@/app/api/time/reference/[kind]/route');
const { PATCH } = await import('@/app/api/time/reference/[kind]/[id]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listTimeReference);
const mockCreate = vi.mocked(createTimeReference);
const mockUpdate = vi.mocked(updateTimeReference);

const ROW_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockList.mockResolvedValue({ data: [], error: null } as any);
  mockCreate.mockResolvedValue({ data: { id: ROW_ID }, error: null } as any);
  mockUpdate.mockResolvedValue({ data: { id: ROW_ID }, error: null } as any);
});

function req(url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, options);
}

function jsonReq(method: 'POST' | 'PATCH', payload: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

describe('GET /api/time/reference', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req('/api/time/reference'))).status).toBe(401);
  });

  it('räcker med inloggning — alla anställda måste kunna välja frånvarotyp', async () => {
    for (const user of [memberUser, salesUser, konsultUser, adminUser]) {
      mockUser.mockResolvedValue(user);
      expect((await GET(req('/api/time/reference'))).status).toBe(200);
    }
  });

  it('svarar med alla tre listorna i ett anrop', async () => {
    // Formuläret ska kunna byta rapporttyp utan ny rundtur; Blikk-modalen hämtar per flik och
    // blinkar till varje gång.
    mockUser.mockResolvedValue(memberUser);
    const json = await (await GET(req('/api/time/reference'))).json();
    expect(Object.keys(json.data).sort()).toEqual(['absence_type', 'internal_project', 'time_code']);
  });

  it('tar med inaktiva rader bara när de begärs', async () => {
    mockUser.mockResolvedValue(adminUser);
    await GET(req('/api/time/reference'));
    expect(mockList).toHaveBeenCalledWith(expect.anything(), expect.anything(), { includeInactive: false });

    mockList.mockClear();
    await GET(req('/api/time/reference?includeInactive=1'));
    expect(mockList).toHaveBeenCalledWith(expect.anything(), expect.anything(), { includeInactive: true });
  });
});

describe('POST /api/time/reference/[kind]', () => {
  it('kräver time.reference.manage — inte ens sales får lägga till en lönesort', async () => {
    for (const user of [memberUser, salesUser, konsultUser]) {
      mockUser.mockResolvedValue(user);
      const res = await POST(req('/api/time/reference/time_code', jsonReq('POST', { name: 'Övertid' })), { params: { kind: 'time_code' } });
      expect(res.status).toBe(403);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('släpper igenom admin', async () => {
    mockUser.mockResolvedValue(adminUser);
    const res = await POST(req('/api/time/reference/time_code', jsonReq('POST', { name: 'Övertid' })), { params: { kind: 'time_code' } });
    expect(res.status).toBe(201);
  });

  it('avvisar en okänd referenstyp', async () => {
    mockUser.mockResolvedValue(adminUser);
    const res = await POST(req('/api/time/reference/aktivitet', jsonReq('POST', { name: 'X' })), { params: { kind: 'aktivitet' } });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('kräver ett namn', async () => {
    mockUser.mockResolvedValue(adminUser);
    expect((await POST(req('/api/time/reference/time_code', jsonReq('POST', { name: '  ' })), { params: { kind: 'time_code' } })).status).toBe(400);
  });

  it('skickar bara billable till tidkoder', async () => {
    // Kolumnen finns bara där; till en annan tabell blir det ett PostgREST-fel om en okänd kolumn.
    mockUser.mockResolvedValue(adminUser);
    await POST(req('/api/time/reference/absence_type', jsonReq('POST', { name: 'VAB', billable: true })), { params: { kind: 'absence_type' } });
    expect(mockCreate.mock.calls[0][2]).not.toHaveProperty('billable');

    mockCreate.mockClear();
    await POST(req('/api/time/reference/time_code', jsonReq('POST', { name: 'Arbete', billable: true })), { params: { kind: 'time_code' } });
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ billable: true });
  });
});

describe('PATCH /api/time/reference/[kind]/[id]', () => {
  it('kräver time.reference.manage', async () => {
    mockUser.mockResolvedValue(salesUser);
    const res = await PATCH(req(`/api/time/reference/time_code/${ROW_ID}`, jsonReq('PATCH', { payroll_code: '110' })), { params: { kind: 'time_code', id: ROW_ID } });
    expect(res.status).toBe(403);
  });

  it('skriver bara de fält som faktiskt skickades', async () => {
    // Adminvyn sparar ett fält i taget — typiskt bara payroll_code efter Blikk-importen.
    mockUser.mockResolvedValue(adminUser);
    await PATCH(req(`/api/time/reference/time_code/${ROW_ID}`, jsonReq('PATCH', { payroll_code: '110' })), { params: { kind: 'time_code', id: ROW_ID } });
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), 'time_code', ROW_ID, { payroll_code: '110' });
  });

  it('avvisar tom uppdatering, okänd typ och id som inte är uuid', async () => {
    mockUser.mockResolvedValue(adminUser);
    expect((await PATCH(req(`/api/time/reference/time_code/${ROW_ID}`, jsonReq('PATCH', {})), { params: { kind: 'time_code', id: ROW_ID } })).status).toBe(400);
    expect((await PATCH(req(`/api/time/reference/aktivitet/${ROW_ID}`, jsonReq('PATCH', { name: 'X' })), { params: { kind: 'aktivitet', id: ROW_ID } })).status).toBe(400);
    expect((await PATCH(req('/api/time/reference/time_code/x', jsonReq('PATCH', { name: 'X' })), { params: { kind: 'time_code', id: 'x' } })).status).toBe(400);
  });

  it('svarar 404 när raden inte finns', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    const res = await PATCH(req(`/api/time/reference/time_code/${ROW_ID}`, jsonReq('PATCH', { name: 'X' })), { params: { kind: 'time_code', id: ROW_ID } });
    expect(res.status).toBe(404);
  });
});
