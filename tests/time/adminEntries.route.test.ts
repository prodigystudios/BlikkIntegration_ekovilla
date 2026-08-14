import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// GET /api/admin/time/entries — attestens dagvy: en namngiven persons månad, dag för dag.
//
// Det som prövas här är gränsen och fogen, inte matematiken (den bor i summary.test.ts): att bara
// den som får läsa andras tid kommer in, att perioden blir ett riktigt månadsintervall, och att
// raderna som hämtas verkligen går genom summeringen — en route som svarar med råa databasrader
// hade lagt tillbaka kolumnkännedomen i webbläsaren.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// toSummarizableEntry och summarizePerson körs på riktigt — de ÄR det routen finns för.
vi.mock('@/lib/domains/time/entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/entries')>();
  return { ...actual, listTimeEntries: vi.fn() };
});

vi.mock('@/lib/domains/time/compensations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/compensations')>();
  return { ...actual, listCompensations: vi.fn() };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listTimeEntries } from '@/lib/domains/time/entries';
import { listCompensations } from '@/lib/domains/time/compensations';

const { GET } = await import('@/app/api/admin/time/entries/route');

const mockUser = vi.mocked(getCurrentUser);
const mockEntries = vi.mocked(listTimeEntries);
const mockCompensations = vi.mocked(listCompensations);

const ANNA = '44444444-4444-4444-8444-444444444444';

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

const URL_OK = `/api/admin/time/entries?period=2026-08&user_id=${ANNA}`;

// En rad som den kommer ur PostgREST: `time` blir 'HH:MM:SS' och referensraderna är inbäddade.
const shiftRow = {
  id: 'e1',
  user_id: ANNA,
  kind: 'work_order',
  work_date: '2026-08-14',
  start_time: '08:00:00',
  end_time: '18:00:00',
  break_minutes: 60,
  minutes_worked: 540,
  hours: 9,
  note: 'Vindsbjälklag',
  source: 'crm',
  work_order: { id: 'wo1', order_number: 'AO-20260729-42E7C4', fortnox_order_number: null, project_name: 'Villa Ek', client_name: 'Ekbergs' },
  time_code: { id: 'tc1', name: 'Arbetstid', code: '1', payroll_code: 'LÖN100' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockEntries.mockResolvedValue({ data: [], error: null } as any);
  mockCompensations.mockResolvedValue({ data: [], error: null } as any);
});

describe('GET /api/admin/time/entries — åtkomst', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req(URL_OK))).status).toBe(401);
  });

  // Nyckeln är read.all och inte time.approve med flit: RLS släpper igenom andras rader på just
  // read.all, så en attestansvarig utan den nyckeln hade fått noll rader — vilket ser likadant ut
  // som "har inte rapporterat något". Hellre 403 än ett tomt svar som ljuger.
  it('kräver time.entry.read.all — installatör och konsult nekas', async () => {
    for (const user of [memberUser, salesUser, konsultUser]) {
      mockUser.mockResolvedValue(user);
      expect((await GET(req(URL_OK))).status).toBe(403);
    }
    expect(mockEntries).not.toHaveBeenCalled();
  });

  it('släpper igenom admin', async () => {
    mockUser.mockResolvedValue(adminUser);
    expect((await GET(req(URL_OK))).status).toBe(200);
  });
});

describe('GET /api/admin/time/entries — inmatning', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('kräver både period och user_id', async () => {
    expect((await GET(req('/api/admin/time/entries'))).status).toBe(400);
    expect((await GET(req('/api/admin/time/entries?period=2026-08'))).status).toBe(400);
    expect((await GET(req(`/api/admin/time/entries?user_id=${ANNA}`))).status).toBe(400);
  });

  // '2026-13' matchar `\d{2}` men blir datumet '2026-13-01' och ett Postgres-fel — ett 500 för en
  // ren inmatningsmiss. Samma fälla som redan kostat på attestroutens period.
  it('avvisar en period som inte är en riktig månad', async () => {
    expect((await GET(req(`/api/admin/time/entries?period=2026-13&user_id=${ANNA}`))).status).toBe(400);
    expect((await GET(req(`/api/admin/time/entries?period=2026-08-14&user_id=${ANNA}`))).status).toBe(400);
  });

  it('avvisar ett user_id som inte är ett uuid', async () => {
    expect((await GET(req('/api/admin/time/entries?period=2026-08&user_id=anna'))).status).toBe(400);
    expect(mockEntries).not.toHaveBeenCalled();
  });

  it('hämtar hela månaden för den efterfrågade personen', async () => {
    await GET(req(URL_OK));
    const range = { from: '2026-08-01', to: '2026-08-31' };
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), range, { userId: ANNA });
    expect(mockCompensations).toHaveBeenCalledWith(expect.anything(), range, { userId: ANNA });
  });

  it('räknar februari rätt — sista dagen härleds, den antas inte', async () => {
    await GET(req(`/api/admin/time/entries?period=2026-02&user_id=${ANNA}`));
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), { from: '2026-02-01', to: '2026-02-28' }, { userId: ANNA });
  });
});

