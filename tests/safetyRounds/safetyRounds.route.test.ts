import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionKey } from '@/lib/auth/permissions';
import { effectivePermissionsForRole, memberUser, salesUser } from '../crm/helpers/supabase';
import { ROUND_ID, WORK_ORDER_ID, completeBundle, makeAction, makePhoto, makeRound } from './helpers/fixtures';

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
    listPhotos: vi.fn(),
    listItemPhotoPaths: vi.fn(),
    findPhotoByPath: vi.fn(),
    addPhoto: vi.fn(),
    deletePhoto: vi.fn(),
  };
});

vi.mock('@/lib/domains/safetyRounds/photoStorage', () => ({
  createPhotoUploadUrls: vi.fn(),
  readPhotoInfo: vi.fn(),
  signPhotoUrls: vi.fn(async () => new Map()),
  downloadPhotos: vi.fn(async () => new Map()),
  removePhotoObjects: vi.fn(async () => undefined),
  removeRoundPhotoObjects: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));

vi.mock('@/lib/domains/safetyRounds/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/safetyRounds/pdf')>();
  return { ...actual, renderSafetyRoundPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) };
});

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import * as store from '@/lib/domains/safetyRounds/store';
import * as photoStorage from '@/lib/domains/safetyRounds/photoStorage';

