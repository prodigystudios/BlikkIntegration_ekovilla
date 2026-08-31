import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, ekonomiUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Route-tester för attesten (fas 4.4).
//
// Domänlogiken var testad sedan 4.3, vakterna inte — och det är vakterna som avgör vem som kan
// stänga någon annans lönemånad. Här prövas gränserna: vem som slipper igenom, vem som får 403, och
// att en åtgärd mot NÅGON ANNAN aldrig går utan time.approve.
//
// Mockar måste deklareras före modulimporter.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// Partiell mock: periodmatten och övergångsmatrisen ska köras på RIKTIGT här — det är dem routen
// fattar beslut med. Bara databasanropen byts ut.
vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return {
    ...actual,
    getTimeApproval: vi.fn(),
    setTimePeriodStatus: vi.fn(),
    listTimeApprovalOverview: vi.fn(),
  };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getTimeApproval, setTimePeriodStatus, listTimeApprovalOverview } from '@/lib/domains/time/approvals';

const { GET, POST } = await import('@/app/api/time/approvals/route');
const { GET: overviewGET } = await import('@/app/api/admin/time/approvals/route');

const mockUser = vi.mocked(getCurrentUser);
const mockGet = vi.mocked(getTimeApproval);
const mockSet = vi.mocked(setTimePeriodStatus);
const mockOverview = vi.mocked(listTimeApprovalOverview);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockGet.mockResolvedValue({ data: null, error: null } as any);
  mockSet.mockResolvedValue({ data: { status: 'submitted' }, error: null } as any);
  mockOverview.mockResolvedValue({ data: [], error: null } as any);
});

function req(url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, options);
}

function body(payload: unknown) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// ---------------------------------------------------------------------------
// GET /api/time/approvals
// ---------------------------------------------------------------------------

