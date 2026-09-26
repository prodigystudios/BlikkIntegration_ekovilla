import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectivePermissionsForRole, memberUser, salesUser } from './helpers/supabase';

// Framdriftsrapporteringens rutt. Det som prövas här är inte att en insert går igenom, utan att
// routen inte litar på klienten:
//
//   * etikett och enhet för ett KOPPLAT moment snapshottas ur orderraden. Tillåts klienten sätta
//     dem kan en rapport säga "45 st" mot en rad som säljer 120 m, och kontorets "45 av 120" blir
//     ett tal utan betydelse,
//   * work_order_id kommer ur rutt-parametern, aldrig ur kroppen. RLS gatar på det fältet, så en
//     klient som fick välja det själv hade valt ett jobb hen är besättning på,
//   * ett okänt line_item_id AVVISAS i stället för att tyst bli ett fritextmoment — annars blir en
//     planerad rapport en avvikelse i kontorets vy,
//   * can_delete speglar RLS:ens två grenar och räknas på SERVERN.

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
    listCrmWorkOrderProgressReports: vi.fn(),
    createCrmWorkOrderProgressReports: vi.fn(),
    getCrmWorkOrderProgressReport: vi.fn(),
    deleteCrmWorkOrderProgressReport: vi.fn(),
    isUserOnWorkOrder: vi.fn(),
  };
});

vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  createCrmWorkOrderProgressReports,
  deleteCrmWorkOrderProgressReport,
  getCrmWorkOrderLineItems,
  getCrmWorkOrderProgressReport,
  isUserOnWorkOrder,
  listCrmWorkOrderProgressReports,
} from '@/lib/domains/crm/work-orders';

const { GET, POST } = await import('@/app/api/crm/work-orders/[id]/progress-reports/route');
const { DELETE } = await import('@/app/api/crm/work-orders/[id]/progress-reports/[reportId]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const mockOrder = vi.mocked(getCrmWorkOrderLineItems);
const mockList = vi.mocked(listCrmWorkOrderProgressReports);
const mockCreate = vi.mocked(createCrmWorkOrderProgressReports);
const mockGetOne = vi.mocked(getCrmWorkOrderProgressReport);
const mockDeleteOne = vi.mocked(deleteCrmWorkOrderProgressReport);
const mockOnJob = vi.mocked(isUserOnWorkOrder);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: { id: WORK_ORDER_ID } };
const delCtx = { params: { id: WORK_ORDER_ID, reportId: REPORT_ID } };

const installer = { ...memberUser, name: 'Kalle Karlsson' };
const office = { ...salesUser, name: 'Anna Säljare' };

const LINE_ITEMS = [
  { id: 'li-1', article_name: 'Landgång', pricing_mode: 'item', quantity: '120', article_unit_name: 'm' },
  { id: 'li-2', article_name: 'Brandmatta', pricing_mode: 'item', quantity: '4', article_unit_name: 'st' },
  // Yta — säckrapportens område, ska aldrig gå att rapportera framdrift på.
  { id: 'li-3', article_name: 'Ekovilla lösull', pricing_mode: 'm3', m2: '100', thickness_mm: '200' },
];

function postReq(payload: unknown) {
  return new Request('http://localhost/api/crm/work-orders/x/progress-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
const getReq = () => new Request('http://localhost/api/crm/work-orders/x/progress-reports');
const delReq = () => new Request('http://localhost/api/crm/work-orders/x/progress-reports/y', { method: 'DELETE' });

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    work_order_id: WORK_ORDER_ID,
    report_day: '2026-09-16',
    line_item_id: 'li-1',
    work_item: 'Landgång',
    // PostgREST svarar med numeric som STRÄNG — mappningen måste göra tal av den.
    quantity: '45.00',
    unit: 'm',
    location: 'Hus A',
    note: null,
    created_by: installer.id,
    created_by_name: 'Kalle Karlsson',
    created_at: '2026-09-16T15:00:00Z',
    ...overrides,
  };
}

