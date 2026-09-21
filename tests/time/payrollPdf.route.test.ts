import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, ekonomiUser, memberUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';
import type { PermissionKey } from '@/lib/auth/permissions';

// GET /api/admin/time/payroll-pdf — månadens löneunderlag som PDF.
//
// Det som prövas här är gränsen och fogen, inte layouten (den bor i payrollPdf.test.ts): att bara
// den som får läsa andras tid OCH känner namnen kommer in, att urvalet följer det som begärdes, och
// att hela personalens månad faktiskt bläddras igenom i stället för att kapas vid tusen rader.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/time/entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/entries')>();
  return { ...actual, listTimeEntries: vi.fn() };
});

vi.mock('@/lib/domains/time/compensations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/compensations')>();
  return { ...actual, listCompensations: vi.fn() };
});

vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, listTimeApprovalOverview: vi.fn() };
});

// Renderaren körs INTE i de här testerna: den läser typsnitt från disk och tar ~50 ms per anrop.
// Det som spelar roll här är VAD den får — underlaget som skickas in är routens hela produkt.
vi.mock('@/lib/domains/time/payrollPdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/payrollPdf')>();
  return { ...actual, renderPayrollPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])) };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listTimeEntries } from '@/lib/domains/time/entries';
import { listCompensations } from '@/lib/domains/time/compensations';
import { listTimeApprovalOverview } from '@/lib/domains/time/approvals';
import { renderPayrollPdf } from '@/lib/domains/time/payrollPdf';

const { GET } = await import('@/app/api/admin/time/payroll-pdf/route');

const mockUser = vi.mocked(getCurrentUser);
const mockEntries = vi.mocked(listTimeEntries);
const mockCompensations = vi.mocked(listCompensations);
const mockOverview = vi.mocked(listTimeApprovalOverview);
const mockRender = vi.mocked(renderPayrollPdf);

// ⚠️ ANNAS id MÅSTE bära hex-BOKSTÄVER. Ett uuid av enbart siffror är oförändrat av `toUpperCase`,
// och skiftlägesprovet nedan blir då tomt — det såg grönt ut medan spärren var borttagen.
const ANNA = '4a4a4a4a-bbbb-4ccc-8ddd-eeeeffff0000';
const BJORN = '55555555-5555-4555-8555-555555555555';

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

const URL_OK = '/api/admin/time/payroll-pdf?period=2026-08';

const overviewRow = (userId: string, fullName: string) => ({
  user_id: userId,
  full_name: fullName,
  role: 'member',
  status: 'open',
  submitted_at: null,
  approved_at: null,
  approved_by: null,
  approved_by_name: null,
  note: null,
  work_minutes: 0,
  absence_minutes: 0,
  entry_count: 0,
  compensation_amount: 0,
  compensation_count: 0,
});

const shiftRow = (userId: string, workDate = '2026-08-14') => ({
  id: `e-${userId}-${workDate}`,
  user_id: userId,
  kind: 'work_order',
  work_date: workDate,
  start_time: '08:00:00',
  end_time: '18:00:00',
  break_minutes: 60,
  minutes_worked: 540,
  hours: 9,
  note: null,
  source: 'crm',
  work_order: { id: 'wo1', order_number: 'AO-1', fortnox_order_number: null, project_name: 'Villa Ek', client_name: 'Ekbergs' },
  time_code: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockOverview.mockResolvedValue({ data: [overviewRow(ANNA, 'Anna Andersson'), overviewRow(BJORN, 'Björn Ek')], error: null } as any);
  mockEntries.mockResolvedValue({ data: [], error: null } as any);
  mockCompensations.mockResolvedValue({ data: [], error: null } as any);
  mockRender.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
});

