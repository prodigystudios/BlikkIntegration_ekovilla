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
  return {
    ...actual,
    listCompensations: vi.fn(), createCompensation: vi.fn(), updateCompensation: vi.fn(), deleteCompensation: vi.fn(),
    findCompensationByReceiptPath: vi.fn(), getCompensationReceiptRef: vi.fn(),
  };
});

// Kvittots lagring mockas per funktion, INTE hela modulen: isReceiptPath och buildReceiptPath är
// rena och ska köras på riktigt i de här testerna — det är just ägarspärren vi vill ha bevisad hela
// vägen genom routen, inte en stub som säger ja.
vi.mock('@/lib/domains/time/receipts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/receipts')>();
  return { ...actual, resolveReceiptAttachment: vi.fn(), removeReceiptObject: vi.fn(), createReceiptUploadUrl: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));

vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, explainWriteMiss: vi.fn(), getTimeApproval: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  listCompensations, createCompensation, updateCompensation, deleteCompensation,
  findCompensationByReceiptPath, getCompensationReceiptRef,
} from '@/lib/domains/time/compensations';
import {
  buildReceiptPath, createReceiptUploadUrl, removeReceiptObject, resolveReceiptAttachment,
} from '@/lib/domains/time/receipts';

import { explainWriteMiss, getTimeApproval } from '@/lib/domains/time/approvals';

const { GET, POST } = await import('@/app/api/time/compensations/route');
const { PATCH, DELETE } = await import('@/app/api/time/compensations/[id]/route');
const { POST: UPLOAD_URL } = await import('@/app/api/time/compensations/receipt-upload-url/route');
const { GET: RECEIPT } = await import('@/app/api/time/compensations/[id]/receipt/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCompensations);
const mockCreate = vi.mocked(createCompensation);
const mockUpdate = vi.mocked(updateCompensation);
const mockDelete = vi.mocked(deleteCompensation);
const mockExplain = vi.mocked(explainWriteMiss);
const mockApproval = vi.mocked(getTimeApproval);
const mockTaken = vi.mocked(findCompensationByReceiptPath);
const mockReceiptRef = vi.mocked(getCompensationReceiptRef);
const mockResolve = vi.mocked(resolveReceiptAttachment);
const mockRemoveObject = vi.mocked(removeReceiptObject);
const mockUploadUrl = vi.mocked(createReceiptUploadUrl);

const ITEM_ID = '44444444-4444-4444-8444-444444444444';

// Sökvägen byggs med den RIKTIGA funktionen och medlemsanvändarens id, så ägarspärren prövas på
// samma villkor som i drift.
const ownPath = () => buildReceiptPath(memberUser.id, 'kvitto.jpg', 'abc');
const RECEIPT_COLUMNS = {
  receipt_bucket: 'pdfs',
  receipt_path: ownPath(),
  receipt_name: 'kvitto.jpg',
  receipt_content_type: 'image/jpeg',
  receipt_size_bytes: 40_000,
  receipt_uploaded_at: '2026-08-22T10:00:00.000Z',
};
const EXPENSE = { entry_date: '2026-08-14', kind: 'expense', amount: 249 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockList.mockResolvedValue({ data: [], error: null } as any);
  mockCreate.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
  mockUpdate.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
  mockDelete.mockResolvedValue({ data: { id: ITEM_ID, receipt_bucket: null, receipt_path: null }, error: null } as any);
  mockExplain.mockResolvedValue({ locked: false });
  mockApproval.mockResolvedValue({ data: null, error: null } as any);
  mockTaken.mockResolvedValue({ data: null, error: null } as any);
  mockReceiptRef.mockResolvedValue({ data: null, error: null } as any);
  mockResolve.mockResolvedValue({ ok: true, columns: RECEIPT_COLUMNS } as any);
  mockUploadUrl.mockResolvedValue({ signedUrl: 'https://storage/signed', token: 'tok', error: null });
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
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), memberUser.id, expect.objectContaining({ kind: 'travel' }));
  });

  it('nollar kvantitet på utlägg — beloppet är hela sanningen där', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', { entry_date: '2026-08-14', kind: 'expense', quantity: 3, amount: 89 })));
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ quantity: null });
  });

  /**
   * ⚠️ BELOPPET ÄR UTLÄGGETS ENSAK sedan 2026-09-01 (William: traktamente och milersättning ersätts
   * med FASTA SATSER som lönebyrån äger). Fältet är borta ur formuläret, men regeln måste hålla i
   * routen också — annars räcker ett handskrivet anrop för att sätta kronor på en milersättning som
   * lönen redan ersätter, och personen får betalt två gånger.
   *
   * TRAVEL-fixturen bär med flit fortfarande ett belopp: det är just det som ska nollas.
   */
  it('nollar beloppet på milersättning och traktamente — de har fast sats', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', TRAVEL)));
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ kind: 'travel', amount: 0, quantity: 12.5 });

    mockCreate.mockClear();
    await POST(req('/api/time/compensations', jsonReq('POST', { entry_date: '2026-08-14', kind: 'per_diem', quantity: 3, amount: 780 })));
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ kind: 'per_diem', amount: 0, quantity: 3 });
  });

  it('släpper igenom beloppet på ett utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', EXPENSE)));
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ kind: 'expense', amount: 249 });
  });

  /**
   * Varje post måste BÄRA något. Utlägget säger det med sitt belopp, milersättningen med sitt antal
   * — och utan sitt fält är posten en rad som bara säger "en milersättning, någon gång".
   *
   * Kvantitetskravet är nytt och kom med att beloppsfältet försvann: innan dess bar en milersättning
   * utan antal åtminstone ett belopp.
   */
  it('kräver antal på de fasta sorterna och belopp på utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    const { quantity, ...travelUtanAntal } = TRAVEL;
    expect((await POST(req('/api/time/compensations', jsonReq('POST', travelUtanAntal)))).status).toBe(400);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...TRAVEL, quantity: 0 })))).status).toBe(400);

    const { amount, ...utlaggUtanBelopp } = EXPENSE;
    expect((await POST(req('/api/time/compensations', jsonReq('POST', utlaggUtanBelopp)))).status).toBe(400);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...EXPENSE, amount: 0 })))).status).toBe(400);

    expect(mockCreate).not.toHaveBeenCalled();
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