describe('GET /api/admin/time/entries — underlaget', () => {
  beforeEach(() => { mockUser.mockResolvedValue(adminUser); });

  it('svarar med klockslag och total arbetad tid — lönepersonens enda uttryckliga krav', async () => {
    mockEntries.mockResolvedValue({ data: [shiftRow], error: null } as any);
    const json = await (await GET(req(URL_OK))).json();

    expect(json.data.rows).toHaveLength(1);
    expect(json.data.rows[0]).toMatchObject({
      date: '2026-08-14',
      startTime: '08:00:00',
      endTime: '18:00:00',
      workMinutes: 540, // 08–18 med en timmes rast är 9 h, inte 10 — byråns eget exempel
    });
    expect(json.data.workMinutes).toBe(540);
  });

  it('bär med arbetsordern så en rad går att placera utan att slå upp den', async () => {
    mockEntries.mockResolvedValue({ data: [shiftRow], error: null } as any);
    const json = await (await GET(req(URL_OK))).json();
    expect(json.data.rows[0].label).toBe('AO-20260729-42E7C4 · Villa Ek');
  });

  it('håller frånvaro utanför arbetstiden och namnger orsaken', async () => {
    mockEntries.mockResolvedValue({
      data: [
        shiftRow,
        {
          ...shiftRow,
          id: 'e2',
          kind: 'absence',
          work_date: '2026-08-15',
          start_time: null,
          end_time: null,
          break_minutes: 0,
          minutes_worked: 240,
          work_order: null,
          absence_type: { id: 'a1', name: 'VAB', payroll_code: 'LÖN300' },
        },
      ],
      error: null,
    } as any);
    const json = await (await GET(req(URL_OK))).json();

    expect(json.data.workMinutes).toBe(540);
    expect(json.data.absenceMinutes).toBe(240);
    expect(json.data.absenceByReason).toEqual([{ reason: 'VAB', minutes: 240 }]);
  });

  it('svarar med ersättningarna i samma underlag', async () => {
    const comp = { id: 'c1', user_id: ANNA, entry_date: '2026-08-14', kind: 'travel', quantity: 4.5, amount: 112.5, note: null };
    mockCompensations.mockResolvedValue({ data: [comp], error: null } as any);
    const json = await (await GET(req(URL_OK))).json();
    expect(json.data.compensations).toEqual([comp]);
  });

  it('en person utan rader ger ett tomt underlag, inte ett fel', async () => {
    const res = await GET(req(URL_OK));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.rows).toEqual([]);
    expect(json.data.workMinutes).toBe(0);
  });

  // Regression från kodgranskningen. Zods uuid() släpper igenom versaler och Postgres jämför uuid
  // skiftlägesokänsligt, så raderna kommer tillbaka — med gemena user_id, som summarizePersons
  // strikta jämförelse annars filtrerar bort allihop. Utfallet vore en tom månad med status 200
  // för någon som rapporterat hela augusti, alltså ett falskt negativt på en attestyta.
  it('normaliserar ett versalt user_id i stället för att svara med en tom månad', async () => {
    mockEntries.mockResolvedValue({ data: [shiftRow], error: null } as any);
    const json = await (await GET(req(`/api/admin/time/entries?period=2026-08&user_id=${ANNA.toUpperCase()}`))).json();
    expect(mockEntries).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userId: ANNA });
    expect(json.data.rows).toHaveLength(1);
    expect(json.data.workMinutes).toBe(540);
  });

  // Kontorets Tid-flik skriver rader utan minutes_worked. Utan hours-fallbacken i mapparen visar
  // dagvyn "Totalt 0,00 h" rakt under en aggregatrad som säger något helt annat.
  it('räknar de gamla kontorsraderna på hours i stället för att visa noll', async () => {
    mockEntries.mockResolvedValue({
      data: [{ ...shiftRow, source: 'legacy_office', start_time: null, end_time: null, minutes_worked: null, hours: 7.5, work_order: null }],
      error: null,
    } as any);
    const json = await (await GET(req(URL_OK))).json();
    expect(json.data.rows[0].workMinutes).toBe(450);
    expect(json.data.workMinutes).toBe(450);
  });

  it('svarar 500 med databasens meddelande när läsningen fallerar', async () => {
    mockEntries.mockResolvedValue({ data: null, error: { message: 'permission denied' } } as any);
    const res = await GET(req(URL_OK));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('permission denied');
  });
});
