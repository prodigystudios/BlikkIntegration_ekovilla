import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectivePermissionsForRole, konsultUser, memberUser, salesUser } from './helpers/supabase';

// Filerna på arbetsordern. Byten passerar aldrig en route handler — klienten laddar upp direkt till
// lagringen med en signerad URL — vilket flyttar hela tilliten till bekräftelsesteget. Det som
// prövas här är därför framför allt att servern inte tror på klienten: sökvägen ska kontrolleras
// mot ordern, storleken och mimetypen ska läsas ur lagringen och inte ur kroppen, och en
// installatör ska inte kunna gömma en fil för sina kollegor.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    listCrmWorkOrderFiles: vi.fn(),
    createCrmWorkOrderFile: vi.fn(),
    getCrmWorkOrderFile: vi.fn(),
    deleteCrmWorkOrderFile: vi.fn(),
    findCrmWorkOrderFileByPath: vi.fn(),
    isUserOnWorkOrder: vi.fn(),
  };
});

vi.mock('@/lib/domains/crm/workOrderFiles/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/workOrderFiles/storage')>();
  return {
    ...actual,
    createWorkOrderFileUploadUrl: vi.fn(),
    readWorkOrderFileInfo: vi.fn(),
    removeWorkOrderFileObject: vi.fn(),
    signWorkOrderFileUrls: vi.fn(),
    signWorkOrderFileUrl: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  createCrmWorkOrderFile,
  deleteCrmWorkOrderFile,
  findCrmWorkOrderFileByPath,
  isUserOnWorkOrder,
  listCrmWorkOrderFiles,
} from '@/lib/domains/crm/work-orders';
import {
  createWorkOrderFileUploadUrl,
  readWorkOrderFileInfo,
  removeWorkOrderFileObject,
  signWorkOrderFileUrls,
} from '@/lib/domains/crm/workOrderFiles/storage';