// ── Kvitton ──────────────────────────────────────────────────────────────────

describe('POST /api/time/compensations/receipt-upload-url', () => {
  it('kräver skrivrätt på tid', async () => {
    mockUser.mockResolvedValue(konsultUser);
    const body = jsonReq('POST', { file_name: 'k.jpg', content_type: 'image/jpeg', size_bytes: 1000, entry_date: '2026-08-14' });
    expect((await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', body))).status).toBe(403);
  });

  it('myntar en sökväg under den EGNA katalogen — aldrig ur kroppen', async () => {
    mockUser.mockResolvedValue(memberUser);
    const body = jsonReq('POST', {
      file_name: 'k.jpg', content_type: 'image/jpeg', size_bytes: 1000, entry_date: '2026-08-14',
      // Ett försök att peka ut någon annans katalog. Fältet finns inte i schemat och ska inte ha
      // någon som helst verkan — ägaren tas ur SESSIONEN.
      user_id: 'user-annan',
    });
    const res = await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.path.startsWith(`Kvitton/${memberUser.id}/`)).toBe(true);
    expect(json.data.token).toBe('tok');
  });

  it('avvisar en fil som redan på pappret är för stor eller av fel typ', async () => {
    mockUser.mockResolvedValue(memberUser);
    const tooBig = jsonReq('POST', { file_name: 'k.jpg', content_type: 'image/jpeg', size_bytes: 40_000_000, entry_date: '2026-08-14' });
    expect((await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', tooBig))).status).toBe(400);

    const wrongType = jsonReq('POST', { file_name: 'k.zip', content_type: 'application/zip', size_bytes: 1000, entry_date: '2026-08-14' });
    expect((await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', wrongType))).status).toBe(400);

    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ LÅSET FRÅGAS FÖRE UPPLADDNINGEN, inte bara vid sparningen.
   *
   * Databasens trigger stoppar skrivningen ändå — det är den spärr som gäller. Men utan den här
   * kontrollen laddar den anställde upp ett kvitto över 4G och får sitt "månaden är inlämnad"
   * EFTERÅT, med bytena betalda och ett objekt kvar i bucketen som ingen rad någonsin pekar på.
   */
  it('nekar innan uppladdningen när perioden är inlämnad', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockApproval.mockResolvedValue({ data: { status: 'submitted' }, error: null } as any);

    const body = jsonReq('POST', { file_name: 'k.jpg', content_type: 'image/jpeg', size_bytes: 1000, entry_date: '2026-08-14' });
    const res = await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', body));

    expect(res.status).toBe(409);
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it('släpper igenom en attesterad periods grannmånad', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockApproval.mockResolvedValue({ data: { status: 'open' }, error: null } as any);
    const body = jsonReq('POST', { file_name: 'k.jpg', content_type: 'image/jpeg', size_bytes: 1000, entry_date: '2026-08-14' });
    expect((await UPLOAD_URL(req('/api/time/compensations/receipt-upload-url', body))).status).toBe(200);
  });
});

describe('POST /api/time/compensations — kvitto och moms', () => {
  it('sparar kvittots kolumner ur LAGRINGEN, inte ur kroppen', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', {
      ...EXPENSE,
      vat_amount: 49.8,
      receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
      // Påhittade värden som ALDRIG får nå databasen — servern läser dem ur storage.
      receipt_size_bytes: 1, receipt_content_type: 'text/html',
    })));

    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), memberUser.id, expect.objectContaining({
      vat_amount: 49.8,
      receipt_path: ownPath(),
      receipt_content_type: 'image/jpeg',
      receipt_size_bytes: 40_000,
    }));
  });

  it('nollar moms och kvitto på sorter som inte är utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', {
      ...TRAVEL, vat_amount: 50, receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
    })));

    const input = mockCreate.mock.calls[0][2] as Record<string, unknown>;
    expect(input.vat_amount).toBeNull();
    expect(input.receipt_path).toBeUndefined();
    // Objektet hörde ingenstans — det ska inte bli liggande i bucketen.
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());
  });

  it('avvisar ett kvitto som redan bärs av en annan post', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockTaken.mockResolvedValue({ data: { id: 'annan-post' }, error: null } as any);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', {
      ...EXPENSE, receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
    })));

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
    // ⚠️ INGEN STÄDNING. Objektet tillhör den andra postens rad — att radera det här hade tagit bort
    // ett kvitto som faktiskt hör till något.
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('avvisar en sökväg som inte är användarens egen', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockResolve.mockResolvedValue({ ok: false, status: 400, error: 'Kvittot hör inte till dig.' } as any);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', {
      ...EXPENSE, receipt: { storage_path: 'Kvitton/nagon-annan/abc-kvitto.jpg', file_name: 'kvitto.jpg' },
    })));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  /**
   * Regression: en misslyckad skrivning får inte lämna kvittot kvar.
   *
   * Bilden ligger redan i bucketen när routen körs. Utan städningen växer lagringen med ett
   * oåtkomligt objekt för varje låst period, varje momsfel och varje nätverkshaveri — och de
   * objekten bär personuppgifter som ingen rad längre pekar på.
   */
  it('städar bort kvittot när posten inte gick att spara', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Perioden är inlämnad' } } as any);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', {
      ...EXPENSE, receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
    })));

    expect(res.status).toBe(409);
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());
  });

  it('lämnar kvittot i fred när kapplöpningen om unika indexet förlorades', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } } as any);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', {
      ...EXPENSE, receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
    })));

    expect(res.status).toBe(409);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('översätter momsvillkoret till ett 400 i stället för ett 500', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockCreate.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'violates check constraint "crm_time_compensations_vat_amount_chk"' },
    } as any);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', { ...EXPENSE, vat_amount: 500 })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/moms/i);
  });

  it('avvisar en negativ moms i valideringen', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await POST(req('/api/time/compensations', jsonReq('POST', { ...EXPENSE, vat_amount: -1 })))).status).toBe(400);
  });

  // Moms som inte fylls i är NULL, inte 0. Skillnaden är hela poängen för den som bokför: en nolla
  // påstår att utlägget är momsfritt.
  it('skickar null när momsen utelämnas', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', EXPENSE)));
    expect((mockCreate.mock.calls[0][2] as Record<string, unknown>).vat_amount).toBeNull();
  });
});