describe('GET /api/time/approvals', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    const res = await GET(req('/api/time/approvals?period=2026-08'));
    expect(res.status).toBe(401);
  });

  it('läser den egna perioden — inte en userId från frågesträngen', async () => {
    mockUser.mockResolvedValue(memberUser);
    await GET(req('/api/time/approvals?period=2026-08&userId=someone-else'));
    // Andra personers status finns bara bakom time.approve i adminvyn. Blikks motsvarighet tar en
    // ?userId= UTAN behörighetskontroll; den fällan ska inte återuppstå här.
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), memberUser.id, '2026-08-01');
  });

  it('avvisar en period som inte är en månad', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await GET(req('/api/time/approvals?period=2026-08-14'))).status).toBe(400);
    expect((await GET(req('/api/time/approvals'))).status).toBe(400);
  });

  it('läser ingen rad som öppen period', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await GET(req('/api/time/approvals?period=2026-08'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ period_start: '2026-08-01', status: 'open', approval: null });
  });

  it('svarar med den lagrade statusen när en rad finns', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockGet.mockResolvedValue({ data: { status: 'approved', approved_at: '2026-09-01T10:00:00Z' }, error: null } as any);
    const json = await (await GET(req('/api/time/approvals?period=2026-08'))).json();
    expect(json.data.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// POST /api/time/approvals — egen period
// ---------------------------------------------------------------------------

describe('POST /api/time/approvals — den anställde', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'submitted' })));
    expect(res.status).toBe(401);
  });

  it('lämnar in sin egen öppna period', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'submitted' })));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: memberUser.id, periodStart: '2026-08-01', status: 'submitted',
    }));
  });

  it('ångrar sin egen inlämning', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockGet.mockResolvedValue({ data: { status: 'submitted' }, error: null } as any);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'open' })));
    expect(res.status).toBe(200);
  });

  it('får INTE attestera sig själv', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockGet.mockResolvedValue({ data: { status: 'submitted' }, error: null } as any);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'approved' })));
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('får INTE öppna sin egen attesterade period', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockGet.mockResolvedValue({ data: { status: 'approved' }, error: null } as any);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'open' })));
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('får INTE röra någon annans period', async () => {
    mockUser.mockResolvedValue(memberUser);
    const res = await POST(req('/api/time/approvals', body({
      period: '2026-08', status: 'submitted', user_id: '11111111-1111-4111-8111-111111111111',
    })));
    expect(res.status).toBe(403);
    // Viktigt: vi ska inte ens LÄSA någon annans rad innan vi säger nej.
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('avvisar okänd status och trasig period', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'klar' })))).status).toBe(400);
    expect((await POST(req('/api/time/approvals', body({ period: '2026', status: 'submitted' })))).status).toBe(400);
    expect((await POST(req('/api/time/approvals', { method: 'POST' }))).status).toBe(400);
  });

  it('avvisar en månad utanför 01–12 som 400, inte som ett Postgres-fel', async () => {
    // '2026-13' matchar \d{2} men blir datumet '2026-13-01' → 22008 från Postgres → 500 för en ren
    // inmatningsmiss. Nåbart: <input type="month"> faller tillbaka på text i äldre webbläsare.
    mockUser.mockResolvedValue(memberUser);
    expect((await POST(req('/api/time/approvals', body({ period: '2026-13', status: 'submitted' })))).status).toBe(400);
    expect((await POST(req('/api/time/approvals', body({ period: '2026-00', status: 'submitted' })))).status).toBe(400);
    expect((await GET(req('/api/time/approvals?period=2026-13'))).status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('kräver time.entry.write för att lämna in — konsult nekas med 403', async () => {
    // Den som inte får rapportera tid ska inte kunna intyga att en månad är färdigrapporterad.
    // RPC:n vaktar det också, men dess svar är ett P0001 som routen hade svarat 409 på.
    mockUser.mockResolvedValue(konsultUser);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'submitted' })));
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/time/approvals — attestansvarig
// ---------------------------------------------------------------------------

describe('POST /api/time/approvals — attestansvarig', () => {
  const target = '11111111-1111-4111-8111-111111111111';

  it('attesterar någon annans inlämnade period', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockGet.mockResolvedValue({ data: { status: 'submitted' }, error: null } as any);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'approved', user_id: target })));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: target, status: 'approved' }));
  });

  it('attesterar direkt från öppen', async () => {
    mockUser.mockResolvedValue(adminUser);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'approved', user_id: target })));
    expect(res.status).toBe(200);
  });

  it('öppnar en attesterad period igen, med anledning', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockGet.mockResolvedValue({ data: { status: 'approved' }, error: null } as any);
    const res = await POST(req('/api/time/approvals', body({
      period: '2026-08', status: 'open', user_id: target, note: 'Saknar fredagen',
    })));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ note: 'Saknar fredagen' }));
  });

  it('kan INTE lämna in åt någon annan', async () => {
    mockUser.mockResolvedValue(adminUser);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'submitted', user_id: target })));
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('översätter RPC:ns kapplöpningsfel till 409, inte 500', async () => {
    // Utgångsläget kan hinna ändras mellan läsningen och skrivningen — RPC:n har sista ordet och
    // svarar med P0001 och ett färdigt svenskt meddelande.
    mockUser.mockResolvedValue(adminUser);
    mockSet.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Perioden är redan attesterad' } } as any);
    const res = await POST(req('/api/time/approvals', body({ period: '2026-08', status: 'approved', user_id: target })));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toBe('Perioden är redan attesterad');
    // ...och koden säger KONFLIKT, inte "perioden är låst". Matrisen kastar P0001 även på
    // behörighet och trasig periodstart; att döpa alla till time_period_locked hade fått klienten
    // att visa fel orsak.
    expect(json.errorDetails.code).toBe('time_approval_conflict');
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/time/approvals
// ---------------------------------------------------------------------------

describe('GET /api/admin/time/approvals', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await overviewGET(req('/api/admin/time/approvals?period=2026-08'))).status).toBe(401);
  });

  it('kräver time.approve — en installatör kommer inte åt allas timmar', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await overviewGET(req('/api/admin/time/approvals?period=2026-08'))).status).toBe(403);
    mockUser.mockResolvedValue(konsultUser);
    expect((await overviewGET(req('/api/admin/time/approvals?period=2026-08'))).status).toBe(403);
    expect(mockOverview).not.toHaveBeenCalled();
  });

  it('släpper igenom admin och normaliserar siffrorna', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockOverview.mockResolvedValue({
      data: [{ user_id: 'u1', full_name: 'Anna', role: 'member', status: 'submitted', work_minutes: '9600', compensation_amount: '1250.50' }],
      error: null,
    } as any);
    const res = await overviewGET(req('/api/admin/time/approvals?period=2026-08'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.period_start).toBe('2026-08-01');
    expect(json.data.people[0].work_minutes).toBe(9600);
    expect(json.data.people[0].compensation_amount).toBe(1250.5);
  });

  it('avvisar en period som inte är en månad', async () => {
    mockUser.mockResolvedValue(adminUser);
    expect((await overviewGET(req('/api/admin/time/approvals?period=2026-08-14'))).status).toBe(400);
  });

  // `can_correct` styr om vyn ritar "Rätta"/"Ta bort" på dagraderna. Klienten kan inte fråga efter
  // sina egna behörigheter, så flaggan följer med underlaget — och den måste svara på RÄTT nyckel.
  //
  // Före rollen `ekonomi` var attest och rättelse samma personer och skillnaden syntes aldrig. Nu
  // gör den det: lönebyrån låser månaden men ändrar aldrig någons timmar, och en knapp vars enda
  // utfall är ett 403 får henne att tro att systemet är trasigt.
  describe('can_correct — attestera och rätta är två skilda nycklar', () => {
    it('är true för admin, som har time.entry.write.all', async () => {
      mockUser.mockResolvedValue(adminUser);
      const json = await (await overviewGET(req('/api/admin/time/approvals?period=2026-08'))).json();
      expect(json.data.can_correct).toBe(true);
    });

    it('är false för lönebyrån, som attesterar men inte rättar', async () => {
      mockUser.mockResolvedValue(ekonomiUser);
      const res = await overviewGET(req('/api/admin/time/approvals?period=2026-08'));
      // Hon SKA komma in — det är inte ett behörighetsfel, bara en snävare förmåga.
      expect(res.status).toBe(200);
      expect((await res.json()).data.can_correct).toBe(false);
    });
  });
});
