import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectivePermissionsForRole, memberUser, salesUser } from './helpers/supabase';

// Etapprutterna. Det som prövas här är inte att en insert går igenom, utan att routen inte litar
// på klienten:
//
//   * work_order_id kommer ur rutt-parametern, aldrig ur kroppen — RLS gatar på det fältet,
//   * antalen prövas mot orderns AKTUELLA rader och de andra etapperna, och överallokering blir
//     409 i stället för en etapp som planerar mer än som är sålt,
//   * dubbla poster för samma rad SUMMERAS före taket och lagras EN gång,
//   * en ändring av en etapp räknar inte dess egna antal som upptagna (excludeStageId),
//   * en utplacerad etapp går inte att ta bort utan ett medvetet andra steg,
//   * 🧨 placeringarna räknas ELEVERAT. RLS gäller för `count` precis som för rader, så en
//     kontorsanvändare utan planning.schedule.read hade fått 0 och spärren hade tystnat.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    getCrmWorkOrderLineItems: vi.fn(),
    listCrmWorkOrderStages: vi.fn(),
    nextCrmWorkOrderStageNumber: vi.fn(),
    createCrmWorkOrderStage: vi.fn(),
    updateCrmWorkOrderStage: vi.fn(),
    deleteCrmWorkOrderStage: vi.fn(),
    countSegmentsForStage: vi.fn(),
  };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({ kind: 'session' })) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({ kind: 'admin' })) }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  countSegmentsForStage,
  createCrmWorkOrderStage,
  deleteCrmWorkOrderStage,
  getCrmWorkOrderLineItems,
  listCrmWorkOrderStages,
  nextCrmWorkOrderStageNumber,
  updateCrmWorkOrderStage,
} from '@/lib/domains/crm/work-orders';

const { GET, POST } = await import('@/app/api/crm/work-orders/[id]/stages/route');
const { PATCH, DELETE } = await import('@/app/api/crm/work-orders/[id]/stages/[stageId]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const mockOrder = vi.mocked(getCrmWorkOrderLineItems);
const mockList = vi.mocked(listCrmWorkOrderStages);
const mockNext = vi.mocked(nextCrmWorkOrderStageNumber);
const mockCreate = vi.mocked(createCrmWorkOrderStage);
const mockUpdate = vi.mocked(updateCrmWorkOrderStage);
const mockDelete = vi.mocked(deleteCrmWorkOrderStage);
const mockCount = vi.mocked(countSegmentsForStage);
const mockAdmin = vi.mocked(getSupabaseAdmin);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const STAGE_ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: { id: WORK_ORDER_ID } };
const stageCtx = { params: { id: WORK_ORDER_ID, stageId: STAGE_ID } };

const office = { ...salesUser, name: 'Anna Säljare' };

// 300 m2 x 200 mm = 60 m3.
const LINE_ITEMS = [{ id: 'r-wall', pricing_mode: 'm3', m2: '300', thickness_mm: '200', unit_price: '1200' }];

const req = (body: unknown, url = `http://x/api/crm/work-orders/${WORK_ORDER_ID}/stages`) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(office as never);
  mockPerms.mockResolvedValue(effectivePermissionsForRole('sales') as never);
  mockOrder.mockResolvedValue({ data: { id: WORK_ORDER_ID, line_items: LINE_ITEMS }, error: null } as never);
  mockList.mockResolvedValue({ data: [], error: null } as never);
  mockNext.mockResolvedValue({ data: 1, error: null } as never);
  mockCreate.mockResolvedValue({ data: { id: STAGE_ID, stage_number: 1 }, error: null } as never);
});

describe('POST /stages', () => {
  it('sparar work_order_id ur RUTTEN, inte ur kroppen', async () => {
    const res = await POST(
      req({ title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 24 }], work_order_id: 'annan-order' }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ work_order_id: WORK_ORDER_ID });
  });

  it('avvisar överallokering med 409 och radens verkliga rest', async () => {
    const res = await POST(req({ title: 'För stor', line_quantities: [{ line_id: 'r-wall', quantity: 61 }] }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorDetails.code).toBe('crm_work_order_stage_allocation');
    expect(body.error).toMatch(/bara 60 kvar/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('räknar in befintliga etapper när resten prövas', async () => {
    mockList.mockResolvedValue({
      data: [{ id: 'annan', stage_number: 1, title: 'Etapp 1', line_quantities: [{ line_id: 'r-wall', quantity: 50 }] }],
      error: null,
    } as never);
    const res = await POST(req({ title: 'Etapp 2', line_quantities: [{ line_id: 'r-wall', quantity: 20 }] }), ctx);
    expect(res.status).toBe(409); // bara 10 kvar
  });

  it('SUMMERAR dubbla poster för samma rad och lagrar dem en gång', async () => {
    const res = await POST(
      req({ title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 10 }, { line_id: 'r-wall', quantity: 14 }] }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ line_quantities: [{ line_id: 'r-wall', quantity: 24 }] });
  });

  it('ber om ett nytt försök när två etapper skapades samtidigt', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } } as never);
    const res = await POST(req({ title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 1 }] }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_stage_number_taken');
  });

  it('kräver crm.workorder.write', async () => {
    mockUser.mockResolvedValue(memberUser as never);
    mockPerms.mockResolvedValue(effectivePermissionsForRole('member') as never);
    const res = await POST(req({ title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 1 }] }), ctx);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GET /stages', () => {
  it('svarar med radläget så editorn slipper räkna om det', async () => {
    mockList.mockResolvedValue({
      data: [{ id: STAGE_ID, stage_number: 1, title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 24 }] }],
      error: null,
    } as never);
    const res = await GET(new Request('http://x'), ctx);
    const body = await res.json();
    expect(body.data.line_state[0]).toMatchObject({ lineId: 'r-wall', total: 60, allocated: 24, unallocated: 36 });
  });
});

