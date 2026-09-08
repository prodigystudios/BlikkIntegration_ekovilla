import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, ekonomiUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Route-tester för påminnelsen från attesten.
//
// Två saker prövas, och båda är gränser snarare än funktioner: att bara den som får attestera kan
// skicka, och att SERVERN avgör vem som påminns och varför. Klienten skickar en lista med
// användar-id och inget mer — anledningen härleds ur samma underlag som ritar listan, annars kunde
// ett anrop skicka "du har inte rapporterat något" till någon som rapporterat hela månaden.
//
// Mockar måste deklareras före modulimporter.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// Partiell mock: periodmatten och texterna körs på RIKTIGT — det är dem påminnelsen består av.
// Bara databasanropet byts ut.
vi.mock('@/lib/domains/time/approvals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/time/approvals')>();
  return { ...actual, listTimeApprovalOverview: vi.fn() };
});

vi.mock('@/lib/domains/notifications/delivery', () => ({ deliverNotifications: vi.fn() }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listTimeApprovalOverview } from '@/lib/domains/time/approvals';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { sendSms } from '@/lib/sms';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const { POST } = await import('@/app/api/admin/time/reminders/route');

const mockUser = vi.mocked(getCurrentUser);
const mockOverview = vi.mocked(listTimeApprovalOverview);
const mockDeliver = vi.mocked(deliverNotifications);
const mockSms = vi.mocked(sendSms);

const ANNA = '11111111-1111-4111-8111-111111111111';
const BENGT = '22222222-2222-4222-8222-222222222222';

const person = (user_id: string, full_name: string, status: string, entry_count: number) => ({
  user_id, full_name, role: 'member', status,
  submitted_at: null, approved_at: null, approved_by: null, approved_by_name: null, note: null,
  work_minutes: 0, absence_minutes: 0, entry_count,
  compensation_amount: 0, compensation_count: 0,
});

/**
 * Adminklienten gör TVÅ läsningar i den här routen: nyliga påminnelser ur `notifications`
 * (.eq().eq().in().gte()) och telefonnummer ur `profiles` (.in()).
 *
 * Båda modelleras, så testerna inte tyst går genom felgrenarna — en attrapp som saknar `.gte`
 * hade fått dubblettskyddet att kasta, fångas och returnera "ingen nyss påmind", vilket ser ut som
 * att skyddet är avstängt fast det är attrappen som är ofullständig.
 */
function adminWithPhones(phones: Record<string, string | null>, recentlyReminded: string[] = []) {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === 'notifications') {
          const chain: any = {
            eq: () => chain,
            in: () => chain,
            gte: async () => ({ data: recentlyReminded.map((id) => ({ recipient_user_id: id })), error: null }),
          };
          return chain;
        }
        return {
          in: async () => ({ data: Object.entries(phones).map(([id, phone]) => ({ id, phone })), error: null }),
        };
      },
    }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockDeliver.mockResolvedValue({ data: [], error: null } as any);
  mockSms.mockResolvedValue({ sid: 'SM1', status: 'queued', to: '+46701234567' } as any);
  vi.mocked(getSupabaseAdmin).mockReturnValue(adminWithPhones({}));
  mockOverview.mockResolvedValue({ data: [person(ANNA, 'Anna', 'open', 0)], error: null } as any);
});

