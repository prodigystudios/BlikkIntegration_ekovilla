import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser, salesUser } from './helpers/supabase';
import { keysForRole } from '../helpers/permissionSeed';

// Routen bakom fältvyns "ansvarig säljare"-kort. Domänfunktionen har egna tester
// (workOrderAssigneeContact.test.ts); det som prövas HÄR är den rad som bär själva
// integritetsbeslutet — att en extern part inte får personalens telefonnummer.
//
// 🧨 Raden är en enda `if`, och utan det här testet är den osynlig för sviten. Systerrutten
// customer-contact har en annan grind (kunddata, inte personalens); "harmoniseras" den här med den
// faller spärren bort med allt grönt.
//
// Grinden är nyckeln app.staff (intern personal: member, sales, admin) sedan 2026-09-26 — förr en
// rollista (isReadonlyRole). `effective` sätts per test: det är mängden getEffectivePermissions svarar.

const h = vi.hoisted(() => ({ effective: new Set<string>(['app.staff']) }));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.effective) };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getWorkOrderAssigneeContact: vi.fn() };
});

// De två klienterna MÄRKS, så testet kan säga vilken som gick vart. Utan märkningen är de två
// tomma objekt och en route som eleverar båda läsningarna ser identisk ut för sviten — se vakten
// längst ner.
const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({ __client: 'session' })) }));

import { getCurrentUser } from '@/lib/auth/route';
import { getWorkOrderAssigneeContact } from '@/lib/domains/crm/work-orders';
import { GET } from '@/app/api/crm/work-orders/[id]/assignee-contact/route';

const WO = '11111111-2222-4333-8444-555555555555';
const ANDERS = { name: 'Anders Säljare', phone: '070-123 45 67' };

// Rollernas RIKTIGA knippen, som de ser ut i prod (seed + migreringar). Externa parter håller
// crm.workorder.read — RLS släpper alltså igenom dem på ordern — men aldrig app.staff. Ger en migrering
// konsult nyckeln fälls testet nedan, inte bara katalogtestet.
const KEYS = {
  member: [...keysForRole('member')],
  sales: [...keysForRole('sales')],
  konsult: [...keysForRole('konsult')],
  ekonomi: [...keysForRole('ekonomi')],
};

function call(id = WO) {
  return GET(new Request('http://localhost/x'), { params: { id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.effective = new Set(KEYS.member);
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
    h.effective = new Set(KEYS.sales);
    expect((await (await call()).json()).data.contact).toEqual(ANDERS);
  });

  // ⛔ HUVUDVAKTEN. konsult och lönebyrån är EXTERNA parter som ändå håller crm.workorder.read, alltså
  // skulle RLS släppa igenom dem på varje order. Numret är personalens eget och delas i dag bara via
  // Kontaktlistan, en kurerad tabell. Uppslaget får inte ens göras.
  it.each(['konsult', 'ekonomi'] as const)('%s får inget nummer — och uppslaget görs inte alls', async (role) => {
    (getCurrentUser as any).mockResolvedValue({ id: `user-${role}`, role });
    h.effective = new Set(KEYS[role]);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.contact).toBeNull();
    expect(getWorkOrderAssigneeContact).not.toHaveBeenCalled();
  });

  // 🧨 FAIL-CLOSED. Den gamla grinden läste rollen, och getCurrentUser() svarar `role || 'member'`
  // när profilläsningen fallerar — en konsult kom då hit MASKERAD SOM INSTALLATÖR. Därför säger mocken
  // 'member' här. Nyckeluppslaget failar stängt: ett fel i effective_permissions ger en tom mängd
  // (lib/auth/permissions.ts), och en tom mängd ska neka.
  it('ett trasigt behörighetsuppslag nekar, även när sessionen ser ut som en installatör', async () => {
    (getCurrentUser as any).mockResolvedValue({ id: 'user-konsult-1', role: 'member' });
    h.effective = new Set();
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

  // 🧨 VILKEN KLIENT SOM GÅR VART ÄR HELA SÄKERHETSMODELLEN, och den avgörs HÄR i routen — inte
  // i domänfunktionen, som bara tar emot det den får. Skickas admin-klienten som första argument
  // läses arbetsordern förbi RLS, och routen svarar med den ansvariges namn och privata mobil för
  // vilket order-UUID som helst, åt vilket inloggat internt konto som helst.
  it('arbetsordern läses med sessionsklienten, profilen med admin', async () => {
    (getCurrentUser as any).mockResolvedValue(memberUser);
    await call();

    const [orderClient, profileClient, id] = (getWorkOrderAssigneeContact as any).mock.calls[0];
    expect(orderClient.__client).toBe('session');
    expect(profileClient.__client).toBe('admin');
    expect(orderClient).not.toBe(profileClient);
    expect(id).toBe(WO);
  });
});
