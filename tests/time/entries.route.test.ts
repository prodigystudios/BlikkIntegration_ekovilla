import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Route-tester för tidraderna. Skulden från 4.3: domänlogiken hade 54 fall, vakterna noll.
//
// Det som prövas här är gränserna, inte matematiken (den bor i entries.test.ts och hours.test.ts):
// vem som får skriva, att servern räknar minuterna ur klockslagen, och att ett stängt periodlås blir
// ett begripligt svar i stället för "hittades inte".

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// buildTimeEntryRow körs på riktigt — det är den regel routen finns för att tillämpa.
vi.mock('@/lib/domains/time/entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/entries')>();
  return { ...actual, listTimeEntries: vi.fn(), createTimeEntry: vi.fn(), updateTimeEntry: vi.fn(), deleteTimeEntry: vi.fn() };
});

vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, explainWriteMiss: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry } from '@/lib/domains/time/entries';
import { explainWriteMiss } from '@/lib/domains/time/approvals';

const { GET, POST } = await import('@/app/api/time/entries/route');
const { PATCH, DELETE } = await import('@/app/api/time/entries/[id]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listTimeEntries);
const mockCreate = vi.mocked(createTimeEntry);
const mockUpdate = vi.mocked(updateTimeEntry);
const mockDelete = vi.mocked(deleteTimeEntry);
const mockExplain = vi.mocked(explainWriteMiss);

const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const WORK_ORDER_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockList.mockResolvedValue({ data: [], error: null } as any);
  mockCreate.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockUpdate.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockDelete.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockExplain.mockResolvedValue({ locked: false });
});

function req(url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, options);
}

function jsonReq(method: 'POST' | 'PATCH', payload: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

const SHIFT = { kind: 'work_order', work_date: '2026-08-14', work_order_id: WORK_ORDER_ID, start_time: '08:00', end_time: '18:00', break_minutes: 60 };

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/time/entries', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req('/api/time/entries?from=2026-08-01&to=2026-08-31'))).status).toBe(401);
  });

  it('kräver ett giltigt intervall', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await GET(req('/api/time/entries'))).status).toBe(400);
    expect((await GET(req('/api/time/entries?from=2026-08-01'))).status).toBe(400);
    expect((await GET(req('/api/time/entries?from=augusti&to=2026-08-31'))).status).toBe(400);
    expect((await GET(req('/api/time/entries?from=2026-08-31&to=2026-08-01'))).status).toBe(400);
  });

  it('läser ALLTID bara den egna tiden — ?userId= ignoreras', async () => {
    // Blikk-motsvarigheten tar en userId-parameter och använder den UTAN behörighetskontroll, så
    // vem som helst kan läsa vem som helsts tid. Den fällan får inte återuppstå.
    mockUser.mockResolvedValue(memberUser);
    await GET(req('/api/time/entries?from=2026-08-01&to=2026-08-31&userId=someone-else'));
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { from: '2026-08-01', to: '2026-08-31' }, { userId: memberUser.id });
  });

  it('läser tid även för den som inte får skriva (konsult) — RLS avgör vad som syns', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await GET(req('/api/time/entries?from=2026-08-01&to=2026-08-31'))).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/time/entries', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST(req('/api/time/entries', jsonReq('POST', SHIFT)))).status).toBe(401);
  });

  it('kräver time.entry.write — konsult nekas', async () => {
    // konsult är extern och tid är personuppgift; de har medvetet ingen tid-nyckel alls.
    mockUser.mockResolvedValue(konsultUser);
    expect((await POST(req('/api/time/entries', jsonReq('POST', SHIFT)))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('släpper igenom member, sales och admin — alla anställda rapporterar tid', async () => {
    for (const user of [memberUser, salesUser, adminUser]) {
      mockUser.mockResolvedValue(user);
      expect((await POST(req('/api/time/entries', jsonReq('POST', SHIFT)))).status).toBe(201);
    }
  });

  it('räknar minuterna på SERVERN och skriver aldrig hours', async () => {
    // Byråns exempel: 08–18 med en timmes rast är 9 timmar, inte 10. Klientens siffra får aldrig bli
    // någons lön, och `hours` sätts av en databastrigger.
    mockUser.mockResolvedValue(memberUser);
    // Klienten påstår 3 timmar; klockslagen säger 9. Klockslagen vinner.
    await POST(req('/api/time/entries', jsonReq('POST', { ...SHIFT, hours: 3 })));
    const row = mockCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(row.minutes_worked).toBe(540);
    expect(row).not.toHaveProperty('hours');
    expect(row.user_id).toBe(memberUser.id);
  });

  it('avvisar en tidrad utan klockslag och en utan mål', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await POST(req('/api/time/entries', jsonReq('POST', { kind: 'work_order', work_date: '2026-08-14', work_order_id: WORK_ORDER_ID })))).status).toBe(400);
    expect((await POST(req('/api/time/entries', jsonReq('POST', { ...SHIFT, work_order_id: null })))).status).toBe(400);
    expect((await POST(req('/api/time/entries', { method: 'POST' }))).status).toBe(400);
  });

  it('tar frånvaro i timmar, utan klockslag', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await POST(req('/api/time/entries', jsonReq('POST', {
      kind: 'absence', work_date: '2026-08-14', absence_type_id: WORK_ORDER_ID, hours: 4,
    })));
    expect(res.status).toBe(201);
    const row = mockCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(row.minutes_worked).toBe(240);
    expect(row.start_time).toBeNull();
  });

  it('gör RLS-nekande till 403 med ett begripligt skäl', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } } as any);
    const res = await POST(req('/api/time/entries', jsonReq('POST', SHIFT)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/jobb/i);
  });

  it('gör periodlåset till 409 med triggerns meddelande', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Perioden är inlämnad eller attesterad och kan inte ändras' } } as any);
    const res = await POST(req('/api/time/entries', jsonReq('POST', SHIFT)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/inlämnad eller attesterad/);
  });
});