describe('PATCH /api/time/compensations/[id] — kvitto i efterhand', () => {
  it('kopplar kvittot och tar bort det gamla objektet EFTER att raden pekat om', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, receipt_bucket: 'pdfs', receipt_path: 'Kvitton/user-member-1/gammalt.jpg' },
      error: null,
    } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), ITEM_ID, memberUser.id, expect.objectContaining({
      receipt_path: ownPath(), receipt_content_type: 'image/jpeg',
    }));
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), 'pdfs', 'Kvitton/user-member-1/gammalt.jpg');
  });

  // Regression: `{receipt: ...}` är det enda fält som lämnar patchen TOMMARE än det kom in — det
  // plockas ut och ersätts av kolumner. En tomhetskontroll före den hanteringen hade skickat en
  // `.update({})` mot PostgREST.
  it('svarar 400 på en kropp som bara innehåller ett tomt kvitto', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { receipt: null })), { params: { id: ITEM_ID } });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('städar bort det nya kvittot när uppdateringen inte träffade någon rad', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'Augusti 2026 är inlämnad.' });

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(409);
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());
  });

  it('avvisar ett kvitto som bärs av en ANNAN post, men godtar omtag på den egna', async () => {
    mockUser.mockResolvedValue(memberUser);
    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });

    mockTaken.mockResolvedValue({ data: { id: 'annan-post' }, error: null } as any);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } })).status).toBe(409);

    // Samma post, samma sökväg = ett ofarligt omtag (dubbeltryck, tappad uppkoppling). Att svara 409
    // där hade gjort en lyckad handling till ett fel användaren måste tolka.
    mockTaken.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } })).status).toBe(200);
  });
});

