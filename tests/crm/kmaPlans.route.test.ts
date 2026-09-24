import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionKey } from '@/lib/auth/permissions';
import { effectivePermissionsForRole, ekonomiUser, konsultUser, memberUser, salesUser } from './helpers/supabase';
import { kmaForm } from './helpers/kmaFixtures';

// KMA-planernas rutter. Det som prövas är att rutterna inte litar på klienten och att nycklarna är
// rätt dragna:
//
//   * läsning (lista, PDF) = crm.workorder.read — konsult och ekonomi får läsa och ladda ned,
//     skapande och förifyllnad = crm.workorder.write — de får det inte,
//   * work_order_id, skaparen, revisionen och datumet sätts på SERVERN; bolaget kommer ur mallen —
//     ett bolagsblock i kroppen faller bort,
//   * två samtidiga sparningar ger 409, inte två planer med samma nummer,
//   * PDF:en hämtas på BÅDE plan-id och order-id, och ett trasigt dokument ger ett fel — aldrig en
//     halv PDF.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getCrmWorkOrder: vi.fn() };
});

vi.mock('@/lib/domains/crm/kmaPlans/store', () => ({
  listKmaPlans: vi.fn(),
  latestKmaPlanForOrder: vi.fn(),
  latestKmaPlanBy: vi.fn(),
  kmaRevisionState: vi.fn(),
  insertKmaPlan: vi.fn(),
  getKmaPlanDocument: vi.fn(),
  listKmaDirectory: vi.fn(),
}));

vi.mock('@/lib/domains/planning/workOrderCrew', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/workOrderCrew')>();
  return { ...actual, listWorkOrderCrew: vi.fn() };
});

vi.mock('@/lib/domains/crm/kmaPlans/schemas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/kmaPlans/schemas')>();
  return { ...actual, parseStoredKmaDocument: vi.fn(actual.parseStoredKmaDocument) };
});