// ---------------------------------------------------------------------------
// PATCH / DELETE
// ---------------------------------------------------------------------------

describe('PATCH /api/time/entries/[id]', () => {
  it('kräver time.entry.write', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await PATCH(req(`/api/time/entries/${ENTRY_ID}`, jsonReq('PATCH', SHIFT)), { params: { id: ENTRY_ID } })).status).toBe(403);
  });

  it('avvisar ett id som inte är en uuid innan det når databasen', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await PATCH(req('/api/time/entries/inte-en-uuid', jsonReq('PATCH', SHIFT)), { params: { id: 'inte-en-uuid' } });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skriver alltid mot det egna user_id:t', async () => {
    mockUser.mockResolvedValue(memberUser);
    await PATCH(req(`/api/time/entries/${ENTRY_ID}`, jsonReq('PATCH', SHIFT)), { params: { id: ENTRY_ID } });
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), ENTRY_ID, memberUser.id, expect.objectContaining({ minutes_worked: 540 }));
  });

  it('svarar 404 när raden inte finns eller tillhör någon annan', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    const res = await PATCH(req(`/api/time/entries/${ENTRY_ID}`, jsonReq('PATCH', SHIFT)), { params: { id: ENTRY_ID } });
    expect(res.status).toBe(404);
  });

  it('svarar 409 med förklaring när raden finns men perioden är låst', async () => {
    // Låset ligger i policyns USING-klausul, så raden filtreras bort och UPDATE:n träffar noll rader
    // UTAN fel. Utan explainWriteMiss hade svaret blivit "Tidraden hittades inte" om en rad som
    // syns i listan — precis det svar som får folk att trycka igen.
    mockUser.mockResolvedValue(memberUser);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är inlämnad. Ångra inlämningen först om du behöver ändra.' });
    const res = await PATCH(req(`/api/time/entries/${ENTRY_ID}`, jsonReq('PATCH', SHIFT)), { params: { id: ENTRY_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Ångra inlämningen/);
  });
});

describe('DELETE /api/time/entries/[id]', () => {
  it('kräver time.entry.write', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await DELETE(req(`/api/time/entries/${ENTRY_ID}`), { params: { id: ENTRY_ID } })).status).toBe(403);
  });

  it('raderar bara sin egen rad', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await DELETE(req(`/api/time/entries/${ENTRY_ID}`), { params: { id: ENTRY_ID } });
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), ENTRY_ID, memberUser.id);
  });

  it('skiljer på låst period och saknad rad', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockDelete.mockResolvedValue({ data: null, error: null } as any);
    expect((await DELETE(req(`/api/time/entries/${ENTRY_ID}`), { params: { id: ENTRY_ID } })).status).toBe(404);

    mockExplain.mockResolvedValue({ locked: true, message: 'augusti 2026 är attesterad och kan inte ändras.' });
    expect((await DELETE(req(`/api/time/entries/${ENTRY_ID}`), { params: { id: ENTRY_ID } })).status).toBe(409);
  });
});