describe('DELETE /api/time/compensations/[id] — kvittot följer med', () => {
  it('raderar lagringsobjektet när posten hade ett kvitto', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockDelete.mockResolvedValue({
      data: { id: ITEM_ID, receipt_bucket: 'pdfs', receipt_path: ownPath() }, error: null,
    } as any);

    const res = await DELETE(req(`/api/time/compensations/${ITEM_ID}`), { params: { id: ITEM_ID } });

    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(ITEM_ID);
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), 'pdfs', ownPath());
  });

  it('rör inte lagringen när posten saknade kvitto', async () => {
    mockUser.mockResolvedValue(memberUser);
    await DELETE(req(`/api/time/compensations/${ITEM_ID}`), { params: { id: ITEM_ID } });
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });
});

describe('GET /api/time/compensations/[id]/receipt', () => {
  it('kräver inloggning och ett giltigt id', async () => {
    mockUser.mockResolvedValue(null);
    expect((await RECEIPT(req(`/api/time/compensations/${ITEM_ID}/receipt`), { params: { id: ITEM_ID } })).status).toBe(401);

    mockUser.mockResolvedValue(memberUser);
    // 400 och inte 404: ett trasigt id är en felformad förfrågan, och utan invalidUuidParam blir det
    // ett 500 med rå Postgres-text. Samma svar som PATCH och DELETE ger på samma id.
    expect((await RECEIPT(req('/api/time/compensations/x/receipt'), { params: { id: 'x' } })).status).toBe(400);
  });

  /**
   * ⚠️ SAMMA 404 FÖR TRE OLIKA SAKER: posten finns inte, du får inte se den, den har inget kvitto.
   *
   * De två första är RLS-frågor som inte ska gå att skilja åt utifrån — ett 403 på en post man inte
   * äger hade bekräftat att den finns. Den tredje är ett helt normalt tillstånd, eftersom ett utlägg
   * utan kvitto går att spara med flit.
   */
  it('svarar 404 när raden inte är läsbar eller saknar kvitto', async () => {
    mockUser.mockResolvedValue(memberUser);

    mockReceiptRef.mockResolvedValue({ data: null, error: null } as any);
    expect((await RECEIPT(req(`/api/time/compensations/${ITEM_ID}/receipt`), { params: { id: ITEM_ID } })).status).toBe(404);

    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, receipt_path: null }, error: null } as any);
    expect((await RECEIPT(req(`/api/time/compensations/${ITEM_ID}/receipt`), { params: { id: ITEM_ID } })).status).toBe(404);
  });

  // Läsningen är INTE ägarskopad: attestansvarig ska kunna öppna kvittot, och den avgränsningen görs
  // av RLS på tabellen (time.entry.read.all) — inte av ett eq('user_id') här. Ett filter hade gjort
  // routen oanvändbar för attesten och tvingat fram en andra, parallell route.
  it('frågar utan ägarfilter så attesten kan öppna kvittot', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, receipt_bucket: 'pdfs', receipt_path: ownPath(), receipt_name: 'kvitto.jpg' }, error: null,
    } as any);

    await RECEIPT(req(`/api/time/compensations/${ITEM_ID}/receipt`), { params: { id: ITEM_ID } });
    expect(mockReceiptRef).toHaveBeenCalledWith(expect.anything(), ITEM_ID);
  });
});