describe('GET /api/admin/time/payroll-pdf — åtkomst', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req(URL_OK))).status).toBe(401);
  });

  it('nekar installatör, säljare och konsult', async () => {
    for (const user of [memberUser, salesUser, konsultUser]) {
      mockUser.mockResolvedValue(user);
      expect((await GET(req(URL_OK))).status).toBe(403);
    }
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('släpper igenom admin och lönebyrån', async () => {
    for (const user of [adminUser, ekonomiUser]) {
      mockUser.mockResolvedValue(user);
      expect((await GET(req(URL_OK))).status).toBe(200);
    }
  });

  // ⚠️ BÅDA NYCKLARNA. `time.entry.read.all` är den RLS öppnar andras tidrader på; `time.approve`
  // är den RPC:n som bär NAMNEN kräver. Med bara den första hade dokumentet blivit en bunt sidor
  // utan namn, eller ett 500 ur en RPC som nekade — ingetdera är ett begripligt besked.
  it('nekar den som har read.all men INTE time.approve', async () => {
    mockUser.mockResolvedValue(adminUser);
    vi.mocked(getEffectivePermissions).mockResolvedValue(new Set<PermissionKey>(['time.entry.read.all']));
    expect((await GET(req(URL_OK))).status).toBe(403);
    expect(mockOverview).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('nekar den som har time.approve men INTE read.all', async () => {
    mockUser.mockResolvedValue(adminUser);
    vi.mocked(getEffectivePermissions).mockResolvedValue(new Set<PermissionKey>(['time.approve']));
    // Noll rader hade sett likadant ut som "har inte rapporterat något" — hellre ett nekande.
    expect((await GET(req(URL_OK))).status).toBe(403);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('svarar med en HTML-sida i stället för JSON när nekandet landar i en flik', async () => {
    // Dokumentet öppnas med window.open, så felet hamnar i fliken. Rå JSON där är obegripligt.
    mockUser.mockResolvedValue(memberUser);
    const res = await GET(new Request(`http://localhost${URL_OK}`, { headers: { 'sec-fetch-dest': 'document' } }));
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});

describe('GET /api/admin/time/payroll-pdf — inmatning', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('kräver en period', async () => {
    expect((await GET(req('/api/admin/time/payroll-pdf'))).status).toBe(400);
  });

  // '2026-13' matchar `\d{2}` men blir datumet '2026-13-01' och ett Postgres-fel — alltså ett 500
  // för en ren inmatningsmiss. Samma fälla som redan kostat på attestroutens period.
  it('avvisar en period som inte är en riktig månad', async () => {
    expect((await GET(req('/api/admin/time/payroll-pdf?period=2026-13'))).status).toBe(400);
    expect((await GET(req('/api/admin/time/payroll-pdf?period=2026-08-14'))).status).toBe(400);
  });

  it('avvisar ett user_id som inte är ett uuid', async () => {
    expect((await GET(req('/api/admin/time/payroll-pdf?period=2026-08&user_id=anna'))).status).toBe(400);
    expect((await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_ids=${ANNA},anna`))).status).toBe(400);
    expect(mockRender).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/time/payroll-pdf — urvalet', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('skriver ut HELA översikten när ingen person angetts', async () => {
    await GET(req(URL_OK));
    expect(mockRender.mock.calls[0][0].people.map((p) => p.userId)).toEqual([ANNA, BJORN]);
  });

  it('skriver ut en enda person och hämtar då bara hennes rader', async () => {
    await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_id=${ANNA}`));
    const people = mockRender.mock.calls[0][0].people;
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Anna Andersson');
    // Skopad hämtning: en person behöver inte hela personalens månad.
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), { from: '2026-08-01', to: '2026-08-31' }, expect.objectContaining({ userId: ANNA }));
  });

  it('följer ordningen i user_ids — listan på skärmen är sorterad', async () => {
    await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_ids=${BJORN},${ANNA}`));
    expect(mockRender.mock.calls[0][0].people.map((p) => p.userId)).toEqual([BJORN, ANNA]);
  });

  it('hämtar OFILTRERAT när flera personer begärts', async () => {
    await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_ids=${ANNA},${BJORN}`));
    // ⚠️ `userId: undefined`, inte en lista: ett anrop per person hade blivit femtio rundturer för
    // en tjugomannastyrka, och RLS (read.all) släpper redan igenom allas rader.
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ userId: undefined }));
  });

  it('gemener på id:t — annars faller personens rader bort tyst', async () => {
    // 🧨 `zod.uuid()` släpper igenom versaler och Postgres jämför `uuid` skiftlägesokänsligt, så
    // databasen svarar med rader — men summarizePersons strikta `entry.userId === userId`
    // filtrerar bort dem allihop. Utfallet: ett TOMT underlag med status 200 för någon som
    // rapporterat hela månaden. Fällan har redan kostat en gång på dagvyns route.
    mockEntries.mockResolvedValue({ data: [shiftRow(ANNA)], error: null } as any);
    await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_id=${ANNA.toUpperCase()}`));
    const person = mockRender.mock.calls[0][0].people[0];
    expect(person.userId).toBe(ANNA);
    expect(person.summary.workMinutes).toBe(540);
  });

  it('ignorerar ett id som inte finns i periodens översikt', async () => {
    const stranger = '66666666-6666-4666-8666-666666666666';
    await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_ids=${ANNA},${stranger}`));
    expect(mockRender.mock.calls[0][0].people.map((p) => p.userId)).toEqual([ANNA]);
  });

  it('svarar 404 när ingen av de valda finns kvar i underlaget', async () => {
    const stranger = '66666666-6666-4666-8666-666666666666';
    expect((await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_ids=${stranger}`))).status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/time/payroll-pdf — underlaget', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('delar ut varje persons rader till rätt person', async () => {
    mockEntries.mockResolvedValue({ data: [shiftRow(ANNA), shiftRow(BJORN), shiftRow(BJORN, '2026-08-15')], error: null } as any);
    await GET(req(URL_OK));
    const [anna, bjorn] = mockRender.mock.calls[0][0].people;
    expect(anna.summary.workMinutes).toBe(540);
    expect(bjorn.summary.workMinutes).toBe(1080);
  });

  it('delar ut ersättningarna per person', async () => {
    mockCompensations.mockResolvedValue({
      data: [
        { id: 'c1', user_id: ANNA, entry_date: '2026-08-14', kind: 'expense', quantity: null, amount: 100, vat_amount: 20, note: null, receipt_name: 'k.pdf' },
        { id: 'c2', user_id: BJORN, entry_date: '2026-08-14', kind: 'travel', quantity: 12, amount: 0, vat_amount: null, note: null, receipt_name: null },
      ],
      error: null,
    } as any);
    await GET(req(URL_OK));
    const [anna, bjorn] = mockRender.mock.calls[0][0].people;
    expect(anna.compensations.map((c) => c.id)).toEqual(['c1']);
    expect(bjorn.compensations.map((c) => c.id)).toEqual(['c2']);
  });

  it('räknar februari rätt — sista dagen härleds, den antas inte', async () => {
    await GET(req('/api/admin/time/payroll-pdf?period=2026-02'));
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), { from: '2026-02-01', to: '2026-02-28' }, expect.anything());
  });

  it('svarar med PDF och ett filnamn webbläsaren kan spara', async () => {
    const res = await GET(req(`/api/admin/time/payroll-pdf?period=2026-08&user_id=${ANNA}`));
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Loneunderlag 2026-08 - Anna Andersson.pdf"');
    // Perioden kan ha öppnats och rättats sedan sist — ett löneunderlag får aldrig komma ur en cache.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('namnger ett samlat underlag efter perioden, inte efter den första i bunten', async () => {
    const res = await GET(req(URL_OK));
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Loneunderlag 2026-08.pdf"');
  });
});

describe('GET /api/admin/time/payroll-pdf — tusenradstaket', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('bläddrar vidare när ett svar är fullt', async () => {
    // 🧨 PostgREST svarar med högst 1000 rader och SÄGER INTE TILL när det kapar. En kapad lista i
    // en vy ser ut som en kort lista; en kapad lista i ett löneunderlag är timmar som aldrig
    // betalas ut, i ett dokument som ser komplett ut. Tjugofem personer med tjugofem rapporterade
    // dagar är 625 rader — taket är inte teoretiskt.
    const full = Array.from({ length: 1000 }, (_, i) => shiftRow(ANNA, `2026-08-${String((i % 31) + 1).padStart(2, '0')}`));
    mockEntries
      .mockResolvedValueOnce({ data: full, error: null } as any)
      .mockResolvedValueOnce({ data: [shiftRow(BJORN)], error: null } as any);

    await GET(req(URL_OK));

    expect(mockEntries).toHaveBeenCalledTimes(2);
    expect(mockEntries.mock.calls[0][2]).toMatchObject({ slice: { from: 0, to: 999 } });
    expect(mockEntries.mock.calls[1][2]).toMatchObject({ slice: { from: 1000, to: 1999 } });
    // Björn ligger i andra sidan och måste ha nått fram till dokumentet.
    expect(mockRender.mock.calls[0][0].people[1].summary.workMinutes).toBe(540);
  });

  it('slutar bläddra så fort ett svar inte är fullt', async () => {
    await GET(req(URL_OK));
    expect(mockEntries).toHaveBeenCalledTimes(1);
  });

  it('svarar 500 i stället för ett halvt underlag när en sida fallerar', async () => {
    mockEntries.mockResolvedValue({ data: null, error: { message: 'nätverket' } } as any);
    expect((await GET(req(URL_OK))).status).toBe(500);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('svarar 500 när översikten inte gick att läsa — ett namnlöst underlag är oanvändbart', async () => {
    mockOverview.mockResolvedValue({ data: null, error: { message: 'rpc' } } as any);
    expect((await GET(req(URL_OK))).status).toBe(500);
    expect(mockRender).not.toHaveBeenCalled();
  });
});
