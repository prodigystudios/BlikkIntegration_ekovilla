import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser } from './helpers/supabase';

// Kontorets Tid-flik på arbetsordern. Raderna hamnar i `crm_time_entries` — SAMMA tabell som
// löneunderlaget — och sedan 2026-08-14 måste de bära klockslag: lönen härleder OB och övertid ur
// start och slut, och ett timtal går inte att räkna någotdera på.
//
// Det som prövas här är att vägen in verkligen går genom buildTimeEntryRow. Skulle den någon gång
// börja skriva timmar direkt igen slutar CHECK:en på tabellen släppa igenom raden — och felet syns
// först i produktion, på någons lön.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    listCrmWorkOrderTimeEntries: vi.fn(),
    createCrmWorkOrderTimeEntry: vi.fn(),
    updateCrmWorkOrderTimeEntry: vi.fn(),
    deleteCrmWorkOrderTimeEntry: vi.fn(),
  };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { createCrmWorkOrderTimeEntry, updateCrmWorkOrderTimeEntry } from '@/lib/domains/crm/work-orders';

const { POST } = await import('@/app/api/crm/work-orders/[id]/time-entries/route');
const { PATCH } = await import('@/app/api/crm/work-orders/[id]/time-entries/[entryId]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockCreate = vi.mocked(createCrmWorkOrderTimeEntry);
const mockUpdate = vi.mocked(updateCrmWorkOrderTimeEntry);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const ENTRY_ID = '66666666-6666-4666-8666-666666666666';

const ctx = { params: { id: WORK_ORDER_ID } };
const entryCtx = { params: { id: WORK_ORDER_ID, entryId: ENTRY_ID } };

function jsonReq(method: 'POST' | 'PATCH', payload: unknown) {
  return new Request('http://localhost/api/crm/work-orders/x/time-entries', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Byråns eget exempel: 08–18 med en timmes rast är nio timmar, inte tio.
const SHIFT = { work_date: '2026-08-14', start_time: '08:00', end_time: '18:00', break_minutes: 60 };

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(memberUser);
  mockCreate.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
  mockUpdate.mockResolvedValue({ data: { id: ENTRY_ID }, error: null } as any);
});

describe('POST /api/crm/work-orders/[id]/time-entries', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST(jsonReq('POST', SHIFT), ctx)).status).toBe(401);
  });

  it('kräver klockslag — ett timtal räcker inte längre', async () => {
    const res = await POST(jsonReq('POST', { work_date: '2026-08-14', hours: 9 }), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('räknar minuterna på servern och lämnar hours till databastriggern', async () => {
    expect((await POST(jsonReq('POST', SHIFT), ctx)).status).toBe(201);
    const row = mockCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(row.minutes_worked).toBe(540);
    expect(row).not.toHaveProperty('hours');
  });

  it('sätter kind och binder raden till ordern i adressen', async () => {
    await POST(jsonReq('POST', SHIFT), ctx);
    const row = mockCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(row.kind).toBe('work_order');
    expect(row.work_order_id).toBe(WORK_ORDER_ID);
    expect(row.user_id).toBe(memberUser.id);
  });

  it('avvisar en rast som är längre än passet i stället för att skriva noll', async () => {
    const res = await POST(jsonReq('POST', { ...SHIFT, break_minutes: 700 }), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // end <= start betyder midnattspassage, inte ett fel — ett nattpass 22:00–06:00 är åtta timmar.
  it('tolkar ett pass över midnatt', async () => {
    await POST(jsonReq('POST', { work_date: '2026-08-14', start_time: '22:00', end_time: '06:00', break_minutes: 0 }), ctx);
    expect((mockCreate.mock.calls[0][1] as Record<string, unknown>).minutes_worked).toBe(480);
  });

  it('avvisar skräp i klockslagen', async () => {
    expect((await POST(jsonReq('POST', { ...SHIFT, start_time: 'morgon' }), ctx)).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('svarar 409 när perioden är attesterad, inte 500', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'augusti 2026 är attesterad' } } as any);
    const res = await POST(jsonReq('POST', SHIFT), ctx);
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/crm/work-orders/[id]/time-entries/[entryId]', () => {
  it('kräver klockslag även vid ändring', async () => {
    expect((await PATCH(jsonReq('PATCH', { work_date: '2026-08-14', hours: 9 }), entryCtx)).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('räknar om minuterna ur de nya klockslagen', async () => {
    await PATCH(jsonReq('PATCH', { ...SHIFT, break_minutes: 30 }), entryCtx);
    expect((mockUpdate.mock.calls[0][3] as Record<string, unknown>).minutes_worked).toBe(570);
  });

  // Ordern skickas med till buildTimeEntryRow för att raden ska gå att validera, men den får inte
  // gå vidare till patchen: en PATCH mot fel orders adress hade annars FLYTTAT tidraden dit.
  it('skickar med ordern till byggaren men låter domänen skala bort den', async () => {
    await PATCH(jsonReq('PATCH', SHIFT), entryCtx);
    const row = mockUpdate.mock.calls[0][3] as Record<string, unknown>;
    expect(row.work_order_id).toBe(WORK_ORDER_ID);
    expect(mockUpdate.mock.calls[0][1]).toBe(ENTRY_ID);
    expect(mockUpdate.mock.calls[0][2]).toBe(memberUser.id);
  });
});