vi.mock('@/lib/domains/crm/kmaPlans/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/kmaPlans/pdf')>();
  return { ...actual, renderKmaPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import {
  getKmaPlanDocument,
  insertKmaPlan,
  kmaRevisionState,
  latestKmaPlanBy,
  latestKmaPlanForOrder,
  listKmaDirectory,
  listKmaPlans,
} from '@/lib/domains/crm/kmaPlans/store';
import { listWorkOrderCrew } from '@/lib/domains/planning/workOrderCrew';
import { renderKmaPdf } from '@/lib/domains/crm/kmaPlans/pdf';
import { buildKmaDocument } from '@/lib/domains/crm/kmaPlans/document';
import { parseStoredKmaDocument } from '@/lib/domains/crm/kmaPlans/schemas';

const { GET: LIST, POST } = await import('@/app/api/crm/work-orders/[id]/kma-plans/route');
const { GET: PREFILL } = await import('@/app/api/crm/work-orders/[id]/kma-plans/prefill/route');
const { GET: PDF } = await import('@/app/api/crm/work-orders/[id]/kma-plans/[planId]/pdf/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const mockOrder = vi.mocked(getCrmWorkOrder);
const mockList = vi.mocked(listKmaPlans);
const mockOrderLatest = vi.mocked(latestKmaPlanForOrder);
const mockLatestBy = vi.mocked(latestKmaPlanBy);
const mockState = vi.mocked(kmaRevisionState);
const mockInsert = vi.mocked(insertKmaPlan);
const mockDocument = vi.mocked(getKmaPlanDocument);
const mockDirectory = vi.mocked(listKmaDirectory);
const mockCrew = vi.mocked(listWorkOrderCrew);
const mockRender = vi.mocked(renderKmaPdf);
const mockParseDocument = vi.mocked(parseStoredKmaDocument);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const PLAN_ID = '66666666-6666-4666-8666-666666666666';
const ctx = { params: { id: WORK_ORDER_ID } };
const pdfCtx = { params: { id: WORK_ORDER_ID, planId: PLAN_ID } };

const office = { ...salesUser, name: 'Anna Säljare' };

// ⚠️ Ekonomi har crm.workorder.read sedan 20260918_ekonomi_work_order_read.sql — hjälparens
// EKONOMI_KEYS är äldre än så och saknar den. Nyckeln läggs till uttryckligen här.
const ekonomiPerms = new Set<PermissionKey>([...effectivePermissionsForRole('ekonomi'), 'crm.workorder.read']);

const ORDER_ROW = {
  id: WORK_ORDER_ID,
  project_name: 'Vindsbjälklag Hus A–C',
  client_name: 'Testfastigheter AB',
  order_number: 'AO-20260924-AB12CD',
  fortnox_order_number: '6579',
  work_address: { street_address: 'Testgatan 1', postal_code: '811 21', city: 'Sandviken' },
  customer_snapshot: {},
  rot_details: { property_designation: null, personal_number: '19740312-4519' },
  internal_handoff: { handoff_notes: 'Portkod 1234' },
  line_items: [{ article_name: 'EKOVILLA LÖSULL', pricing_mode: 'm3', m2: '100', thickness_mm: '300', density: '30' }],
  assignee: null,
};

const LIST_ROW = {
  id: PLAN_ID,
  revision: 3,
  issued_on: '2026-09-24',
  project_name: 'Vindsbjälklag Hus A–C',
  created_by_name: 'Anna Säljare',
  created_at: '2026-09-24T08:00:00Z',
};

function asRole(user: typeof office | typeof memberUser, perms?: Set<PermissionKey>) {
  mockUser.mockResolvedValue(user as never);
  mockPerms.mockResolvedValue(perms ?? effectivePermissionsForRole(user.role));
}

function postReq(payload: unknown) {
  return new Request('http://localhost/api/crm/work-orders/x/kma-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const getReq = (url = 'http://localhost/api/crm/work-orders/x/kma-plans', headers: Record<string, string> = {}) =>
  new Request(url, { headers });

beforeEach(() => {
  vi.clearAllMocks();
  mockOrder.mockResolvedValue({ data: ORDER_ROW, error: null } as never);
  mockList.mockResolvedValue({ data: [LIST_ROW], error: null } as never);
  mockState.mockResolvedValue({ data: { next: 3, firstIssuedOn: '2026-09-01' }, error: null });
  mockInsert.mockResolvedValue({ data: LIST_ROW, error: null } as never);
  mockOrderLatest.mockResolvedValue({ data: null, error: null } as never);
  mockLatestBy.mockResolvedValue({ data: null, error: null } as never);
  mockDirectory.mockResolvedValue({ data: [{ name: 'Anna Säljare', phone: '070-222 22 22', role: 'Säljare' }], error: null } as never);
  mockCrew.mockResolvedValue({ data: [{ member_id: 'u1', member_name: 'Lars Ledare', leader: true }], error: null });
});

describe('GET /kma-plans (listan)', () => {
  it('401 utan session, 403 för en installatör', async () => {
    mockUser.mockResolvedValue(null);
    expect((await LIST(getReq(), ctx)).status).toBe(401);
    asRole(memberUser);
    expect((await LIST(getReq(), ctx)).status).toBe(403);
  });

  it('kontoret får listan och får skapa', async () => {
    asRole(office);
    const res = await LIST(getReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.can_create).toBe(true);
    expect(json.data.items[0].pdf_url).toBe(`/api/crm/work-orders/${WORK_ORDER_ID}/kma-plans/${PLAN_ID}/pdf`);
  });

  it('konsult och ekonomi får läsa men inte skapa', async () => {
    asRole(konsultUser as never);
    expect((await (await LIST(getReq(), ctx)).json()).data.can_create).toBe(false);
    asRole(ekonomiUser as never, ekonomiPerms);
    const res = await LIST(getReq(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.can_create).toBe(false);
  });

  it('ogiltigt id ger 400, ett databasfel 500', async () => {
    asRole(office);
    expect((await LIST(getReq(), { params: { id: 'inte-ett-id' } })).status).toBe(400);
    mockList.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    expect((await LIST(getReq(), ctx)).status).toBe(500);
  });
});

describe('POST /kma-plans (skapa)', () => {
  it('bara med skrivnyckeln — konsult och ekonomi får 403', async () => {
    asRole(konsultUser as never);
    expect((await POST(postReq(kmaForm()), ctx)).status).toBe(403);
    asRole(ekonomiUser as never, ekonomiPerms);
    expect((await POST(postReq(kmaForm()), ctx)).status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('ogiltig kropp ger 400 utan att något sparas', async () => {
    asRole(office);
    const form = kmaForm();
    form.project.materials = [];
    expect((await POST(postReq(form), ctx)).status).toBe(400);
    expect((await POST(postReq(null), ctx)).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('en order som sessionen inte ser ger 404', async () => {
    asRole(office);
    mockOrder.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } } as never);
    expect((await POST(postReq(kmaForm()), ctx)).status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('order, skapare, revision och datum sätts på servern — bolaget ur mallen', async () => {
    asRole(office);
    const res = await POST(
      postReq({ ...kmaForm(), work_order_id: 'någon-annans', company: { name: 'Annat AB' }, revision: 99 }),
      ctx,
    );
    expect(res.status).toBe(201);
    const row = mockInsert.mock.calls[0][1];
    expect(row.work_order_id).toBe(WORK_ORDER_ID);
    expect(row.created_by).toBe(office.id);
    expect(row.created_by_name).toBe('Anna Säljare');
    expect(row.revision).toBe(3);
    expect(row.issued_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.input).not.toHaveProperty('company');
    const doc = row.document as ReturnType<typeof buildKmaDocument>;
    expect(doc.meta).toMatchObject({ revision: 3, firstIssuedOn: '2026-09-01', issuedOn: row.issued_on });
    expect(JSON.stringify(doc)).toContain('Isoleringslandslaget AB 559022-5800');
    expect(JSON.stringify(doc)).not.toContain('Annat AB');

    const json = await res.json();
    expect(json.data.filename).toBe('KMA-plan 6579 rev3 - Vindsbjalklag Hus AC.pdf');
    expect(json.data.pdf_url).toBe(`/api/crm/work-orders/${WORK_ORDER_ID}/kma-plans/${PLAN_ID}/pdf`);
  });

  it('första revisionen är upprättad samma dag som den ges ut', async () => {
    asRole(office);
    mockState.mockResolvedValue({ data: { next: 1, firstIssuedOn: null }, error: null });
    await POST(postReq(kmaForm()), ctx);
    const doc = mockInsert.mock.calls[0][1].document as ReturnType<typeof buildKmaDocument>;
    expect(doc.meta.revision).toBe(1);
    expect(doc.meta.firstIssuedOn).toBe(doc.meta.issuedOn);
  });

  it('två samtidiga sparningar: den andra får 409, inte samma nummer', async () => {
    asRole(office);
    mockInsert.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } } as never);
    const res = await POST(postReq(kmaForm()), ctx);
    expect(res.status).toBe(409);
  });

  it('ett dokument som PDF-routen skulle avvisa sparas ALDRIG', async () => {
    // Invariant: en revision går inte att ändra eller ta bort från appen, så det som sparas måste
    // gå att rendera. Byggaren ska aldrig ge ett ogiltigt dokument — men gör den det, sparas inget.
    asRole(office);
    mockParseDocument.mockReturnValueOnce(null);
    const res = await POST(postReq(kmaForm()), ctx);
    expect(res.status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('RLS som nekar (42501) blir 403', async () => {
    asRole(office);
    mockInsert.mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } } as never);
    expect((await POST(postReq(kmaForm()), ctx)).status).toBe(403);
  });
});

describe('GET /kma-plans/prefill', () => {
  const prefillReq = (query = '') => getReq(`http://localhost/api/crm/work-orders/x/kma-plans/prefill${query}`);

  it('bara med skrivnyckeln', async () => {
    asRole(konsultUser as never);
    expect((await PREFILL(prefillReq(), ctx)).status).toBe(403);
  });

  it('förifyller ur ordern, besättningen och Kontaktlistan — säljarnamnet från sidan', async () => {
    asRole(office);
    const res = await PREFILL(prefillReq('?sales_name=Anna%20S%C3%A4ljare'), ctx);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.form.project.projectNumber).toBe('6579');
    expect(data.form.project.materials).toEqual(['EKOVILLA']);
    expect(data.form.contacts[0]).toEqual({ name: 'Anna Säljare', role: 'Försäljningsansvarig', phone: '070-222 22 22' });
    expect(data.form.signers.ongoing).toEqual([{ name: 'Lars Ledare', role: 'Ledande installatör' }]);
    expect(data.directory).toHaveLength(1);
    expect(mockLatestBy).toHaveBeenCalledWith(expect.anything(), office.id);
    expect(mockLatestBy).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('portkoden och personnumret når aldrig svaret', async () => {
    asRole(office);
    const body = JSON.stringify(await (await PREFILL(prefillReq(), ctx)).json());
    expect(body).not.toContain('Portkod');
    expect(body).not.toContain('19740312');
  });

  it('en förslagskälla som fallerar fäller inte dialogen', async () => {
    asRole(office);
    mockCrew.mockResolvedValue({ data: [], error: { message: 'rls' } });
    mockDirectory.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    const res = await PREFILL(prefillReq(), ctx);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.form.signers.ongoing).toEqual([]);
    expect(data.crew_count).toBeNull();
  });

  it('en order som inte finns ger 404, ett för långt säljarnamn 400', async () => {
    asRole(office);
    expect((await PREFILL(prefillReq(`?sales_name=${'x'.repeat(121)}`), ctx)).status).toBe(400);
    mockOrder.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } } as never);
    expect((await PREFILL(prefillReq(), ctx)).status).toBe(404);
  });
});

describe('GET /kma-plans/[planId]/pdf', () => {
  const doc = buildKmaDocument(kmaForm(), { revision: 3, issuedOn: '2026-09-24', firstIssuedOn: '2026-09-01' });
  const pdfReq = (headers: Record<string, string> = {}) =>
    getReq(`http://localhost/api/crm/work-orders/${WORK_ORDER_ID}/kma-plans/${PLAN_ID}/pdf`, headers);

  it('konsult och ekonomi får ladda ned; planen hämtas på BÅDE order och plan', async () => {
    mockDocument.mockResolvedValue({ data: { id: PLAN_ID, revision: 3, document: doc }, error: null } as never);
    for (const [user, perms] of [[konsultUser, undefined], [ekonomiUser, ekonomiPerms]] as const) {
      asRole(user as never, perms);
      const res = await PDF(pdfReq(), pdfCtx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe('inline; filename="KMA-plan 6579 rev3 - Vindsbjalklag Hus AC.pdf"');
    }
    expect(mockDocument).toHaveBeenCalledWith(expect.anything(), WORK_ORDER_ID, PLAN_ID);
  });

  it('en installatör får 403 — som HTML-sida när det är en fliknavigering', async () => {
    asRole(memberUser);
    const res = await PDF(pdfReq({ 'sec-fetch-dest': 'document' }), pdfCtx);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('en plan som inte hör till ordern ger 404', async () => {
    asRole(office);
    mockDocument.mockResolvedValue({ data: null, error: null } as never);
    expect((await PDF(pdfReq(), pdfCtx)).status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('ett trasigt sparat dokument ger ett fel — aldrig en halv PDF', async () => {
    asRole(office);
    mockDocument.mockResolvedValue({ data: { id: PLAN_ID, revision: 3, document: { ...doc, layout: 9 } }, error: null } as never);
    const res = await PDF(pdfReq(), pdfCtx);
    expect(res.status).toBe(500);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('ogiltigt plan-id ger 400', async () => {
    asRole(office);
    expect((await PDF(pdfReq(), { params: { id: WORK_ORDER_ID, planId: 'x' } })).status).toBe(400);
  });
});