describe('PATCH /api/time/compensations/[id] — sortbyte bort från utlägg', () => {
  /**
   * Regression: moms OCH kvitto måste falla när posten slutar vara ett utlägg.
   *
   * En kvarlämnad moms bokförs på en milersättning som inte bär någon. Ett kvarlämnat receipt_name
   * utan att objektet städas ger en post som SER styrkt ut i attesten medan bilden ligger kvar i
   * bucketen — och en halv nollning (namnet borta, sökvägen kvar) hade gett motsatsen: en post utan
   * synligt kvitto vars objekt aldrig kan städas.
   */
  it('nollar alla kvittokolumner och momsen, och tar bort objektet', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, receipt_bucket: 'pdfs', receipt_path: ownPath() }, error: null,
    } as any);

    const body = jsonReq('PATCH', { kind: 'travel', quantity: 10 });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(200);
    const patch = mockUpdate.mock.calls[0][3] as Record<string, unknown>;
    expect(patch.vat_amount).toBeNull();
    expect(patch.receipt_path).toBeNull();
    expect(patch.receipt_name).toBeNull();
    expect(patch.receipt_bucket).toBeNull();
    expect(patch.receipt_content_type).toBeNull();
    expect(patch.receipt_size_bytes).toBeNull();
    expect(patch.receipt_uploaded_at).toBeNull();
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), 'pdfs', ownPath());
  });

  it('avvisar ett kvitto som skickas i samma andetag som sortbytet', async () => {
    mockUser.mockResolvedValue(memberUser);
    const body = jsonReq('PATCH', { kind: 'travel', receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Ett sortbyte TILL utlägg rör inte kvittofälten — posten hade inget, och nollningen hör bara
  // till vägen ut.
  //
  // ⚠️ Beloppet kom med i kroppen 2026-09-01: ett sortbyte måste ta med sig den nya sortens bärande
  // fält, annars svarar routen 400 innan den hinner till kvittofälten. Testets ärende är oförändrat.
  it('lämnar kvittofälten i fred vid byte till utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { kind: 'expense', amount: 249 })), { params: { id: ITEM_ID } });

    const patch = mockUpdate.mock.calls[0][3] as Record<string, unknown>;
    expect('receipt_path' in patch).toBe(false);
    expect(patch.quantity).toBeNull();
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });
});

// ── Granskningsfynd 2026-08-22 ───────────────────────────────────────────────
// Fem verifierade fynd, alla i städningsvägarna. De är destruktiva och kör med service-role, så
// varje ett av dem har ett eget regressionstest nedan.

describe('granskningsfynd — städningen får aldrig röra andras objekt', () => {
  /**
   * ⚠️ FYND 1 (allvarligast): godtycklig radering i den delade bucketen.
   *
   * Grenen "kvitto på en sort som inte är utlägg" skickade sökvägen RAKT ur kroppen till
   * removeReceiptObject, som kör med service-role och inte frågar vem som äger objektet. En enda
   * POST räckte för att radera en arbetsorderritning, ett dokument ur biblioteket eller en kollegas
   * kvitto — och svaret blev 201, så ingenting såg fel ut.
   */
  it('raderar INTE ett objekt utanför den egna katalogen när sorten inte kan bära kvitto', async () => {
    mockUser.mockResolvedValue(memberUser);

    const res = await POST(req('/api/time/compensations', jsonReq('POST', {
      ...TRAVEL,
      receipt: { storage_path: 'Arbetsorder/nagon-order/nagon-annan/ritning.pdf', file_name: 'ritning.pdf' },
    })));

    expect(res.status).toBe(201);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('städar däremot bort ett eget kvitto som hamnade på fel sort', async () => {
    mockUser.mockResolvedValue(memberUser);
    await POST(req('/api/time/compensations', jsonReq('POST', {
      ...TRAVEL, receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' },
    })));
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());
  });

  /**
   * FYND 2: 23505-grenen städade objektet som dess egen kommentar kallade orörbart.
   *
   * Städningen låg tre rader ovanför kontrollen. Vann någon annan kapplöpningen om sökvägen pekade
   * DERAS rad på ett objekt vi just raderat.
   */
  it('lämnar objektet i fred när unika indexet slog till i PATCH', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockUpdate.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(409);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  /**
   * FYND 3: ett omtag kunde radera kvittot ur en rad som fortfarande refererade det.
   *
   * Routen godtar med flit att samma sökväg skickas igen för en post som redan bär den (dubbeltryck,
   * tappad uppkoppling). Misslyckas uppdateringen strax efter — månaden hann låsas — får städningen
   * inte röra objektet: den SPARADE raden pekar på det.
   */
  it('raderar inte ett kvitto som posten redan äger, när omtaget misslyckas', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockTaken.mockResolvedValue({ data: { id: ITEM_ID }, error: null } as any);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, kind: 'expense', receipt_bucket: 'pdfs', receipt_path: ownPath() }, error: null,
    } as any);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'Augusti 2026 är inlämnad.' });

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(409);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('städar däremot bort ett NYTT kvitto när uppdateringen misslyckas', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, kind: 'expense', receipt_bucket: 'pdfs', receipt_path: 'Kvitton/user-member-1/gammalt.jpg' },
      error: null,
    } as any);
    mockUpdate.mockResolvedValue({ data: null, error: null } as any);
    mockExplain.mockResolvedValue({ locked: true, message: 'Augusti 2026 är inlämnad.' });

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());
    // Det GAMLA objektet ska INTE röras — raden pekar fortfarande på det.
    expect(mockRemoveObject).not.toHaveBeenCalledWith(expect.anything(), expect.any(String), 'Kvitton/user-member-1/gammalt.jpg');
  });

  /**
   * FYND 5: moms kunde skrivas på en milersättning.
   *
   * POST avgör sorten ur kroppen, men en PATCH som bara skickar `{vat_amount}` säger ingenting om
   * vilken sorts post den träffar. Utan att läsa radens kind hamnade momsen på en milersättning,
   * renderades som "varav moms" i attesten och summerades in i den sortens momstotal. Databasen har
   * inget villkor som hindrar det.
   */
  it('nollar moms som patchas på en post som inte är utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'travel', receipt_path: null }, error: null } as any);

    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { vat_amount: 50 })), { params: { id: ITEM_ID } });

    expect((mockUpdate.mock.calls[0][3] as Record<string, unknown>).vat_amount).toBeNull();
  });

  it('släpper igenom moms på ett utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);

    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { vat_amount: 50 })), { params: { id: ITEM_ID } });

    expect((mockUpdate.mock.calls[0][3] as Record<string, unknown>).vat_amount).toBe(50);
  });

  it('avvisar ett kvitto som kopplas till en befintlig post av fel sort', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'per_diem', receipt_path: null }, error: null } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ DEN HÄR REGELN VÄNDE 2026-09-01, och det är avsiktligt.
   *
   * Testet hette "läser inte raden i onödan vid en ren beloppsrättelse" och vaktade att en
   * `PATCH {amount}` slapp en extra rundtur — riktigt så länge beloppet var gemensamt för alla
   * sorter. Sedan beloppet blev utläggets ensak (carriesAmount) är det samma sorts fält som momsen,
   * och sorten måste läsas: annars sätter ett handskrivet `PATCH {"amount": 500}` kronor på en
   * milersättning som lönen redan ersätter med fast sats.
   *
   * Den billiga vägen finns kvar för det som inte är sortberoende — datum, antal, anteckning.
   */
  it('läser raden vid en beloppsrättelse — beloppet är sortberoende', async () => {
    mockUser.mockResolvedValue(memberUser);
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 100 })), { params: { id: ITEM_ID } });
    expect(mockReceiptRef).toHaveBeenCalled();
  });

  it('läser inte raden när patchen inte rör något sortberoende fält', async () => {
    mockUser.mockResolvedValue(memberUser);
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { note: 'Parkering Uppsala' })), { params: { id: ITEM_ID } });
    expect(mockReceiptRef).not.toHaveBeenCalled();
  });

  it('nollar ett belopp som patchas på en post som inte är utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'travel', receipt_path: null }, error: null } as any);

    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 500 })), { params: { id: ITEM_ID } });

    expect((mockUpdate.mock.calls[0][3] as Record<string, unknown>).amount).toBe(0);
  });

  it('släpper igenom ett belopp på ett utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);

    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 500 })), { params: { id: ITEM_ID } });

    expect((mockUpdate.mock.calls[0][3] as Record<string, unknown>).amount).toBe(500);
  });

  // En post ska inte kunna patchas TOM på det den bär. Prövas bara när sorten är känd, alltså när
  // raden ändå lästs — se noten i routen om varför en ensam `{quantity: 0}` släpps igenom.
  it('avvisar en patch som lämnar posten utan det den bär', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);

    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { amount: 0 })), { params: { id: ITEM_ID } });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Ett sortbyte utan den nya sortens fält är den korta vägen till en tom post, och den går åt
   * BÅDA hållen: `{kind:'travel'}` på ett utlägg nollar beloppet och ärver kvantiteten null,
   * `{kind:'expense'}` på en milersättning nollar kvantiteten och ärver beloppet 0.
   */
  it('kräver den nya sortens bärande fält vid ett sortbyte', async () => {
    mockUser.mockResolvedValue(memberUser);

    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { kind: 'travel' })), { params: { id: ITEM_ID } })).status).toBe(400);

    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'travel', receipt_path: null }, error: null } as any);
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { kind: 'expense' })), { params: { id: ITEM_ID } })).status).toBe(400);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Kvittokopplingen är den enda PATCH gränssnittet faktiskt gör — den får inte fångas av kravet
  // ovan bara för att posten är ett utlägg som inte skickar sitt belopp igen.
  it('rör inte en ren kvittokoppling', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  // Byter posten sort bort från utlägg måste beloppet falla med momsen och kvittot — annars blir
  // raden en milersättning som bär utläggets kronor och ersätts två gånger.
  it('släpper beloppet när posten byter sort bort från utlägg', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'expense', receipt_path: null }, error: null } as any);

    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { kind: 'travel', quantity: 10 })), { params: { id: ITEM_ID } });

    const patch = mockUpdate.mock.calls[0][3] as Record<string, unknown>;
    expect(patch.amount).toBe(0);
    expect(patch.vat_amount).toBeNull();
  });
});