const { GET: LIST, POST: START } = await import('@/app/api/safety-rounds/route');
const { GET: ORDERS } = await import('@/app/api/safety-rounds/orders/route');
const { GET: READ, PATCH: PATCH_ROUND } = await import('@/app/api/safety-rounds/[id]/route');
const { POST: COMPLETE } = await import('@/app/api/safety-rounds/[id]/complete/route');
const { POST: ADD_ACTION } = await import('@/app/api/safety-rounds/[id]/actions/route');
const { PATCH: PATCH_ACTION } = await import('@/app/api/safety-rounds/[id]/actions/[actionId]/route');
const { DELETE: DELETE_ITEM } = await import('@/app/api/safety-rounds/[id]/items/[itemId]/route');
const { GET: PDF } = await import('@/app/api/safety-rounds/[id]/pdf/route');
const { POST: PHOTO_UPLOAD_URL } = await import('@/app/api/safety-rounds/[id]/photos/upload-url/route');
const { POST: PHOTO_CONFIRM, GET: PHOTO_URLS } = await import('@/app/api/safety-rounds/[id]/photos/route');
const { DELETE: PHOTO_DELETE } = await import('@/app/api/safety-rounds/[id]/photos/[photoId]/route');
const { DELETE: DELETE_ROUND } = await import('@/app/api/safety-rounds/[id]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockPerms = vi.mocked(getEffectivePermissions);
const s = vi.mocked(store);
const ps = vi.mocked(photoStorage);

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
  s.listItemPhotoPaths.mockResolvedValue({ data: [], error: null });
  s.listPhotos.mockResolvedValue({ data: [], error: null } as never);
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

  it('en avbruten order får ingen rond — rutten svarar i förväg, och databasens nej (55000) blir samma svar', async () => {
    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: { ...header, status: 'cancelled' }, error: null } as never);
    const early = await START(json({ work_order_id: WORK_ORDER_ID }));
    expect(early.status).toBe(409);
    expect((await early.json()).error).toContain('avbruten');
    expect(s.startSafetyRound).not.toHaveBeenCalled();

    s.getSafetyRoundOrderHeader.mockResolvedValue({ data: header, error: null } as never);
    s.startSafetyRound.mockResolvedValue({ data: null, error: { code: '55000', message: 'work order cancelled' } } as never);
    expect((await START(json({ work_order_id: WORK_ORDER_ID }))).status).toBe(409);
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

  it('en insert som RLS nekar (slutförd ELLER borttagen rond) säger båda — gissar inte', async () => {
    s.insertAction.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } } as never);
    const res = await ADD_ACTION(json({ finding: 'Räcke saknas' }), roundCtx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Ronden är slutförd eller finns inte längre. Ladda om sidan.');
  });

  it('ett datum Postgres inte godtar blir 400, inte 500', async () => {
    s.getSafetyRound.mockResolvedValue({ data: makeRound(), error: null } as never);
    s.updateAction.mockResolvedValue({ data: null, error: { code: '22008', message: 'date/time field value out of range' } } as never);
    const res = await PATCH_ACTION(json({ followed_up_on: '2026-09-30' }, 'PATCH'), actionCtx);
    expect(res.status).toBe(400);
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

describe('foton', () => {
  // Sökvägskontrollen kräver att uppladdarens id är en uuid — som i verkligheten.
  const photographer = { ...salesUser, id: '55555555-5555-4555-8555-555555555555', name: 'Rolf Rondledare' };
  const UID = '66666666-6666-4666-8666-666666666666';
  const fullPath = `${ROUND_ID}/${photographer.id}/${UID}.jpg`;
  const printPath = `${ROUND_ID}/${photographer.id}/${UID}.print.jpg`;

  beforeEach(() => {
    asUser(photographer, effectivePermissionsForRole('sales'));
    s.getSafetyRound.mockResolvedValue({ data: makeRound(), error: null } as never);
    s.itemBelongsToRound.mockResolvedValue({ data: true, error: null } as never);
    s.findPhotoByPath.mockResolvedValue({ data: null, error: null } as never);
    ps.readPhotoInfo.mockImplementation(async (_admin, path) =>
      path.endsWith('.print.jpg') ? { size: 90_000, contentType: 'image/jpeg' } : { size: 450_000, contentType: 'image/jpeg' },
    );
  });

  describe('uppladdnings-URL', () => {
    it('installatören utan nyckel får ingen', async () => {
      asUser(memberUser, effectivePermissionsForRole('member'));
      expect((await PHOTO_UPLOAD_URL(json({ item_id: ITEM_ID }), roundCtx)).status).toBe(403);
      expect(ps.createPhotoUploadUrls).not.toHaveBeenCalled();
    });

    it('två engångs-URL:er under <rond>/<uppladdaren>/ — full och liten med samma uuid', async () => {
      ps.createPhotoUploadUrls.mockResolvedValue({ data: { full: { token: 't1' }, print: { token: 't2' } }, error: null });
      const res = await PHOTO_UPLOAD_URL(json({ item_id: ITEM_ID }), roundCtx);
      expect(res.status).toBe(200);
      const body = (await res.json()).data;
      expect(body.bucket).toBe('safety-round-photos');
      const prefix = `${ROUND_ID}/${photographer.id}/`;
      expect(body.full.path.startsWith(prefix)).toBe(true);
      expect(body.full.path.slice(prefix.length)).toMatch(/^[0-9a-f-]{36}\.jpg$/);
      expect(body.print.path).toBe(body.full.path.replace(/\.jpg$/, '.print.jpg'));
    });

    it('slutförd rond, främmande punkt och nått tak nekas innan någon URL myntas', async () => {
      s.getSafetyRound.mockResolvedValue({ data: makeRound({ status: 'completed', completed_at: '2026-09-25T10:00:00Z' }), error: null } as never);
      expect((await PHOTO_UPLOAD_URL(json({ item_id: ITEM_ID }), roundCtx)).status).toBe(409);

      s.getSafetyRound.mockResolvedValue({ data: makeRound(), error: null } as never);
      s.itemBelongsToRound.mockResolvedValue({ data: false, error: null } as never);
      expect((await PHOTO_UPLOAD_URL(json({ item_id: ITEM_ID }), roundCtx)).status).toBe(400);

      s.itemBelongsToRound.mockResolvedValue({ data: true, error: null } as never);
      s.listPhotos.mockResolvedValue({ data: Array.from({ length: 30 }, (_, i) => makePhoto({ photo_no: i + 1 })), error: null } as never);
      expect((await PHOTO_UPLOAD_URL(json({ item_id: ITEM_ID }), roundCtx)).status).toBe(409);
      expect(ps.createPhotoUploadUrls).not.toHaveBeenCalled();
    });
  });

  describe('bekräfta', () => {
    it('sparas via add_safety_round_photo med storlekarna UR LAGRINGEN — numret sätts av databasen', async () => {
      s.addPhoto.mockImplementation(async (_sb, input) => ({
        data: makePhoto({ storage_path: input.storagePath, print_path: input.printPath, photo_no: 7 }),
        error: null,
      }));
      const res = await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath, size_bytes: 1 }), roundCtx);
      expect(res.status).toBe(201);
      expect((await res.json()).data.photo.photo_no).toBe(7);
      expect(s.addPhoto.mock.calls[0][1]).toEqual({
        roundId: ROUND_ID,
        itemId: ITEM_ID,
        storagePath: fullPath,
        printPath: printPath,
        sizeBytes: 450_000,
        printSizeBytes: 90_000,
      });
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
    });

    it('någon annans sökväg nekas — och städas ALDRIG bort', async () => {
      const foreign = `${ROUND_ID}/77777777-7777-4777-8777-777777777777/${UID}.jpg`;
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: foreign }), roundCtx)).status).toBe(400);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
      expect(s.addPhoto).not.toHaveBeenCalled();
    });

    it('en redan registrerad sökväg ger 409 och städas inte (objekten tillhör en rad)', async () => {
      s.findPhotoByPath.mockResolvedValue({ data: { id: 'someone' }, error: null } as never);
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(409);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
    });

    it('ett fel i uppslaget "redan registrerad?" svaras ut utan att något städas', async () => {
      s.findPhotoByPath.mockResolvedValue({ data: null, error: { message: 'timeout' } } as never);
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(500);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
      expect(s.addPhoto).not.toHaveBeenCalled();
    });

    it('en variant som aldrig kom fram, eller fel typ, städar bort BÅDA och sparar inget', async () => {
      ps.readPhotoInfo.mockImplementation(async (_admin, path) => (path.endsWith('.print.jpg') ? null : { size: 450_000, contentType: 'image/jpeg' }));
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(400);
      expect(ps.removePhotoObjects).toHaveBeenLastCalledWith(expect.anything(), [fullPath, printPath]);

      ps.readPhotoInfo.mockResolvedValue({ size: 450_000, contentType: 'image/heic' });
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(400);
      expect(ps.removePhotoObjects).toHaveBeenCalledTimes(2);
      expect(s.addPhoto).not.toHaveBeenCalled();
    });

    it('databasens nej blir begripliga svar — och bara ett oregistrerat foto städas', async () => {
      const cases: Array<[string, number]> = [['55000', 409], ['54000', 409], ['23503', 400], ['22023', 400], ['42501', 403]];
      for (const [code, status] of cases) {
        vi.mocked(ps.removePhotoObjects).mockClear();
        s.addPhoto.mockResolvedValue({ data: null, error: { code, message: code } });
        const res = await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx);
        expect(res.status, code).toBe(status);
        expect(ps.removePhotoObjects, code).toHaveBeenCalledWith(expect.anything(), [fullPath, printPath]);
      }
    });

    it('"redan sparat" från databasen (en annan bekräftelse hann före) städar ALDRIG', async () => {
      s.addPhoto.mockResolvedValue({ data: null, error: { code: '23505', message: 'photo already registered' } });
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(409);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
    });

    it('städningen prövar om registreringen i sista stund — har fotot hunnit sparas rörs det inte', async () => {
      // Första uppslaget: inte registrerat. När städningen ska göras: registrerat av en annan bekräftelse.
      s.findPhotoByPath
        .mockResolvedValueOnce({ data: null, error: null } as never)
        .mockResolvedValueOnce({ data: { id: 'raced' }, error: null } as never);
      s.addPhoto.mockResolvedValue({ data: null, error: { code: '54000', message: 'photo limit reached' } });
      expect((await PHOTO_CONFIRM(json({ item_id: ITEM_ID, storage_path: fullPath }), roundCtx)).status).toBe(409);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
    });
  });

  it('GET ../photos ger bara nya URL:er — för raderna sessionen ser', async () => {
    const photo = makePhoto({ storage_path: fullPath });
    s.listPhotos.mockResolvedValue({ data: [photo], error: null } as never);
    ps.signPhotoUrls.mockResolvedValue(new Map([[fullPath, 'https://signed/new']]));
    const res = await PHOTO_URLS(new Request('http://localhost'), roundCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ photo_urls: { [photo.id]: 'https://signed/new' } });
  });

  describe('ta bort', () => {
    const photoCtx = { params: { id: ROUND_ID, photoId: '88888888-8888-4888-8888-888888888888' } };

    it('raden först (RLS), objekten sedan', async () => {
      s.deletePhoto.mockResolvedValue({ data: { storage_path: fullPath, print_path: printPath }, error: null } as never);
      expect((await PHOTO_DELETE(new Request('http://localhost', { method: 'DELETE' }), photoCtx)).status).toBe(200);
      expect(ps.removePhotoObjects).toHaveBeenCalledWith(expect.anything(), [fullPath, printPath]);
    });

    it('noll rader (slutförd rond) ger 409 — och inget objekt rörs', async () => {
      s.deletePhoto.mockResolvedValue({ data: null, error: null } as never);
      expect((await PHOTO_DELETE(new Request('http://localhost', { method: 'DELETE' }), photoCtx)).status).toBe(409);
      expect(ps.removePhotoObjects).not.toHaveBeenCalled();
    });
  });

  it('läsningen signerar fotonas URL:er efter RLS', async () => {
    const photo = makePhoto({ storage_path: fullPath });
    s.getSafetyRoundBundle.mockResolvedValue({ data: { ...completeBundle(), photos: [photo] }, error: null });
    ps.signPhotoUrls.mockResolvedValue(new Map([[fullPath, 'https://signed/url']]));
    const res = await READ(new Request('http://localhost'), roundCtx);
    expect((await res.json()).data.photo_urls).toEqual({ [photo.id]: 'https://signed/url' });
    expect(ps.signPhotoUrls).toHaveBeenCalledWith(expect.anything(), [fullPath]);
  });

  it('ett borttaget utkast städar hela <round_id>/ i lagringen — efter att raden är borta', async () => {
    s.deleteSafetyRound.mockResolvedValue({ data: { id: ROUND_ID }, error: null } as never);
    expect((await DELETE_ROUND(new Request('http://localhost', { method: 'DELETE' }), roundCtx)).status).toBe(200);
    expect(ps.removeRoundPhotoObjects).toHaveBeenCalledWith(expect.anything(), ROUND_ID);
    expect(s.deleteSafetyRound.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ps.removeRoundPhotoObjects).mock.invocationCallOrder[0]);
  });

  it('ett utkast som RLS inte släpper (slutfört) rör inga foton', async () => {
    s.deleteSafetyRound.mockResolvedValue({ data: null, error: null } as never);
    expect((await DELETE_ROUND(new Request('http://localhost', { method: 'DELETE' }), roundCtx)).status).toBe(409);
    expect(ps.removeRoundPhotoObjects).not.toHaveBeenCalled();
  });

  it('en egen punkt vars foton inte går att läsa tas inte bort (fotona hade aldrig städats)', async () => {
    s.listItemPhotoPaths.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const res = await DELETE_ITEM(new Request('http://localhost', { method: 'DELETE' }), { params: { id: ROUND_ID, itemId: ITEM_ID } });
    expect(res.status).toBe(500);
    expect(s.deleteCustomItem).not.toHaveBeenCalled();
  });
});