const BODY = {
  report_day: '2026-09-16',
  location: 'Hus A',
  entries: [{ line_item_id: 'li-1', quantity: 45 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(installer);
  mockOrder.mockResolvedValue({ data: { id: WORK_ORDER_ID, line_items: LINE_ITEMS }, error: null } as never);
  mockList.mockResolvedValue({ data: [], error: null } as never);
  mockCreate.mockResolvedValue({ data: [row()], error: null } as never);
  mockGetOne.mockResolvedValue({ data: row(), error: null } as never);
  mockDeleteOne.mockResolvedValue({ data: { id: REPORT_ID }, error: null } as never);
  mockPerms.mockImplementation(async () => effectivePermissionsForRole((await mockUser())?.role));
  mockOnJob.mockResolvedValue({ data: true, error: null } as never);
});

describe('GET /progress-reports', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(getReq(), ctx)).status).toBe(401);
  });

  it('gör tal av PostgREST:s numeric-sträng', async () => {
    mockList.mockResolvedValue({ data: [row({ quantity: '45.50' })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].quantity).toBe(45.5);
  });

  it('faller tillbaka på "Okänd" när namnsnapshoten är tom', async () => {
    mockList.mockResolvedValue({ data: [row({ created_by_name: null })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].created_by_name).toBe('Okänd');
  });

  it('ger kontoret can_delete på andras rader', async () => {
    mockUser.mockResolvedValue(office);
    mockList.mockResolvedValue({ data: [row({ created_by: 'någon-annan' })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].can_delete).toBe(true);
    // Kontoret ska inte betala för besättningsuppslaget.
    expect(mockOnJob).not.toHaveBeenCalled();
  });

  it('ger rapportören can_delete på sin egen rad men inte på kollegans', async () => {
    mockList.mockResolvedValue({
      data: [row({ id: 'egen', created_by: installer.id }), row({ id: 'kollegans', created_by: 'kollega' })],
      error: null,
    } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items.map((i: any) => [i.id, i.can_delete])).toEqual([
      ['egen', true],
      ['kollegans', false],
    ]);
  });

  // ⚠️ Den subtila grenen: en KONTORSANVÄNDARE som skrivit en rad och sedan fått nyckeln indragen
  // äger raden och kan läsa den, men är inte besättning. Utan besättningsvillkoret hade knappen
  // ritats åt just hen — och DELETE:n svarat 403.
  it('nekar can_delete åt den som äger raden men inte längre är besättning', async () => {
    mockOnJob.mockResolvedValue({ data: false, error: null } as never);
    mockList.mockResolvedValue({ data: [row({ created_by: installer.id })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].can_delete).toBe(false);
  });

  it('säger till när hämtningen misslyckas i stället för att svara med en tom bok', async () => {
    mockList.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    expect((await GET(getReq(), ctx)).status).toBe(500);
  });
});

describe('POST /progress-reports', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST(postReq(BODY), ctx)).status).toBe(401);
  });

  // 🧨 SPÄRREN BAKOM "45 av 120 m".
  it('snapshottar etikett och enhet ur orderraden och ignorerar klientens', async () => {
    await POST(
      postReq({ ...BODY, entries: [{ line_item_id: 'li-1', work_item: 'Något annat', unit: 'st', quantity: 45 }] }),
      ctx,
    );
    const [, rows] = mockCreate.mock.calls[0];
    expect(rows[0]).toMatchObject({ line_item_id: 'li-1', work_item: 'Landgång', unit: 'm' });
  });

  // 🧨 RLS gatar på work_order_id. Fick klienten välja det hade hen valt ett jobb hen är
  // besättning på och skrivit framdrift där.
  it('tar work_order_id ur rutt-parametern, aldrig ur kroppen', async () => {
    await POST(postReq({ ...BODY, work_order_id: 'annat-jobb' }), ctx);
    const [, rows] = mockCreate.mock.calls[0];
    expect(rows[0].work_order_id).toBe(WORK_ORDER_ID);
  });

  it('stämplar datum, plats och notering på VARJE moment', async () => {
    await POST(
      postReq({
        report_day: '2026-09-16',
        location: '  Hus  A ',
        note: 'Dålig åtkomst',
        entries: [{ line_item_id: 'li-1', quantity: 45 }, { line_item_id: 'li-2', quantity: 2 }],
      }),
      ctx,
    );
    const [, rows] = mockCreate.mock.calls[0];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ report_day: '2026-09-16', location: 'Hus A', note: 'Dålig åtkomst' });
    }
  });

  it('sparar ett fritextmoment utan orderrad', async () => {
    await POST(postReq({ ...BODY, entries: [{ work_item: 'Extra sarg', unit: 'st', quantity: 6 }] }), ctx);
    const [, rows] = mockCreate.mock.calls[0];
    expect(rows[0]).toMatchObject({ line_item_id: null, work_item: 'Extra sarg', unit: 'st', quantity: 6 });
  });

  // 🧨 Raden kan ha tagits bort ur ordern medan fältvyn stod öppen.
  it('avvisar ett okänt line_item_id med 409 i stället för att spara det som fritext', async () => {
    const res = await POST(
      postReq({ ...BODY, entries: [{ line_item_id: 'borta', work_item: 'Landgång', quantity: 45 }] }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Ytorna hör till säckrapporten. En m³-rad är inget rapporterbart moment här, så dess id är
  // okänt — samma svar som en borttagen rad.
  it('avvisar en ytrad som moment', async () => {
    const res = await POST(postReq({ ...BODY, entries: [{ line_item_id: 'li-3', quantity: 10 }] }), ctx);
    expect(res.status).toBe(409);
  });

  // 🧨 GRANSKNINGSFYND 2026-09-16. En avskriven rad får ett EGET besked. Rådet som hör till ett
  // okänt id ("ladda om sidan") hjälper inte här — raden finns kvar, det är dess status som är
  // svaret, och ingen omladdning i världen ändrar den.
  it('avvisar en avskriven rad med ett besked som går att handla på', async () => {
    mockOrder.mockResolvedValue({
      data: { id: WORK_ORDER_ID, line_items: [{ ...LINE_ITEMS[0], written_off: true }] },
      error: null,
    } as never);
    const res = await POST(postReq({ ...BODY, entries: [{ line_item_id: 'li-1', quantity: 45 }] }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/avskriven/i);
    expect(body.error).not.toMatch(/ladda om/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('avvisar ett moment utan namn', async () => {
    const res = await POST(postReq({ ...BODY, entries: [{ quantity: 6 }] }), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('avvisar samma moment två gånger i en rapport', async () => {
    const res = await POST(
      postReq({ ...BODY, entries: [{ line_item_id: 'li-1', quantity: 45 }, { line_item_id: 'li-1', quantity: 45 }] }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('tillåter en nollrapport', async () => {
    const res = await POST(postReq({ ...BODY, entries: [{ line_item_id: 'li-1', quantity: 0 }] }), ctx);
    expect(res.status).toBe(201);
    const [, rows] = mockCreate.mock.calls[0];
    expect(rows[0].quantity).toBe(0);
  });

  it('svarar 404 när ordern inte går att läsa', async () => {
    mockOrder.mockResolvedValue({ data: null, error: null } as never);
    expect((await POST(postReq(BODY), ctx)).status).toBe(404);
  });

  // RLS-avvisning är ett behörighetssvar, inte ett serverfel.
  it('gör 403 av ett RLS-nej', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } } as never);
    const res = await POST(postReq(BODY), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/inte inbokad/i);
  });

  it('ger rapportören can_delete på raderna hen just skrev', async () => {
    const body = await (await POST(postReq(BODY), ctx)).json();
    expect(body.data.items[0].can_delete).toBe(true);
    // Insert-policyn har redan svarat på besättningsfrågan — inget extra RPC.
    expect(mockOnJob).not.toHaveBeenCalled();
  });
});

describe('DELETE /progress-reports/[reportId]', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await DELETE(delReq(), delCtx)).status).toBe(401);
  });

  it('svarar 404 när raden inte finns', async () => {
    mockGetOne.mockResolvedValue({ data: null, error: null } as never);
    expect((await DELETE(delReq(), delCtx)).status).toBe(404);
  });

  // ⚠️ En DELETE som RLS nekar svarar `error: null` och noll rader — exakt som en lyckad
  // borttagning av något som redan var borta. Raden läses därför tillbaka.
  it('svarar 403 när DELETE:n inte träffar någon rad', async () => {
    mockDeleteOne.mockResolvedValue({ data: null, error: null } as never);
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/skrev rapporten, eller kontoret/i);
  });

  it('tar bort raden', async () => {
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(REPORT_ID);
  });
});
