import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionKey } from '@/lib/auth/permissions';
import { effectivePermissionsForRole, memberUser, salesUser } from '../crm/helpers/supabase';
import { ROUND_ID, WORK_ORDER_ID, completeBundle, makeAction, makeRound } from './helpers/fixtures';

// Skyddsrondernas rutter. Det som prövas är att rutterna inte litar på klienten och att nycklarna
// är rätt dragna:
//
//   * läsning = safety.round.read ELLER .write (som select-policyerna), skrivning = .write;
//     installatören (member) utan personlig nyckel får ingenting,
//   * order, datum, arbetsgivare och adress vid starten kommer från SERVERN, aldrig ur kroppen,
//   * status, rondnummer och skapare går inte att sätta via PATCH,
//   * en skrivning som RLS stoppar (noll rader, inget fel) svarar 409 — inte "sparat",
//   * slutför prövar samma regler som formuläret visar,
//   * efter slutförd rond ändras bara åtgärdernas uppföljning.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/safetyRounds/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/safetyRounds/store')>();
  return {
    ...actual,
    listSafetyRounds: vi.fn(),
    countOpenActionsForOrder: vi.fn(),
    getSafetyRound: vi.fn(),
    getSafetyRoundBundle: vi.fn(),
    lookupSafetyRoundOrders: vi.fn(),
    getSafetyRoundOrderHeader: vi.fn(),
    startSafetyRound: vi.fn(),
    updateSafetyRound: vi.fn(),
    deleteSafetyRound: vi.fn(),
    insertAction: vi.fn(),
    updateAction: vi.fn(),
    deleteCustomItem: vi.fn(),
    itemBelongsToRound: vi.fn(),
    nextPosition: vi.fn(),
    listChecklistCategories: vi.fn(),
  };
});

vi.mock('@/lib/domains/safetyRounds/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/safetyRounds/pdf')>();
  return { ...actual, renderSafetyRoundPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import * as store from '@/lib/domains/safetyRounds/store';

const { GET: LIST, POST: START } = await import('@/app/api/safety-rounds/route');
const { GET: ORDERS } = await import('@/app/api/safety-rounds/orders/route');
const { GET: READ, PATCH: PATCH_ROUND } = await import('@/app/api/safety-rounds/[id]/route');
const { POST: COMPLETE } = await import('@/app/api/safety-rounds/[id]/complete/route');
const { POST: ADD_ACTION } = await import('@/app/api/safety-rounds/[id]/actions/route');
const { PATCH: PATCH_ACTION } = await import('@/app/api/safety-rounds/[id]/actions/[actionId]/route');
const { DELETE: DELETE_ITEM } = await import('@/app/api/safety-rounds/[id]/items/[itemId]/route');
const { GET: PDF } = await import('@/app/api/safety-rounds/[id]/pdf/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const s = vi.mocked(store);

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const ACTION_ID = '44444444-4444-4444-8444-444444444444';
const roundCtx = { params: { id: ROUND_ID } };

const leader = { ...salesUser, name: 'Rolf Rondledare' };

function json(body: unknown, method = 'POST') {
  return new Request('http://localhost/api', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function asUser(user: typeof leader | typeof memberUser | null, perms: Set<PermissionKey>) {
  mockUser.mockResolvedValue(user as never);
  mockPerms.mockResolvedValue(perms);
}

beforeEach(() => {
  vi.clearAllMocks();
  asUser(leader, effectivePermissionsForRole('sales'));
  s.nextPosition.mockResolvedValue({ data: 1, error: null });
  s.listChecklistCategories.mockResolvedValue({ data: [], error: null } as never);
});

describe('behörigheten', () => {
  it('utan inloggning 401, installatören utan nyckel 403', async () => {
    asUser(null, new Set());
    expect((await LIST(new Request('http://localhost/api/safety-rounds'))).status).toBe(401);

    asUser(memberUser, effectivePermissionsForRole('member'));
    expect((await LIST(new Request('http://localhost/api/safety-rounds'))).status).toBe(403);
    expect((await START(json({ work_order_id: WORK_ORDER_ID }))).status).toBe(403);
    expect(s.startSafetyRound).not.toHaveBeenCalled();
  });

  it('en arbetsledare med BARA skrivnyckeln (personligt) kan läsa ronden hen fyller i', async () => {
    asUser({ ...memberUser, name: 'Arne' } as typeof leader, new Set<PermissionKey>(['time.entry.write', 'safety.round.write']));
    s.getSafetyRoundBundle.mockResolvedValue({ data: completeBundle(), error: null });
    const res = await READ(new Request('http://localhost'), roundCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.can_write).toBe(true);
  });

  it('läsnyckeln ensam ger läsning men can_write = false', async () => {
    asUser(leader, new Set<PermissionKey>(['safety.round.read']));
    s.listSafetyRounds.mockResolvedValue({ data: [], error: null } as never);
    const res = await LIST(new Request('http://localhost/api/safety-rounds'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.can_write).toBe(false);
  });
});

describe('POST /api/safety-rounds (starta)', () => {
  const header = {
    id: WORK_ORDER_ID,
    order_number: 'AO-1',
    fortnox_order_number: '6579',
    project_name: 'Vindsbjälklag',
    client_name: 'Testfastigheter AB',
    status: 'scheduled',
    work_address: { street_address: 'Testgatan 1', postal_code: '811 21', city: 'Sandviken' },
    customer_address: { street_address: 'Kundvägen 9', postal_code: '111 11', city: 'Stockholm' },
  };

  it('adress, datum, arbetsgivare och typ av arbete kommer från servern — inte ur kroppen', async () => {
    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: header, error: null } as never);
    s.startSafetyRound.mockResolvedValue({ data: ROUND_ID, error: null } as never);

    const res = await START(
      json({ work_order_id: WORK_ORDER_ID, site_address: 'Påhittad väg', employer: 'Annat AB', held_on: '1999-01-01' }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data.id).toBe(ROUND_ID);

    const input = s.startSafetyRound.mock.calls[0][1];
    expect(input.workOrderId).toBe(WORK_ORDER_ID);
    // Arbetsadressen vinner över kundens (resolveJobAddress).
    expect(input.siteAddress).toBe('Testgatan 1, 811 21, Sandviken');
    expect(input.employer).toBe('Isoleringslandslaget AB');
    expect(input.workType).toBe('Tilläggsisolering / lösull / cellulosaisolering');
    expect(input.heldOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.heldOn).not.toBe('1999-01-01');
  });

  it('en order som inte finns ger 404, en nekad uppslagning 403', async () => {
    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: null, error: null } as never);
    expect((await START(json({ work_order_id: WORK_ORDER_ID }))).status).toBe(404);

    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } } as never);
    expect((await START(json({ work_order_id: WORK_ORDER_ID }))).status).toBe(403);
    expect(s.startSafetyRound).not.toHaveBeenCalled();
  });

  it('två som startar samtidigt ger 409 — inte två ronder med samma nummer', async () => {
    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: header, error: null } as never);
    s.startSafetyRound.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } } as never);
    expect((await START(json({ work_order_id: WORK_ORDER_ID }))).status).toBe(409);
  });
});