describe('PATCH /stages/[stageId]', () => {
  const existing = { id: STAGE_ID, stage_number: 1, title: 'Vägg', line_quantities: [{ line_id: 'r-wall', quantity: 60 }] };

  beforeEach(() => {
    mockList.mockResolvedValue({ data: [existing], error: null } as never);
    mockUpdate.mockResolvedValue({ data: { ...existing }, error: null } as never);
  });

  // Utan excludeStageId räknas etappens egna 60 som upptagna av någon annan, och att spara den
  // orörd hade svarat "raden har bara 0 kvar".
  it('räknar inte etappens egna antal som upptagna av någon annan', async () => {
    const res = await PATCH(req({ line_quantities: [{ line_id: 'r-wall', quantity: 60 }] }), stageCtx);
    expect(res.status).toBe(200);
  });

  it('avvisar en ändring som överallokerar mot en ANNAN etapp', async () => {
    mockList.mockResolvedValue({
      data: [existing, { id: 'annan', stage_number: 2, title: 'B', line_quantities: [{ line_id: 'r-wall', quantity: 0 }] }],
      error: null,
    } as never);
    const res = await PATCH(req({ line_quantities: [{ line_id: 'r-wall', quantity: 61 }] }), stageCtx);
    expect(res.status).toBe(409);
  });

  // 🧨 REGRESSION, och den fanns på riktigt i första utkastet. Fälten ärvde skapandeschemats
  // `.default(null)`, som uttryckligen ersätter undefined — så ett fält klienten inte skickade kom
  // ut som ett null och skrevs. Att byta namn på en etapp raderade dess arbetsbeskrivning och
  // jobbtyp, tyst. Mutationsprövat: med `.default(null)` tillbaka blir det här testet rött.
  it('lämnar utelämnade fält orörda i stället för att tömma dem', async () => {
    await PATCH(req({ title: 'Nytt namn' }), stageCtx);
    expect(mockUpdate.mock.calls[0][3]).toEqual({ title: 'Nytt namn' });
  });

  it('men ett uttryckligt null TÖMMER fältet — det är skillnaden mot att utelämna det', async () => {
    await PATCH(req({ work_description: null }), stageCtx);
    expect(mockUpdate.mock.calls[0][3]).toEqual({ work_description: null });
  });

  it('svarar 404 när uppdateringen inte träffade någon rad', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: null } as never);
    const res = await PATCH(req({ title: 'Nytt namn' }), stageCtx);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /stages/[stageId]', () => {
  const delReq = (force = false) =>
    new Request(`http://x/api/crm/work-orders/${WORK_ORDER_ID}/stages/${STAGE_ID}${force ? '?force=1' : ''}`, {
      method: 'DELETE',
    });

  beforeEach(() => {
    // Bindningen etapp↔order prövas FÖRE räkningen, så listan måste innehålla etappen.
    mockList.mockResolvedValue({ data: [{ id: STAGE_ID, stage_number: 1, title: 'Vägg', line_quantities: [] }], error: null } as never);
    mockDelete.mockResolvedValue({ data: { id: STAGE_ID }, error: null } as never);
  });

  // 🧨 Räknades placeringarna först svarade routen 409 med en ANNAN orders antal — ett läckage, och
  // fel svar: en etapp som inte hör till ordern är 404, inte "den är utplacerad".
  it('svarar 404 för en etapp som hör till en ANNAN order, utan att räkna placeringar', async () => {
    mockList.mockResolvedValue({ data: [], error: null } as never);
    const res = await DELETE(delReq(), stageCtx);
    expect(res.status).toBe(404);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('tar bort en oplanerad etapp', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null } as never);
    const res = await DELETE(delReq(), stageCtx);
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
  });

  it('spärrar en utplacerad etapp med 409 och antalet placeringar', async () => {
    mockCount.mockResolvedValue({ count: 3, error: null } as never);
    const res = await DELETE(delReq(), stageCtx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/3 ställen/);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('släpper igenom med ?force=1 och rapporterar hur många placeringar som släpptes', async () => {
    mockCount.mockResolvedValue({ count: 3, error: null } as never);
    const res = await DELETE(delReq(true), stageCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.released_segments).toBe(3);
  });

  // 🧨 Spärren hade tystnat tyst om räkningen gick genom sessionsklienten: RLS gäller för `count`,
  // och en kontorsanvändare utan planning.schedule.read får 0 — inte ett fel.
  it('räknar placeringarna ELEVERAT, inte med sessionsklienten', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null } as never);
    await DELETE(delReq(), stageCtx);
    expect(mockAdmin).toHaveBeenCalled();
    expect(mockCount.mock.calls[0][0]).toMatchObject({ kind: 'admin' });
  });

  it('failar STÄNGT när räkningen går sönder', async () => {
    mockCount.mockResolvedValue({ count: null, error: { message: 'nekad' } } as never);
    const res = await DELETE(delReq(), stageCtx);
    expect(res.status).toBe(500);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('svarar 404 när borttagningen inte träffade någon rad', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null } as never);
    mockDelete.mockResolvedValue({ data: null, error: null } as never);
    const res = await DELETE(delReq(), stageCtx);
    expect(res.status).toBe(404);
  });
});
