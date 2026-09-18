import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, memberUser, konsultUser, effectivePermissionsForRole } from './helpers/supabase';

// Samtalsloggen på offerten. Speglar uppgiftsflödets konstruktion, och prövas därför på samma två
// saker: att OFFERTEN är grinden, och att den elevated läsningen aldrig körs utan den.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/quotes', () => ({ getCrmQuoteCallIdentity: vi.fn() }));

vi.mock('@/lib/domains/crm/calls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/calls')>();
  return { ...actual, listCrmQuoteCalls: vi.fn(), createCrmCall: vi.fn(), attachCrmCallUserNames: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmQuoteCallIdentity } from '@/lib/domains/crm/quotes';
import { listCrmQuoteCalls, createCrmCall, attachCrmCallUserNames, quoteCallIdentity } from '@/lib/domains/crm/calls';
import { callAtToIso } from '@/app/crm/lib/callDisplay';

const { GET, POST } = await import('@/app/api/crm/quotes/[id]/calls/route');

const mockUser = vi.mocked(getCurrentUser);
const mockQuote = vi.mocked(getCrmQuoteCallIdentity);
const mockList = vi.mocked(listCrmQuoteCalls);
const mockCreate = vi.mocked(createCrmCall);
const mockNames = vi.mocked(attachCrmCallUserNames);

const QUOTE_ID = '11111111-1111-1111-1111-111111111111';
const quoteRow = { id: QUOTE_ID, customer_id: 'cust-1', prospect_id: 'prospect-1', customer_name: 'Brf Almen', customer_snapshot: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockQuote.mockResolvedValue({ data: quoteRow, error: null } as any);
  mockList.mockResolvedValue({ data: [], error: null } as any);
  mockCreate.mockResolvedValue({ data: { id: 'call-1', user_id: 'user-sales-1' }, error: null } as any);
  mockNames.mockImplementation(async (_admin, calls: any[]) => calls.map((c) => ({ ...c, user_name: null })) as any);
});

const getReq = () => new Request(`http://localhost/api/crm/quotes/${QUOTE_ID}/calls`);
const postReq = (body: unknown) => new Request(`http://localhost/api/crm/quotes/${QUOTE_ID}/calls`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = (id = QUOTE_ID) => ({ params: { id } });

describe('GET /api/crm/quotes/[id]/calls — grinden är OFFERTEN', () => {
  it('kräver CRM-behörighet', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await GET(getReq(), ctx())).status).toBe(403);
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it('🧨 svarar 404 och rör ALDRIG den elevated läsningen när offerten inte syns', async () => {
    // Utan den här ordningen vore offert-id:t i adressen en fri nyckel till vems samtal som helst:
    // samtalen läses med service-rollen, alltså helt utan RLS.
    mockUser.mockResolvedValue(salesUser);
    mockQuote.mockResolvedValue({ data: null, error: { code: 'PGRST116' } } as any);

    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('läser offertens samtal när offerten syns', async () => {
    mockUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [{ id: 'call-1', user_id: 'user-sales-1' }], error: null } as any);

    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), QUOTE_ID);
    expect((await res.json()).data.items).toHaveLength(1);
  });
});

describe('POST /api/crm/quotes/[id]/calls', () => {
  const body = { outcome: 'positive', summary: 'Ringde om taket' };

  it('nekar läsroll — loggning är en skrivning', async () => {
    mockUser.mockResolvedValue(konsultUser);
    expect((await POST(postReq(body), ctx())).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('🧨 skriver ALDRIG utan att offerten först syntes för sessionen', async () => {
    mockUser.mockResolvedValue(salesUser);
    mockQuote.mockResolvedValue({ data: null, error: { code: 'PGRST116' } } as any);

    expect((await POST(postReq(body), ctx())).status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('kräver en sammanfattning', async () => {
    mockUser.mockResolvedValue(salesUser);
    expect((await POST(postReq({ outcome: 'positive', summary: '  ' }), ctx())).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('kopplar samtalet till offerten och skriver det i den inloggades namn', async () => {
    mockUser.mockResolvedValue(salesUser);
    await POST(postReq(body), ctx());

    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      quote_id: QUOTE_ID,
      user_id: salesUser.id,
      outcome: 'positive',
      summary: 'Ringde om taket',
    }));
  });

  it('svarar 403, inte 500, när RLS nekar skrivningen', async () => {
    mockUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } } as any);
    expect((await POST(postReq(body), ctx())).status).toBe(403);
  });
});

describe('quoteCallIdentity', () => {
  it('🧨 sätter prospect_id till null — annars nekar RLS ett samtal på en kollegas offert', () => {
    // crm_calls_insert_visible kräver att en satt prospect_id pekar på en kund tilldelad den som
    // skriver. customer_id har inget sådant villkor, och det är den kundkortet läser.
    // Offerten HAR ett prospekt här — annars vore testet tomt: en utelämnad nyckel blir null ändå.
    const identity = quoteCallIdentity({ customer_id: 'cust-1', prospect_id: 'prospect-1', customer_name: 'Brf Almen', customer_snapshot: {} });
    expect(identity.prospect_id).toBeNull();
    expect(identity.customer_id).toBe('cust-1');
  });

  it('tar kontaktuppgifterna ur offertens snapshot, inte från webbläsaren', () => {
    const identity = quoteCallIdentity({
      customer_id: 'cust-1',
      customer_name: 'Fallback AB',
      customer_snapshot: { company_name: 'Brf Almen', contact_name: 'Anna Ek', phone: '070-1234567', city: 'Nacka' },
    });
    expect(identity).toMatchObject({ company_name: 'Brf Almen', contact_name: 'Anna Ek', phone: '070-1234567', city: 'Nacka' });
  });

  it('faller tillbaka på offertens kundnamn, och gör tomma strängar till null', () => {
    expect(quoteCallIdentity({ customer_id: null, customer_name: 'Fallback AB', customer_snapshot: { company_name: '   ' } }).company_name)
      .toBe('Fallback AB');
    expect(quoteCallIdentity({ customer_snapshot: null }).company_name).toBeNull();
  });
});

describe('callAtToIso', () => {
  it('gör om ett lokalt klockslag till samma ögonblick i UTC', () => {
    // Tolkas i webbläsarens zon med flit: användaren skriver klockslaget hen ringde.
    expect(callAtToIso('2026-09-18T14:30')).toBe(new Date('2026-09-18T14:30').toISOString());
  });

  it('ger null för tomt och för oläsbart — en trasig tidpunkt får inte hindra loggningen', () => {
    expect(callAtToIso('')).toBeNull();
    expect(callAtToIso('   ')).toBeNull();
    expect(callAtToIso('inte ett datum')).toBeNull();
  });
});
