import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser } from './helpers/supabase';

// Grinden framför startsidans "Ring"-rad. Domänfunktionen har egna tester (workOrderCallContacts.test.ts);
// det som prövas HÄR är att kundernas namn och nummer bara lämnas ut för ordrar läsaren får se under
// sin EGEN RLS — samma modell som fältvyns route ([id]/customer-contact), fast för en lista.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getWorkOrderCallContacts: vi.fn() };
});

// Klienterna MÄRKS, så testet kan säga vilken som gick vart. readableWorkOrderIds är ÄKTA och frågar
// sessionsklienten — `visibleToSession`/`sessionError` sätts per test.
const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));

let visibleToSession: string[] = [];
let sessionError: { message: string } | null = null;

vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => ({
    __client: 'session',
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        in: (_col: string, ids: string[]) =>
          Promise.resolve(
            sessionError
              ? { data: null, error: sessionError }
              : { data: table === 'crm_work_orders' ? ids.filter((id) => visibleToSession.includes(id)).map((id) => ({ id })) : [], error: null },
          ),
      };
      return builder;
    },
  })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getWorkOrderCallContacts } from '@/lib/domains/crm/work-orders';
import { POST } from '@/app/api/crm/work-orders/customer-contacts/route';

const MINE = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const CONTACT = { contactName: 'Björn', phone: '08-222', isOnSiteContact: false, phoneFromCustomer: false };

function call(body: unknown) {
  return POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  visibleToSession = [MINE];
  sessionError = null;
  (getCurrentUser as any).mockResolvedValue(memberUser);
  (getWorkOrderCallContacts as any).mockImplementation((_client: unknown, ids: string[]) =>
    Promise.resolve({ data: Object.fromEntries(ids.map((id) => [id, CONTACT])), error: null }));
});

describe('POST /api/crm/work-orders/customer-contacts', () => {
  it('den som ser ordern får kontakten', async () => {
    const json = await (await call({ work_order_ids: [MINE] })).json();
    expect(json.ok).toBe(true);
    expect(json.data.contacts).toEqual({ [MINE]: CONTACT });
  });

  // ⛔ HUVUDVAKTEN. En order läsaren inte får se: ingen kontakt — och uppslaget görs inte för den.
  it('ordrar läsaren inte ser slås aldrig upp', async () => {
    const json = await (await call({ work_order_ids: [MINE, OTHER] })).json();
    expect(json.data.contacts).toEqual({ [MINE]: CONTACT });
    expect(getWorkOrderCallContacts).toHaveBeenCalledWith(ADMIN_CLIENT, [MINE]);
  });

  it('ser läsaren ingen av ordrarna görs inget uppslag alls', async () => {
    visibleToSession = [];
    const json = await (await call({ work_order_ids: [OTHER] })).json();
    expect(json.data.contacts).toEqual({});
    expect(getWorkOrderCallContacts).not.toHaveBeenCalled();
  });

  it('ett fel i synlighetsläsningen är ett fel, inte ett ja', async () => {
    sessionError = { message: 'tillfälligt fel' };
    const res = await call({ work_order_ids: [MINE] });
    expect(res.status).toBe(500);
    expect(getWorkOrderCallContacts).not.toHaveBeenCalled();
  });

  it('jämför id:n i gemener, som databasen svarar med dem', async () => {
    const json = await (await call({ work_order_ids: [MINE.toUpperCase()] })).json();
    expect(json.data.contacts).toEqual({ [MINE]: CONTACT });
  });

  it('trasiga id:n, tom lista och för många är 400', async () => {
    expect((await call({ work_order_ids: ['inte-ett-uuid'] })).status).toBe(400);
    expect((await call({ work_order_ids: [] })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `11111111-2222-4333-8444-${String(i).padStart(12, '0')}`);
    expect((await call({ work_order_ids: many })).status).toBe(400);
    expect(getWorkOrderCallContacts).not.toHaveBeenCalled();
  });

  it('utan inloggning 401', async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    expect((await call({ work_order_ids: [MINE] })).status).toBe(401);
  });

  it('svarar med kontakterna på plats även när kundkorten inte gick att läsa', async () => {
    (getWorkOrderCallContacts as any).mockResolvedValue({ data: { [MINE]: CONTACT }, error: { message: 'kundkort' } });
    const res = await call({ work_order_ids: [MINE] });
    expect(res.status).toBe(200);
    expect((await res.json()).data.contacts).toEqual({ [MINE]: CONTACT });
  });

  it('kunde ordrarna inte läsas är det 500', async () => {
    (getWorkOrderCallContacts as any).mockResolvedValue({ data: null, error: { message: 'trasigt' } });
    expect((await call({ work_order_ids: [MINE] })).status).toBe(500);
  });
});