const { POST: UPLOAD_URL } = await import('@/app/api/crm/work-orders/[id]/files/upload-url/route');
const { GET: LIST, POST: CONFIRM } = await import('@/app/api/crm/work-orders/[id]/files/route');
const { DELETE } = await import('@/app/api/crm/work-orders/[id]/files/[fileId]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const mockList = vi.mocked(listCrmWorkOrderFiles);
const mockCreate = vi.mocked(createCrmWorkOrderFile);
const mockDelete = vi.mocked(deleteCrmWorkOrderFile);
const mockOnJob = vi.mocked(isUserOnWorkOrder);
const mockFindByPath = vi.mocked(findCrmWorkOrderFileByPath);
const mockUploadUrl = vi.mocked(createWorkOrderFileUploadUrl);
const mockInfo = vi.mocked(readWorkOrderFileInfo);
const mockRemove = vi.mocked(removeWorkOrderFileObject);
const mockSignMany = vi.mocked(signWorkOrderFileUrls);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const FILE_ID = '77777777-7777-4777-8777-777777777777';
// Sökvägen bär uppladdarens id — spärren mot att spela tillbaka någon annans fil.
const PATH = `Arbetsorder/${WORK_ORDER_ID}/${salesUser.id}/uid-ritning.pdf`;
const MEMBER_PATH = `Arbetsorder/${WORK_ORDER_ID}/${memberUser.id}/uid-foto.jpg`;

const ctx = { params: { id: WORK_ORDER_ID } };
const fileCtx = { params: { id: WORK_ORDER_ID, fileId: FILE_ID } };

function jsonReq(payload: unknown) {
  return new Request('http://localhost/api/crm/work-orders/x/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
const getReq = () => new Request('http://localhost/api/crm/work-orders/x/files');

const CONFIRM_BODY = { storage_path: PATH, file_name: 'ritning.pdf', category: 'drawing', is_internal: false };

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    work_order_id: WORK_ORDER_ID,
    category: 'drawing',
    is_internal: false,
    file_name: 'ritning.pdf',
    storage_bucket: 'pdfs',
    storage_path: PATH,
    content_type: 'application/pdf',
    size_bytes: 4000,
    created_by: 'user-sales-1',
    created_by_name: 'Anna Andersson',
    created_at: '2026-08-15T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(salesUser);
  mockPerms.mockImplementation(async () => effectivePermissionsForRole((await mockUser())?.role));
  mockOnJob.mockResolvedValue({ data: false, error: null } as any);
  mockFindByPath.mockResolvedValue({ data: null, error: null } as any);
  mockUploadUrl.mockResolvedValue({ signedUrl: 'https://signed.example/upload', token: 'tok', error: null } as any);
  mockInfo.mockResolvedValue({ size: 4000, contentType: 'application/pdf' });
  mockCreate.mockResolvedValue({ data: fileRow(), error: null } as any);
  mockList.mockResolvedValue({ data: [fileRow()], error: null } as any);
  mockDelete.mockResolvedValue({ data: { id: FILE_ID, storage_bucket: 'pdfs', storage_path: PATH }, error: null } as any);
  mockSignMany.mockResolvedValue(new Map());
});

describe('POST /files/upload-url', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await UPLOAD_URL(jsonReq({ file_name: 'a.pdf', content_type: 'application/pdf', size_bytes: 10 }), ctx)).status).toBe(401);
  });

  it('avvisar en för stor fil INNAN den kostar en storage-runda', async () => {
    const res = await UPLOAD_URL(
      jsonReq({ file_name: 'stor.pdf', content_type: 'application/pdf', size_bytes: 40 * 1024 * 1024 }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it('avvisar fel filtyp innan den kostar en storage-runda', async () => {
    const res = await UPLOAD_URL(
      jsonReq({ file_name: 'kalkyl.xls', content_type: 'application/vnd.ms-excel', size_bytes: 1000 }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it('släpper igenom kontoret', async () => {
    const res = await UPLOAD_URL(jsonReq({ file_name: 'a.pdf', content_type: 'application/pdf', size_bytes: 1000 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { path: expect.stringContaining(`Arbetsorder/${WORK_ORDER_ID}/`) } });
  });

  // konsult är READONLY i hela CRM (crm.workorder.read men inte .write) och är inte besättning.
  it('nekar konsult', async () => {
    mockUser.mockResolvedValue(konsultUser);
    const res = await UPLOAD_URL(jsonReq({ file_name: 'a.pdf', content_type: 'application/pdf', size_bytes: 1000 }), ctx);
    expect(res.status).toBe(403);
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it('släpper igenom en installatör som är besättning på jobbet', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockOnJob.mockResolvedValue({ data: true, error: null } as any);
    expect((await UPLOAD_URL(jsonReq({ file_name: 'foto.jpg', content_type: 'image/jpeg', size_bytes: 1000 }), ctx)).status).toBe(200);
  });

  it('nekar en installatör som inte är på jobbet', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockOnJob.mockResolvedValue({ data: false, error: null } as any);
    expect((await UPLOAD_URL(jsonReq({ file_name: 'foto.jpg', content_type: 'image/jpeg', size_bytes: 1000 }), ctx)).status).toBe(403);
  });
});

describe('POST /files (bekräftelsen)', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await CONFIRM(jsonReq(CONFIRM_BODY), ctx)).status).toBe(401);
  });

  // Utan den här kontrollen kan en klient koppla någon annans fil till sin egen arbetsorder och få
  // den signerad.
  it('nekar en sökväg utanför den egna ordern', async () => {
    const res = await CONFIRM(jsonReq({ ...CONFIRM_BODY, storage_path: 'Support/uid-skarmbild.png' }), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── REGRESSION: läsbehörig användare kunde få kontorets fil raderad ──────────
  //
  // Uppstädningen i den här routen raderar ett lagringsobjekt med service-role-nyckeln. Sökvägen
  // till varje bild går att läsa ut ur den signerade URL:en i listan. En konsult (READONLY, men
  // med crm.workorder.read) kunde alltså läsa kontorets filsökväg, posta tillbaka den, bli nekad
  // av RLS på insert:en — och få kontorets fil borttagen på vägen ut. Raden blev kvar, byten
  // försvann. Två spärrar håller det nu: uppladdarens id i sökvägen, och 409 på en sökväg som
  // redan är registrerad.
  it('nekar en konsult som spelar tillbaka kontorets filsökväg — och rör INTE lagringen', async () => {
    mockUser.mockResolvedValue(konsultUser);
    const res = await CONFIRM(jsonReq({ ...CONFIRM_BODY, storage_path: PATH }), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('nekar en installatör som spelar tillbaka en kollegas filsökväg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockOnJob.mockResolvedValue({ data: true, error: null } as any);
    const res = await CONFIRM(jsonReq({ ...CONFIRM_BODY, storage_path: PATH }), ctx);
    expect(res.status).toBe(400);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  // ── REGRESSION: dubbelregistrering kunde riva en delad fil ───────────────────
  //
  // Även sin EGEN sökväg får bara registreras en gång. Annars kan två rader peka på samma objekt,
  // och den som tar bort sin rad river byten under den andra radens fötter.
  it('svarar 409 på en redan registrerad sökväg och rör inte lagringen', async () => {
    mockFindByPath.mockResolvedValue({ data: { id: 'redan-har' }, error: null } as any);
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('städar inte när det unika indexet nekar insert:en (kapplöpning om samma sökväg)', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } } as any);
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(409);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('nekar när objektet aldrig kom fram till lagringen', async () => {
    mockInfo.mockResolvedValue(null);
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Kärnan i hela tvåstegsflödet: klientens påstående om storleken är inte bindande.
  it('litar på lagringen och inte på klienten om storleken — och städar bort filen', async () => {
    mockInfo.mockResolvedValue({ size: 40 * 1024 * 1024, contentType: 'application/pdf' });
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), expect.any(String), PATH);
  });

  it('tar arbetsordern ur URL:en, inte ur kroppen', async () => {
    await CONFIRM(jsonReq({ ...CONFIRM_BODY, work_order_id: 'nagon-annan-order' }), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ work_order_id: WORK_ORDER_ID });
  });

  it('snapshottar uppladdarens namn på raden', async () => {
    mockUser.mockResolvedValue({ ...salesUser, name: 'Anna Andersson' });
    await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ created_by_name: 'Anna Andersson' });
  });

  it('låter kontoret markera en fil som intern', async () => {
    await CONFIRM(jsonReq({ ...CONFIRM_BODY, is_internal: true }), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ is_internal: true });
  });

  // "Intern" är ett kontorsbegrepp. En installatör ska inte kunna lägga upp något besättningen
  // inte ser — RLS gör om samma kontroll, det här är det snälla svaret.
  it('tvingar is_internal till false för en installatör', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockOnJob.mockResolvedValue({ data: true, error: null } as any);
    await CONFIRM(jsonReq({ ...CONFIRM_BODY, storage_path: MEMBER_PATH, is_internal: true }), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ is_internal: false });
  });

  // z.coerce.boolean() gör Boolean(värde), och Boolean("false") === true. Strängen "false" hade
  // alltså DOLT filen för besättningen — raka motsatsen till vad avsändaren bad om, och tyst.
  it('tolkar strängen "false" som false, inte som true', async () => {
    await CONFIRM(jsonReq({ ...CONFIRM_BODY, is_internal: 'false' }), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ is_internal: false });
  });

  it('tolkar strängen "true" som true', async () => {
    await CONFIRM(jsonReq({ ...CONFIRM_BODY, is_internal: 'true' }), ctx);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ is_internal: true });
  });

  it('städar bort objektet när raden inte kunde skrivas', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { message: 'nekad' } } as any);
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(500);
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), expect.any(String), PATH);
  });

  it('svarar 201 med raden när allt gick igenom', async () => {
    const res = await CONFIRM(jsonReq(CONFIRM_BODY), ctx);
    expect(res.status).toBe(201);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('GET /files', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await LIST(getReq(), ctx)).status).toBe(401);
  });

  it('läcker aldrig sökvägen till klienten', async () => {
    const res = await LIST(getReq(), ctx);
    expect(JSON.stringify(await res.json())).not.toContain('Arbetsorder/');
  });

  it('signerar inte PDF-rader i listan — de öppnas först vid klick', async () => {
    await LIST(getReq(), ctx);
    expect(mockSignMany).toHaveBeenCalledWith(expect.anything(), expect.any(String), []);
  });

  it('batch-signerar bildrader i ETT anrop', async () => {
    const imagePath = `Arbetsorder/${WORK_ORDER_ID}/uid-foto.jpg`;
    mockList.mockResolvedValue({
      data: [fileRow({ content_type: 'image/jpeg', storage_path: imagePath }), fileRow()],
      error: null,
    } as any);
    await LIST(getReq(), ctx);
    expect(mockSignMany).toHaveBeenCalledTimes(1);
    expect(mockSignMany).toHaveBeenCalledWith(expect.anything(), expect.any(String), [imagePath]);
  });

  it('säger till kontoret att det får markera filer som interna', async () => {
    const json = await (await LIST(getReq(), ctx)).json();
    expect(json.data).toMatchObject({ can_upload: true, can_mark_internal: true, can_delete_any: true });
  });

  it('nekar installatören den möjligheten men låter hen ladda upp på sitt jobb', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockOnJob.mockResolvedValue({ data: true, error: null } as any);
    const json = await (await LIST(getReq(), ctx)).json();
    expect(json.data).toMatchObject({ can_upload: true, can_mark_internal: false, can_delete_any: false });
  });
});

