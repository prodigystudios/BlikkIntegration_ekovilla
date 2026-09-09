import { describe, it, expect, vi, beforeEach } from 'vitest';
import { konsultUser, memberUser, salesUser } from './helpers/supabase';

// Routen bakom fältvyns "ansvarig säljare"-kort. Domänfunktionen har egna tester
// (workOrderAssigneeContact.test.ts); det som prövas HÄR är den rad som bär själva
// integritetsbeslutet — att en extern konsult inte får personalens telefonnummer.
//
// 🧨 Raden är en enda `if`, och utan det här testet är den osynlig för sviten. Filens egen
// kommentar förutser dessutom att någon vill "harmonisera" routen med systern customer-contact
// intill; görs det utan denna fil faller grinden bort med allt grönt.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getWorkOrderAssigneeContact: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

// Sessionsklienten svarar med läsarens EGEN profilrad — det är den rollen grinden frågar efter.
// `readerRole`/`readerError` sätts per test.
let readerRole: string | null = 'member';
let readerError: { message: string } | null = null;

vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(
          readerError ? { data: null, error: readerError } : { data: readerRole ? { role: readerRole } : null, error: null },
        ),
      };
      return builder;
    },
  })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getWorkOrderAssigneeContact } from '@/lib/domains/crm/work-orders';
import { GET } from '@/app/api/crm/work-orders/[id]/assignee-contact/route';

const WO = '11111111-2222-4333-8444-555555555555';
const ANDERS = { name: 'Anders Säljare', phone: '070-123 45 67' };

function call(id = WO) {
  return GET(new Request('http://localhost/x'), { params: { id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  readerRole = 'member';
  readerError = null;
  (getWorkOrderAssigneeContact as any).mockResolvedValue({ data: ANDERS, error: null });
});

describe('GET /api/crm/work-orders/[id]/assignee-contact', () => {
  it('installatören får den ansvariges namn och nummer', async () => {
    (getCurrentUser as any).mockResolvedValue(memberUser);
    const json = await (await call()).json();
    expect(json.ok).toBe(true);
    expect(json.data.contact).toEqual(ANDERS);
  });

  it('kontoret får det också', async () => {
    (getCurrentUser as any).mockResolvedValue(salesUser);
    readerRole = 'sales';
    expect((await (await call()).json()).data.contact).toEqual(ANDERS);
  });

  // ⛔ HUVUDVAKTEN. konsult är en EXTERN part som ändå håller crm.workorder.read, alltså skulle
  // RLS släppa igenom hen på varje order. Numret är personalens eget och delas i dag bara via
  // Kontaktlistan, en kurerad tabell. Uppslaget får inte ens göras.
  it('konsult får inget nummer — och uppslaget görs inte alls', async () => {
    (getCurrentUser as any).mockResolvedValue(konsultUser);
    readerRole = 'konsult';
    const res = await call();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.contact).toBeNull();
    expect(getWorkOrderAssigneeContact).not.toHaveBeenCalled();
  });

  // 🧨 FAIL-CLOSED, och HELA POÄNGEN LIGGER I MOCKEN. Grinden läste först `currentUser.role`.
  // `getCurrentUser()` kastar sitt profiles-läsfel (lib/auth/route.ts: `const { data: profile }`)
  // och svarar `role || 'member'` — så en konsult vars rolluppslag failade kom hit MASKERAD SOM
  // INSTALLATÖR, passerade grinden, och RLS fortsatte admittera hen på ordern.
  //
  // Därför säger mocken 'member' här, inte 'konsult': det är vad verkligheten skickar in i just
  // det fönstret. Ett test som satte 'konsult' hade varit grönt även med den gamla trasiga
  // grinden — det var precis det misstaget den här raden fick rätta.
  it('ett trasigt rolluppslag nekar, även när sessionen ser ut som en installatör', async () => {
    (getCurrentUser as any).mockResolvedValue({ id: konsultUser.id, role: 'member' });
    readerError = { message: 'tillfälligt fel' };
    const json = await (await call()).json();
    expect(json.data.contact).toBeNull();
    expect(getWorkOrderAssigneeContact).not.toHaveBeenCalled();
  });

  // Samma sak när raden helt saknas: ingen roll bevisad, alltså inget nummer.
  it('en läsare utan profilrad får heller inget', async () => {
    (getCurrentUser as any).mockResolvedValue(memberUser);
    readerRole = null;
    expect((await (await call()).json()).data.contact).toBeNull();
    expect(getWorkOrderAssigneeContact).not.toHaveBeenCalled();
  });

  it('utloggad avvisas', async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it('trasigt id ger 400, inte en rå 500 ur PostgREST', async () => {
    (getCurrentUser as any).mockResolvedValue(memberUser);
    const res = await call('inte-ett-uuid');
    expect(res.status).toBe(400);
    expect(getWorkOrderAssigneeContact).not.toHaveBeenCalled();
  });

  it('läsfel i uppslaget bärs upp som 500', async () => {
    (getCurrentUser as any).mockResolvedValue(memberUser);
    (getWorkOrderAssigneeContact as any).mockResolvedValue({ data: null, error: { message: 'trasigt' } });
    expect((await call()).status).toBe(500);
  });
});