describe('granskningsfynd runda 2 — det gamla kvittot får bara städas när raden släppt det', () => {
  /**
   * ⚠️ REGRESSION FRÅN EN TIDIGARE RÄTTNING, inte från ursprungskoden.
   *
   * När radläsningen vidgades för att kunna hålla "moms bara på utlägg" laddades `oldReceipt`
   * plötsligt även för en ren momsrättelse. Städningens villkor — "vi har en gammal sökväg och den
   * skiljer sig från den nya" — blev då sant för `PATCH {vat_amount}` på ett utlägg som redan hade
   * kvitto: bilden raderades medan raden behöll sitt receipt_path. Posten visade fortsatt "Visa
   * kvitto", länken svarade 500, och kvittot var borta för gott.
   */
  it('rör inte kvittot vid en ren momsrättelse på ett utlägg som redan har ett', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, kind: 'expense', receipt_bucket: 'pdfs', receipt_path: ownPath() }, error: null,
    } as any);

    const res = await PATCH(req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { vat_amount: 25 })), { params: { id: ITEM_ID } });

    expect(res.status).toBe(200);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('rör inte kvittot när kroppen bär ett tomt receipt bredvid ett annat fält', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, kind: 'expense', receipt_bucket: 'pdfs', receipt_path: ownPath() }, error: null,
    } as any);

    const res = await PATCH(
      req(`/api/time/compensations/${ITEM_ID}`, jsonReq('PATCH', { receipt: null, note: 'parkering' })),
      { params: { id: ITEM_ID } },
    );

    expect(res.status).toBe(200);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('städar bort det gamla kvittot när ett NYTT ersätter det', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({
      data: { id: ITEM_ID, kind: 'expense', receipt_bucket: 'pdfs', receipt_path: 'Kvitton/user-member-1/gammalt.jpg' },
      error: null,
    } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } });

    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), 'pdfs', 'Kvitton/user-member-1/gammalt.jpg');
  });

  // Fynd 3: ett kvitto som avvisas för att sorten är fel ligger redan i bucketen och ska städas —
  // men bara efter att ägarskapet prövats, eftersom raderingen kör med service-role.
  it('städar bort ett kvitto som avvisas för fel sort, men bara den egna katalogen', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockReceiptRef.mockResolvedValue({ data: { id: ITEM_ID, kind: 'travel', receipt_path: null }, error: null } as any);

    const body = jsonReq('PATCH', { receipt: { storage_path: ownPath(), file_name: 'kvitto.jpg' } });
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, body), { params: { id: ITEM_ID } })).status).toBe(400);
    expect(mockRemoveObject).toHaveBeenCalledWith(expect.anything(), expect.any(String), ownPath());

    mockRemoveObject.mockClear();
    const foreign = jsonReq('PATCH', { receipt: { storage_path: 'Arbetsorder/x/y/ritning.pdf', file_name: 'r.pdf' } });
    expect((await PATCH(req(`/api/time/compensations/${ITEM_ID}`, foreign), { params: { id: ITEM_ID } })).status).toBe(400);
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });
});