describe('DELETE /files/[fileId]', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await DELETE(getReq(), fileCtx)).status).toBe(401);
  });

  // Kontorets undantag uttrycks som att ägarfiltret utelämnas (null), inte som en assert.
  it('låter kontoret radera vad som helst på ordern', async () => {
    await DELETE(getReq(), fileCtx);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), FILE_ID, WORK_ORDER_ID, null);
  });

  it('begränsar installatören till sina egna uppladdningar', async () => {
    mockUser.mockResolvedValue(memberUser);
    await DELETE(getReq(), fileCtx);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), FILE_ID, WORK_ORDER_ID, memberUser.id);
  });

  it('begränsar konsult likaså — läsbehörig är inte raderingsbehörig', async () => {
    mockUser.mockResolvedValue(konsultUser);
    await DELETE(getReq(), fileCtx);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), FILE_ID, WORK_ORDER_ID, konsultUser.id);
  });

  it('svarar 404 när ingen rad matchade, och rör då inte lagringen', async () => {
    mockDelete.mockResolvedValue({ data: null, error: null } as any);
    const res = await DELETE(getReq(), fileCtx);
    expect(res.status).toBe(404);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('städar bort objektet när raden försvann', async () => {
    expect((await DELETE(getReq(), fileCtx)).status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), 'pdfs', PATH);
  });
});