describe('GET /api/safety-rounds/orders (sök order)', () => {
  it('lämnar ut den upplösta adressen — inte adressfälten eller något annat ur ordern', async () => {
    s.lookupSafetyRoundOrders.mockResolvedValue({
      data: [
        {
          id: WORK_ORDER_ID,
          order_number: 'AO-1',
          fortnox_order_number: null,
          project_name: 'P',
          client_name: 'K',
          status: 'scheduled',
          work_address: { street_address: '', postal_code: '', city: '' },
          customer_address: { street_address: 'Kundvägen 9', postal_code: '111 11', city: 'Stockholm' },
        },
      ],
      error: null,
    } as never);
    const res = await ORDERS(new Request('http://localhost/api/safety-rounds/orders?q=AO'));
    expect(res.status).toBe(200);
    const [hit] = (await res.json()).data.items;
    expect(hit).toEqual({
      id: WORK_ORDER_ID,
      order_number: 'AO-1',
      fortnox_order_number: null,
      project_name: 'P',
      client_name: 'K',
      address: 'Kundvägen 9, 111 11, Stockholm',
    });
  });

  it('för kort sökning ger 400 utan att fråga databasen', async () => {
    expect((await ORDERS(new Request('http://localhost/api/safety-rounds/orders?q=A'))).status).toBe(400);
    expect(s.lookupSafetyRoundOrders).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/safety-rounds/[id] (rondinfo)', () => {
  it('status, rondnummer och order går inte att sätta', async () => {
    s.updateSafetyRound.mockResolvedValue({ data: makeRound(), error: null } as never);
    const res = await PATCH_ROUND(json({ weather: 'Sol', status: 'completed', round_number: 7, work_order_id: WORK_ORDER_ID }, 'PATCH'), roundCtx);
    expect(res.status).toBe(200);
    expect(s.updateSafetyRound.mock.calls[0][2]).toEqual({ weather: 'Sol' });
  });

  it('rondledarens profil följer bara med när namnet är den inloggades eget', async () => {
    s.updateSafetyRound.mockResolvedValue({ data: makeRound(), error: null } as never);

    await PATCH_ROUND(json({ leader_name: ' rolf  rondledare ' }, 'PATCH'), roundCtx);
    expect(s.updateSafetyRound.mock.calls[0][2]).toMatchObject({ leader_id: leader.id });

    await PATCH_ROUND(json({ leader_name: 'Någon Annan' }, 'PATCH'), roundCtx);
    expect(s.updateSafetyRound.mock.calls[1][2]).toMatchObject({ leader_name: 'Någon Annan', leader_id: null });
  });

  it('noll rader utan fel (RLS: ronden är slutförd) ger 409 — inte "sparat"', async () => {
    s.updateSafetyRound.mockResolvedValue({ data: null, error: null } as never);
    expect((await PATCH_ROUND(json({ weather: 'Sol' }, 'PATCH'), roundCtx)).status).toBe(409);
  });
});

describe('POST /api/safety-rounds/[id]/complete', () => {
  it('nekar med samma lista som formuläret visar', async () => {
    const bundle = completeBundle();
    bundle.actions = [];
    s.getSafetyRoundBundle.mockResolvedValue({ data: bundle, error: null });
    const res = await COMPLETE(new Request('http://localhost', { method: 'POST' }), roundCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorDetails.details.problems).toEqual([
      { step: 'actions', message: 'Punkt 4 ska till handlingsplanen men saknar åtgärd.' },
    ]);
    expect(s.updateSafetyRound).not.toHaveBeenCalled();
  });

  it('en ifylld rond slutförs med ENBART statusen — vem och när sätter databasen', async () => {
    s.getSafetyRoundBundle.mockResolvedValue({ data: completeBundle(), error: null });
    s.updateSafetyRound.mockResolvedValue({ data: makeRound({ status: 'completed', completed_at: '2026-09-24T10:00:00Z' }), error: null } as never);
    const res = await COMPLETE(new Request('http://localhost', { method: 'POST' }), roundCtx);
    expect(res.status).toBe(200);
    expect(s.updateSafetyRound.mock.calls[0][2]).toEqual({ status: 'completed' });
  });

  it('en redan slutförd rond ger 409', async () => {
    const bundle = completeBundle();
    bundle.round = makeRound({ status: 'completed', completed_at: '2026-09-24T10:00:00Z' });
    s.getSafetyRoundBundle.mockResolvedValue({ data: bundle, error: null });
    expect((await COMPLETE(new Request('http://localhost', { method: 'POST' }), roundCtx)).status).toBe(409);
  });
});

describe('handlingsplanen', () => {
  const actionCtx = { params: { id: ROUND_ID, actionId: ACTION_ID } };

  it('efter slutförd rond: uppföljningen går igenom, själva åtgärden nekas', async () => {
    s.getSafetyRound.mockResolvedValue({ data: makeRound({ status: 'completed', completed_at: '2026-09-24T10:00:00Z' }), error: null } as never);
    s.updateAction.mockResolvedValue({ data: makeAction({ status: 'done' }), error: null } as never);

    const followUp = await PATCH_ACTION(json({ status: 'done', followed_up_on: '2026-09-30', effect: 'yes' }, 'PATCH'), actionCtx);
    expect(followUp.status).toBe(200);

    const core = await PATCH_ACTION(json({ action: 'Något annat', status: 'done' }, 'PATCH'), actionCtx);
    expect(core.status).toBe(409);
    expect(s.updateAction).toHaveBeenCalledTimes(1);
  });

  it('"Från punkt" måste vara en punkt i SAMMA rond', async () => {
    s.itemBelongsToRound.mockResolvedValue({ data: false, error: null } as never);
    const res = await ADD_ACTION(json({ finding: 'Räcke saknas', item_id: ITEM_ID }), roundCtx);
    expect(res.status).toBe(400);
    expect(s.insertAction).not.toHaveBeenCalled();
    expect(s.itemBelongsToRound).toHaveBeenCalledWith(expect.anything(), ROUND_ID, ITEM_ID);
  });

  it('round_id kommer ur rutten, aldrig ur kroppen', async () => {
    s.insertAction.mockResolvedValue({ data: makeAction(), error: null } as never);
    await ADD_ACTION(json({ finding: 'Räcke saknas', round_id: 'någon-annan' }), roundCtx);
    expect(s.insertAction.mock.calls[0][1]).toMatchObject({ round_id: ROUND_ID, finding: 'Räcke saknas' });
  });
});

describe('DELETE en punkt', () => {
  it('en katalogpunkt (policyn ger noll rader) nekas med en väg framåt', async () => {
    s.deleteCustomItem.mockResolvedValue({ data: null, error: null } as never);
    const res = await DELETE_ITEM(new Request('http://localhost', { method: 'DELETE' }), { params: { id: ROUND_ID, itemId: ITEM_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Ej relevant');
  });
});

describe('GET /api/safety-rounds/[id]/pdf', () => {
  it('utan nyckel landar en fliknavigering på en läsbar sida, inte JSON', async () => {
    asUser(memberUser, effectivePermissionsForRole('member'));
    const res = await PDF(new Request('http://localhost', { headers: { 'sec-fetch-dest': 'document' } }), roundCtx);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('protokollet får ett filnamn med order och rond', async () => {
    s.getSafetyRoundBundle.mockResolvedValue({ data: completeBundle(), error: null });
    const res = await PDF(new Request('http://localhost'), roundCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Skyddsrond 6579 rond2 - Vindsbjalklag Hus AC.pdf"');
  });
});