function send(payload: unknown) {
  return POST(new Request('http://localhost/api/admin/time/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe('POST /api/admin/time/reminders — vakten', () => {
  it('nekar den som inte får attestera', async () => {
    mockUser.mockResolvedValue(memberUser as any);
    const { status } = await json(await send({ period: '2026-08', user_ids: [ANNA] }));
    expect(status).toBe(403);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('släpper in lönebyrån — hon attesterar, alltså påminner hon', async () => {
    mockUser.mockResolvedValue(ekonomiUser as any);
    const { status } = await json(await send({ period: '2026-08', user_ids: [ANNA] }));
    expect(status).toBe(200);
  });

  it('avvisar en månad som inte är en månad', async () => {
    mockUser.mockResolvedValue(adminUser as any);
    const { status } = await json(await send({ period: '2026-13', user_ids: [ANNA] }));
    expect(status).toBe(400);
  });
});

describe('POST /api/admin/time/reminders — urvalet avgörs av servern', () => {
  beforeEach(() => mockUser.mockResolvedValue(adminUser as any));

  it('härleder anledningen ur underlaget, inte ur anropet', async () => {
    // Anna HAR rapporterat men inte lämnat in. Texten måste bli "inte inlämnad" — klienten har
    // inte sagt något om saken, och får inte heller kunna göra det.
    mockOverview.mockResolvedValue({ data: [person(ANNA, 'Anna', 'open', 14)], error: null } as any);
    await send({ period: '2026-08', user_ids: [ANNA] });

    const rows = mockDeliver.mock.calls[0][1] as Array<{ body: string; recipient_user_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(ANNA);
    expect(rows[0].body).toContain('inte inlämnad');
  });

  it('hoppar över den som hunnit lämna in medan modalen stod öppen', async () => {
    mockOverview.mockResolvedValue({
      data: [person(ANNA, 'Anna', 'submitted', 14), person(BENGT, 'Bengt', 'open', 0)],
      error: null,
    } as any);
    const { body } = await json(await send({ period: '2026-08', user_ids: [ANNA, BENGT] }));

    expect(body.data.notified).toBe(1);
    // Rapporteras rakt ut. En tyst lägre siffra hade lästs som att något gick fel.
    expect(body.data.skipped).toBe(1);
    const rows = mockDeliver.mock.calls[0][1] as Array<{ recipient_user_id: string }>;
    expect(rows.map((r) => r.recipient_user_id)).toEqual([BENGT]);
  });

  it('skickar ingenting när ingen behöver påminnas längre', async () => {
    mockOverview.mockResolvedValue({ data: [person(ANNA, 'Anna', 'approved', 14)], error: null } as any);
    const { status } = await json(await send({ period: '2026-08', user_ids: [ANNA] }));
    expect(status).toBe(409);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('påminner aldrig någon som inte stod i underlaget', async () => {
    // Bengt finns inte i månadens lista (t.ex. `konsult`, som RPC:n filtrerar bort). Att skicka
    // hans id ska inte kunna göra honom till mottagare.
    const { status } = await json(await send({ period: '2026-08', user_ids: [BENGT] }));
    expect(status).toBe(409);
  });

  it('matchar id oavsett skiftläge', async () => {
    // zods uuid() släpper igenom versaler och Postgres jämför uuid skiftlägesokänsligt, så en
    // versal parameter hade annars gett "ingen att påminna" med status 200.
    const { body } = await json(await send({ period: '2026-08', user_ids: [ANNA.toUpperCase()] }));
    expect(body.data.notified).toBe(1);
  });
});

describe('POST /api/admin/time/reminders — SMS', () => {
  beforeEach(() => mockUser.mockResolvedValue(adminUser as any));

  it('skickar inget SMS när rutan inte är i', async () => {
    await send({ period: '2026-08', user_ids: [ANNA] });
    expect(mockSms).not.toHaveBeenCalled();
    expect(mockDeliver).toHaveBeenCalled();
  });

  it('normaliserar numret till E.164 innan det går till Twilio', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(adminWithPhones({ [ANNA]: '070-123 45 67' }));
    const { body } = await json(await send({ period: '2026-08', user_ids: [ANNA], send_sms: true }));
    expect(mockSms).toHaveBeenCalledTimes(1);
    expect(mockSms.mock.calls[0][0].to).toBe('+46701234567');
    expect(body.data.sms_sent).toBe(1);
  });

  it('räknar den som saknar nummer som en upplysning, inte som ett fel', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(adminWithPhones({ [ANNA]: null }));
    const { status, body } = await json(await send({ period: '2026-08', user_ids: [ANNA], send_sms: true }));
    expect(status).toBe(200);
    expect(body.data.sms_missing_phone).toBe(1);
    expect(body.data.sms_failed).toEqual([]);
    // Notisen gick ändå fram — det är den som är påminnelsen.
    expect(body.data.notified).toBe(1);
  });

  it('låter ett SMS-fel stå för sig självt utan att fälla utskicket', async () => {
    // sendSms KASTAR när Twilio saknar konfiguration. Utan try/catch per mottagare hade en env-miss
    // fällt hela anropet — efter att notiserna redan skrivits, alltså med ett 500 på något som
    // delvis lyckats.
    mockOverview.mockResolvedValue({
      data: [person(ANNA, 'Anna', 'open', 0), person(BENGT, 'Bengt', 'open', 0)],
      error: null,
    } as any);
    vi.mocked(getSupabaseAdmin).mockReturnValue(adminWithPhones({ [ANNA]: '0701234567', [BENGT]: '0709876543' }));
    mockSms.mockRejectedValueOnce(new Error('SMS not configured'));

    const { status, body } = await json(await send({ period: '2026-08', user_ids: [ANNA, BENGT], send_sms: true }));
    expect(status).toBe(200);
    expect(body.data.notified).toBe(2);
    expect(body.data.sms_sent).toBe(1);
    expect(body.data.sms_failed).toEqual(['Anna']);
  });

  it('svarar med fel när notisen inte gick att skriva — då finns ingen påminnelse alls', async () => {
    // Till skillnad från övriga notisproducenter är fan-outen INTE best-effort här: hos dem är
    // notisen en bieffekt av en skrivning som redan lyckats, här ÄR den hela åtgärden.
    mockDeliver.mockResolvedValue({ data: null, error: { message: 'insert failed' } } as any);
    const { status } = await json(await send({ period: '2026-08', user_ids: [ANNA] }));
    expect(status).toBe(500);
  });
});

describe('POST /api/admin/time/reminders — när numren inte går att läsa', () => {
  beforeEach(() => mockUser.mockResolvedValue(adminUser as any));

  it('säger att uppslagningen fallerade i stället för att alla saknar nummer', async () => {
    // 🧨 Felklassen den här ytan redan betalat för två gånger: ett fel som ser ut som ett tomt
    // värde. Tappas läsfelet blir kartan tom, varje mottagare räknas som nummerlös, och svaret
    // blir ett glatt 200 med "alla saknar telefonnummer" — varpå någon letar i tjugo profiler
    // efter nummer som redan står där.
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: (table: string) => ({
        select: () => {
          if (table === 'notifications') {
            const chain: any = { eq: () => chain, in: () => chain, gte: async () => ({ data: [], error: null }) };
            return chain;
          }
          return { in: async () => ({ data: null, error: { message: 'boom' } }) };
        },
      }),
    } as any);

    const { status, body } = await json(await send({ period: '2026-08', user_ids: [ANNA], send_sms: true }));
    expect(status).toBe(200);
    expect(body.data.sms_lookup_failed).toBe(true);
    // Ingen får räknas som nummerlös när vi inte vet något om numren.
    expect(body.data.sms_missing_phone).toBe(0);
    expect(mockSms).not.toHaveBeenCalled();
    // Notisen gick ändå fram — den är påminnelsen, SMS:et är tillvalet.
    expect(body.data.notified).toBe(1);
  });

  it('flaggar inte uppslagningen som trasig i det normala fallet', async () => {
    const { body } = await json(await send({ period: '2026-08', user_ids: [ANNA], send_sms: true }));
    expect(body.data.sms_lookup_failed).toBe(false);
  });
});

describe('POST /api/admin/time/reminders — dubbletter och avsändaren själv', () => {
  it('påminner aldrig avsändaren om hens egen tid', async () => {
    // Attestlistan innehåller varje anställd utom konsult och lönebyrån, så en admin som attesterar
    // står i sin egen lista. En påminnelse till sig själv är brus — samma "minus the actor"-regel
    // som notissystemets recept redan har för mentions.
    mockUser.mockResolvedValue({ ...adminUser, id: ANNA } as any);
    mockOverview.mockResolvedValue({
      data: [person(ANNA, 'Anna', 'open', 0), person(BENGT, 'Bengt', 'open', 0)],
      error: null,
    } as any);
    const { body } = await json(await send({ period: '2026-08', user_ids: [ANNA, BENGT] }));
    const rows = mockDeliver.mock.calls[0][1] as Array<{ recipient_user_id: string }>;
    expect(rows.map((r) => r.recipient_user_id)).toEqual([BENGT]);
    expect(body.data.skipped).toBe(1);
  });

  it('hoppar över den som påmindes för en stund sedan', async () => {
    // 🧨 Skyddet mot en OMTRYCKNING: notiserna är redan skrivna och SMS:en skickade när svaret
    // tappas, så nästa klick hade dubbelnotifierat alla och betalat varje SMS en gång till.
    mockUser.mockResolvedValue(adminUser as any);
    vi.mocked(getSupabaseAdmin).mockReturnValue(adminWithPhones({}, [ANNA]));
    const { status, body } = await json(await send({ period: '2026-08', user_ids: [ANNA] }));
    expect(status).toBe(409);
    expect(body.error).toContain('redan påminda');
    expect(mockDeliver).not.toHaveBeenCalled();
  });
});
