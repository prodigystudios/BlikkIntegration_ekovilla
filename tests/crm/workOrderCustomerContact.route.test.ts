import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser } from './helpers/supabase';

// Routen bakom fältvyns och orderns kundkontakt. Domänfunktionen har egna tester
// (workOrderCustomerContact.test.ts); det som prövas HÄR är grinden framför den — att kundens namn,
// telefon och e-post bara lämnas ut för en order läsaren får se under sin EGEN RLS.
//
// 🧨 Förr räckte "inloggad + har UUID:t": vem som helst med ett order-id fick kundens uppgifter, även
// ett konto som fick 404 på själva ordern.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getWorkOrderCustomerContact: vi.fn() };
});

// Klienterna MÄRKS, så testet kan säga vilken som gick vart. isWorkOrderReadable är ÄKTA och frågar
// sessionsklienten — `visibleToSession`/`sessionError` sätts per test.
const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));

let visibleToSession = true;
let sessionError: { message: string } | null = null;

vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => ({
    __client: 'session',
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            sessionError
              ? { data: null, error: sessionError }
              : { data: table === 'crm_work_orders' && visibleToSession ? { id: WO } : null, error: null },
          ),
      };
      return builder;
    },
  })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getWorkOrderCustomerContact } from '@/lib/domains/crm/work-orders';
import { GET } from '@/app/api/crm/work-orders/[id]/customer-contact/route';

const WO = '11111111-2222-4333-8444-555555555555';
const CONTACT = { contactName: 'Pär Kund', phone: '070-000 00 00', email: 'par@example.test' };

function call(id = WO) {
  return GET(new Request('http://localhost/x'), { params: { id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  visibleToSession = true;
  sessionError = null;
  (getCurrentUser as any).mockResolvedValue(memberUser);
  (getWorkOrderCustomerContact as any).mockResolvedValue({ data: CONTACT, error: null });
});

describe('GET /api/crm/work-orders/[id]/customer-contact', () => {
  it('den som ser ordern får kundens kontakt', async () => {
    const json = await (await call()).json();
    expect(json.ok).toBe(true);
    expect(json.data.contact).toEqual(CONTACT);
  });

  // ⛔ HUVUDVAKTEN. En order läsaren inte får se: inget svar om kunden — och uppslaget görs inte alls.
  it('den som inte ser ordern får ingenting, och uppslaget görs inte', async () => {
    visibleToSession = false;
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.contact).toBeNull();
    expect(getWorkOrderCustomerContact).not.toHaveBeenCalled();
  });

  // Den förhöjda läsningen får bara gälla KONTAKTEN, efter grinden. Gjordes synlighetsfrågan också
  // med admin-klienten hade grinden varit ett "ja" för varje order.
  it('kontakten läses med admin-klienten, synligheten med sessionen', async () => {
    await call();
    expect(getWorkOrderCustomerContact).toHaveBeenCalledWith(ADMIN_CLIENT, WO);
  });

  it('ett fel i synlighetsläsningen är ett fel, inte ett ja', async () => {
    sessionError = { message: 'tillfälligt fel' };
    const res = await call();
    expect(res.status).toBe(500);
    expect(getWorkOrderCustomerContact).not.toHaveBeenCalled();
  });

  it('ett trasigt id är 400, inte en rå 500 från PostgREST', async () => {
    expect((await call('inte-ett-uuid')).status).toBe(400);
  });

  it('utan inloggning 401', async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
