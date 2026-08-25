import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { effectivePermissionsForRole, memberUser, salesUser } from './helpers/supabase';
import { parseSackInput } from '@/app/crm/lib/format';

// Säckrapporteringens rutt. Det som prövas här är inte att en insert går igenom, utan att routen
// inte litar på klienten och att de två spärrarna faktiskt spärrar:
//
//   * en delrapport efter egenkontrollen är en TYST NOLLOPERATION om den släpps igenom — raden
//     landar men totalen rör sig inte, för finalen vinner,
//   * work_order_id och segment_id kommer från servern, aldrig ur kroppen. RLS gatar på
//     work_order_id, så en klient som fick välja det själv hade valt ett jobb hen är besättning på,
//   * `nearest`-reserven måste LOGGAS. Faller den ut tyst hamnar säckarna på en bil som kanske hör
//     till en annan depå, och depåsaldot blir fel utan att något felar.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/planning/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/reports')>();
  return {
    ...actual,
    listSackReports: vi.fn(),
    createSackReports: vi.fn(),
    listWorkOrderSegments: vi.fn(),
    deleteSackReportsByIds: vi.fn(),
    getSackReport: vi.fn(),
    deleteSackReport: vi.fn(),
  };
});

// Behörigheterna avgör om LÄSAREN är kontoret (planning.schedule.write). Mockas explicit:
// getEffectivePermissions faller tillbaka på en tom mängd vid fel, så utan den här mocken hade
// varje läsare sett ut som fältet och kontorets can_delete aldrig prövats.
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  createSackReports,
  deleteSackReport,
  deleteSackReportsByIds,
  getSackReport,
  listSackReports,
  listWorkOrderSegments,
} from '@/lib/domains/planning/reports';

const { GET, POST } = await import('@/app/api/crm/work-orders/[id]/sack-reports/route');
const { POST: POST_FINAL } = await import('@/app/api/crm/work-orders/[id]/sack-reports/final/route');
const { DELETE } = await import('@/app/api/crm/work-orders/[id]/sack-reports/[reportId]/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listSackReports);
const mockCreate = vi.mocked(createSackReports);
const mockSegments = vi.mocked(listWorkOrderSegments);
const mockDelete = vi.mocked(deleteSackReportsByIds);
const mockGetOne = vi.mocked(getSackReport);
const mockDeleteOne = vi.mocked(deleteSackReport);
const mockPerms = vi.mocked(getEffectivePermissions);

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const SEGMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SEGMENT_ID = '22222222-2222-4222-8222-222222222222';
const ctx = { params: { id: WORK_ORDER_ID } };

const installer = { ...memberUser, name: 'Kalle Karlsson' };

function postReq(payload: unknown) {
  return new Request('http://localhost/api/crm/work-orders/x/sack-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
const getReq = () => new Request('http://localhost/api/crm/work-orders/x/sack-reports');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    segment_id: SEGMENT_ID,
    work_order_id: WORK_ORDER_ID,
    report_day: '2026-08-18',
    sacks_blown: '30.00',
    kind: 'partial',
    material: 'EKOVILLA',
    construction: 'vind',
    note: null,
    created_by: installer.id,
    created_by_name: 'Kalle Karlsson',
    created_at: '2026-08-18T09:00:00Z',
    ...overrides,
  };
}

const BODY = { report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 30 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(installer);
  mockList.mockResolvedValue({ data: [], error: null } as never);
  mockSegments.mockResolvedValue([{ id: SEGMENT_ID, start_day: '2026-08-17', end_day: '2026-08-19' }]);
  mockCreate.mockResolvedValue({ data: [row()], error: null } as never);
  mockDelete.mockResolvedValue({ error: null } as never);
  mockGetOne.mockResolvedValue({ data: row(), error: null } as never);
  mockDeleteOne.mockResolvedValue({ data: { id: 'r1' }, error: null } as never);
  mockPerms.mockImplementation(async () => effectivePermissionsForRole((await mockUser())?.role));
});

describe('GET /sack-reports', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(getReq(), ctx)).status).toBe(401);
  });

  it('märker delrapporterna som ersatta när en final finns, och flaggar has_final', async () => {
    mockList.mockResolvedValue({
      data: [row({ id: 'f1', kind: 'final', sacks_blown: '91.00' }), row({ id: 'p1', sacks_blown: '30.00' })],
      error: null,
    } as never);

    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.has_final).toBe(true);
    expect(body.data.items.map((i: any) => [i.id, i.superseded])).toEqual([['f1', false], ['p1', true]]);
  });

  it('utan final är ingenting ersatt', async () => {
    mockList.mockResolvedValue({ data: [row(), row({ id: 'r2' })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.has_final).toBe(false);
    expect(body.data.items.every((i: any) => !i.superseded)).toBe(true);
  });

  // numeric(10,2) kommer tillbaka som sträng från PostgREST. Skickas den vidare orörd blir
  // "30" + "25" en strängkonkatenering någonstans i UI:t.
  it('säckarna är TAL i svaret, inte strängar', async () => {
    mockList.mockResolvedValue({ data: [row({ sacks_blown: '30.50' })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].sacks_blown).toBe(30.5);
  });

  it('en rad utan snapshottat namn visas som Okänd i stället för tomt', async () => {
    mockList.mockResolvedValue({ data: [row({ created_by_name: null })], error: null } as never);
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.data.items[0].created_by_name).toBe('Okänd');
  });
});

// ── can_delete ──────────────────────────────────────────────────────────────
// Flaggan MÅSTE spegla de två DELETE-policyerna (kontoret via planning.schedule.write, rapportören
// via ops_segment_reports_delete_own_partial). Glider de isär ritar korten en knapp som svarar
// 403 — och att inte rita den där borttagning faktiskt är tillåten är lika illa: då står
// dubbletten kvar och kontoret får gå till databasen, vilket är hela problemet som skulle bort.
describe('GET /sack-reports — vem som får ta bort raden', () => {
  const canDelete = async () => (await (await GET(getReq(), ctx)).json()).data.items.map((i: any) => [i.id, i.can_delete]);

  it('rapportören får ta bort sin EGEN delrapport, men inte kollegans', async () => {
    mockList.mockResolvedValue({
      data: [row({ id: 'min' }), row({ id: 'kollegans', created_by: 'user-annan-installatör' })],
      error: null,
    } as never);
    expect(await canDelete()).toEqual([['min', true], ['kollegans', false]]);
  });

  // Den här är hela skälet till att villkoret står i policyn och inte bara i routen: dörr 1
  // skriver finalerna med installatörens eget created_by, så ägarskapet ensamt hade gett hen
  // delete på sin egen egenkontroll. Försvinner orderns sista final släpps delrapporterna fram
  // som total igen — borttagningen hade HÖJT siffran.
  it('inte ens sin egen egenkontrollrad — den rättas genom att lämnas in på nytt', async () => {
    mockList.mockResolvedValue({ data: [row({ id: 'f1', kind: 'final' })], error: null } as never);
    expect(await canDelete()).toEqual([['f1', false]]);
  });

  it('kontoret får ta bort vilken delrapport som helst på jobbet', async () => {
    mockUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({
      data: [row({ id: 'p1', created_by: 'någon-helt-annan' }), row({ id: 'f1', kind: 'final' })],
      error: null,
    } as never);
    expect(await canDelete()).toEqual([['p1', true], ['f1', false]]);
  });

  it('en ersatt delrapport går fortfarande att ta bort — regeln är om RADEN, inte om totalen', async () => {
    mockList.mockResolvedValue({
      data: [row({ id: 'f1', kind: 'final', created_by: 'någon-annan' }), row({ id: 'p1' })],
      error: null,
    } as never);
    expect(await canDelete()).toEqual([['f1', false], ['p1', true]]);
  });

  it('raderna rapportören just skrev bär flaggan direkt — dubbeltrycket ska gå att ta tillbaka på plats', async () => {
    const body = await (await POST(postReq(BODY), ctx)).json();
    expect(body.data.items.every((i: any) => i.can_delete)).toBe(true);
  });
});

describe('POST /sack-reports — spärrarna', () => {
  it('nekar med 409 när egenkontrollen redan är inlämnad', async () => {
    mockList.mockResolvedValue({ data: [row({ kind: 'final' })], error: null } as never);

    const res = await POST(postReq(BODY), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.errorDetails.code).toBe('crm_work_order_sack_report_final_exists');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('nekar med 400 när jobbet inte har någon planerad dag alls', async () => {
    mockSegments.mockResolvedValue([]);
    const res = await POST(postReq(BODY), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_sack_report_no_segment');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('svarar 403, inte 500, när RLS avvisar skrivningen', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } } as never);
    const res = await POST(postReq(BODY), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_sack_report_forbidden');
  });
});

describe('POST /sack-reports — vad som faktiskt skrivs', () => {
  it('stämplar servern segment, arbetsorder, kind och rapportörens namn', async () => {
    await POST(postReq({ ...BODY, note: '  Trögt på vinden  ' }), ctx);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toEqual([
      {
        segment_id: SEGMENT_ID,
        work_order_id: WORK_ORDER_ID,
        report_day: '2026-08-18',
        sacks_blown: 30,
        kind: 'partial',
        material: null,
        construction: 'vind',
        note: 'Trögt på vinden',
        created_by: installer.id,
        created_by_name: 'Kalle Karlsson',
      },
    ]);
  });

  // ⚠️ RLS gatar på work_order_id. Fick klienten välja det själv hade den valt ett jobb hen är
  // besättning på och skrivit säckar där.
  it('ignorerar work_order_id och segment_id i kroppen', async () => {
    const hijack = '99999999-9999-4999-8999-999999999999';
    await POST(postReq({ ...BODY, work_order_id: hijack, segment_id: hijack }), ctx);

    const written = mockCreate.mock.calls[0][1][0];
    expect(written.work_order_id).toBe(WORK_ORDER_ID);
    expect(written.segment_id).toBe(SEGMENT_ID);
  });

  it('flera placeringar i EN submit, med dagens datum och notering på varje rad', async () => {
    await POST(
      postReq({
        report_day: '2026-08-18',
        note: 'Dålig täckning',
        entries: [
          { construction: 'vind', sacks_blown: 30, material: 'EKOVILLA' },
          { construction: 'snedtak', sacks_blown: 12 },
          { construction: 'vagg', sacks_blown: 0 },
        ],
      }),
      ctx,
    );

    const written = mockCreate.mock.calls[0][1];
    expect(written).toHaveLength(1 * 3);
    expect(written.map((r) => r.construction)).toEqual(['vind', 'snedtak', 'vagg']);
    expect(written.map((r) => r.material)).toEqual(['EKOVILLA', null, null]);
    expect(written.every((r) => r.report_day === '2026-08-18' && r.note === 'Dålig täckning')).toBe(true);
  });

  // "Vi var här, inget gick åt" är ett svar — till skillnad från att inte rapportera alls.
  it('noll säckar är en giltig rapport', async () => {
    const res = await POST(postReq({ report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 0 }] }), ctx);
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1][0].sacks_blown).toBe(0);
  });

  it('dörr 2 skriver aldrig en final, inte ens om kroppen ber om det', async () => {
    await POST(postReq({ ...BODY, kind: 'final', entries: [{ construction: 'vind', sacks_blown: 30, kind: 'final' }] }), ctx);
    expect(mockCreate.mock.calls[0][1][0].kind).toBe('partial');
  });
});

describe('POST /sack-reports — segmentupplösningen', () => {
  it('väljer det segment som TÄCKER dagen, inte det första i listan', async () => {
    mockSegments.mockResolvedValue([
      { id: OTHER_SEGMENT_ID, start_day: '2026-08-10', end_day: '2026-08-12' },
      { id: SEGMENT_ID, start_day: '2026-08-17', end_day: '2026-08-19' },
    ]);
    await POST(postReq(BODY), ctx);
    expect(mockCreate.mock.calls[0][1][0].segment_id).toBe(SEGMENT_ID);
  });

  it('LOGGAR när närmaste-reserven faller ut — annars är den osynlig', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSegments.mockResolvedValue([{ id: OTHER_SEGMENT_ID, start_day: '2026-08-10', end_day: '2026-08-12' }]);

    const res = await POST(postReq(BODY), ctx);

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1][0].segment_id).toBe(OTHER_SEGMENT_ID);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(OTHER_SEGMENT_ID);
    warn.mockRestore();
  });

  it('loggar INTE när dagen täcks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await POST(postReq(BODY), ctx);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('POST /sack-reports — validering', () => {
  const cases: Array<[string, unknown]> = [
    ['ingen placering alls', { report_day: '2026-08-18', entries: [] }],
    ['okänd placering', { report_day: '2026-08-18', entries: [{ construction: 'takstol', sacks_blown: 5 }] }],
    ['placering saknas', { report_day: '2026-08-18', entries: [{ sacks_blown: 5 }] }],
    ['negativa säckar', { report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: -1 }] }],
    ['okänt material', { report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 5, material: 'GLASULL' }] }],
    ['trasigt datum', { report_day: '18/8 2026', entries: [{ construction: 'vind', sacks_blown: 5 }] }],
    ['tom kropp', null],
  ];

  for (const [label, payload] of cases) {
    it(`avvisar: ${label}`, async () => {
      const res = await POST(postReq(payload), ctx);
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  }

  // Boken är append-only — ett dubbeltryck går inte att ta tillbaka från fältet.
  it('avvisar samma placering två gånger i samma submit', async () => {
    const res = await POST(
      postReq({ report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 30 }, { construction: 'vind', sacks_blown: 5 }] }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepterar de fem placeringarna, inklusive de nya', async () => {
    const res = await POST(
      postReq({
        report_day: '2026-08-18',
        entries: [
          { construction: 'vagg', sacks_blown: 1 },
          { construction: 'snedtak', sacks_blown: 1 },
          { construction: 'vind', sacks_blown: 1 },
          { construction: 'golv', sacks_blown: 1 },
          { construction: 'mellanbjalklag', sacks_blown: 1 },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1]).toHaveLength(5);
  });

  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST(postReq(BODY), ctx)).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('avvisar ett ogiltigt arbetsorder-id innan något läses', async () => {
    const res = await POST(postReq(BODY), { params: { id: 'inte-ett-uuid' } });
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });
});


// ── Dörr 1: egenkontrollen ──────────────────────────────────────────────────
// Egenkontrollen är jobbets FULLA sanning, inte ett tillägg. En ny egenkontroll ERSÄTTER orderns
// tidigare finaler mängdvis, så en omarkering rättar boken i stället för att stapla på den.

const FINAL_BODY = {
  report_day: '2026-08-18',
  entries: [
    { construction: 'vind', sacks_blown: 60, material: 'EKOVILLA' },
    { construction: null, sacks_blown: 31 },
  ],
};

describe('POST /sack-reports/final — dörr 1', () => {
  it('skriver finaler, inte delrapporter, och godtar Ospecificerad', async () => {
    const res = await POST_FINAL(postReq(FINAL_BODY), ctx);
    expect(res.status).toBe(201);

    const written = mockCreate.mock.calls[0][1];
    expect(written.every((r) => r.kind === 'final')).toBe(true);
    expect(written.map((r) => r.construction)).toEqual(['vind', null]);
    expect(written.map((r) => r.material)).toEqual(['EKOVILLA', null]);
    expect(written.every((r) => r.work_order_id === WORK_ORDER_ID && r.segment_id === SEGMENT_ID)).toBe(true);
  });

  // 🧨 Databasens CHECK avvisar tomma strängen, och den insert:en sitter mitt i installatörens
  // egenkontrollsparning.
  it('placeringen är null och aldrig tomma strängen', async () => {
    await POST_FINAL(postReq({ report_day: '2026-08-18', entries: [{ sacks_blown: 5 }] }), ctx);
    expect(mockCreate.mock.calls[0][1][0].construction).toBeNull();
  });

  it('ersätter orderns tidigare finaler — och rör INTE delrapporterna', async () => {
    mockList.mockResolvedValue({
      data: [row({ id: 'gammal-final-1', kind: 'final' }), row({ id: 'gammal-final-2', kind: 'final' }), row({ id: 'delrapport', kind: 'partial' })],
      error: null,
    } as never);

    const body = await (await POST_FINAL(postReq(FINAL_BODY), ctx)).json();

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][1]).toEqual(['gammal-final-1', 'gammal-final-2']);
    expect(body.data.replaced).toBe(2);
  });

  // ⚠️ ORDNINGEN. Delete först och en misslyckad insert hade tagit bort egenkontrollens siffra ur
  // boken, tyst. Insert först och en misslyckad delete ger en för hög total — synlig i spåret och
  // lagningsbar.
  it('skriver de nya raderna FÖRE den gamla uppsättningen tas bort', async () => {
    mockList.mockResolvedValue({ data: [row({ id: 'gammal', kind: 'final' })], error: null } as never);
    await POST_FINAL(postReq(FINAL_BODY), ctx);
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0]);
  });

  it('en misslyckad insert lämnar den gamla uppsättningen orörd', async () => {
    mockList.mockResolvedValue({ data: [row({ id: 'gammal', kind: 'final' })], error: null } as never);
    mockCreate.mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } } as never);

    const res = await POST_FINAL(postReq(FINAL_BODY), ctx);

    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('en misslyckad radering flaggas i svaret och loggas i stället för att tigas ihjäl', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockList.mockResolvedValue({ data: [row({ id: 'gammal', kind: 'final' })], error: null } as never);
    mockDelete.mockResolvedValue({ error: { message: 'nätverket dog' } } as never);

    const body = await (await POST_FINAL(postReq(FINAL_BODY), ctx)).json();

    expect(body.data.recorded).toBe(true);
    expect(body.data.replace_failed).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('inget att ersätta → ingen raderingssats alls', async () => {
    const body = await (await POST_FINAL(postReq(FINAL_BODY), ctx)).json();
    expect(body.data.replaced).toBe(0);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), []);
  });

  // ⛔ Egenkontrollen kan öppnas på en OPLANERAD order — uppslaget sker på ordernummer och är
  // avsiktligt ospärrat. Installatören ska aldrig se ett fel för det.
  it('en oplanerad order är 200 med ett skäl, inte ett fel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSegments.mockResolvedValue([]);

    const res = await POST_FINAL(postReq(FINAL_BODY), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ recorded: false, reason: 'not_scheduled', replaced: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Till skillnad från dörr 2: två etapprader kan mycket väl vara samma konstruktion.
  it('tillåter samma placering två gånger', async () => {
    const res = await POST_FINAL(
      postReq({ report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 30 }, { construction: 'vind', sacks_blown: 25 }] }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][1]).toHaveLength(2);
  });

  it('avvisar okänd placering, okänt material och tom lista', async () => {
    for (const payload of [
      { report_day: '2026-08-18', entries: [{ construction: 'takstol', sacks_blown: 5 }] },
      { report_day: '2026-08-18', entries: [{ construction: 'vind', sacks_blown: 5, material: 'GLASULL' }] },
      { report_day: '2026-08-18', entries: [] },
    ]) {
      expect((await POST_FINAL(postReq(payload), ctx)).status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST_FINAL(postReq(FINAL_BODY), ctx)).status).toBe(401);
  });
});

// Fältets inmatningsregel. En nolla är ett PÅSTÅENDE i den här boken ("vi var här, inget gick åt"),
// så tomt och oläsbart får aldrig bli 0 — huvudboken är append-only och besättningen kan inte
// rätta en felskriven rad.
describe('parseSackInput', () => {
  it('tar emot heltal och upp till två decimaler, komma eller punkt', () => {
    expect(parseSackInput('30')).toBe(30);
    expect(parseSackInput(' 12,5 ')).toBe(12.5);
    expect(parseSackInput('1.25')).toBe(1.25);
    expect(parseSackInput('0')).toBe(0);
  });

  it('tomt, bokstäver och minus ger null — INTE noll', () => {
    for (const raw of ['', '   ', 'abv', '-5', '3-', '1,2,3', '1,234']) {
      expect(parseSackInput(raw), raw).toBeNull();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── DELETE /sack-reports/[reportId] ─────────────────────────────────────────
// Rättningen av en dubbelrapporterad dag. Boken kunde bara växa (en ny rad ADDERAR, kolumnen har
// `check (sacks_blown >= 0)`), så innan den här vägen fanns var manuell radering i Supabase enda
// utvägen när två installatörer med dålig mottagning tryckte Spara två gånger.
//
// Det som prövas är inte att en delete går igenom, utan att routen ger RÄTT NEJ: en final ska
// avvisas med ett skäl, och en delete som RLS nekade får aldrig rapporteras som lyckad.

const reportCtx = { params: { id: WORK_ORDER_ID, reportId: '99999999-9999-4999-8999-999999999999' } };
const delReq = () => new Request('http://localhost/api/crm/work-orders/x/sack-reports/y', { method: 'DELETE' });

describe('DELETE /sack-reports/[reportId]', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await DELETE(delReq(), reportCtx)).status).toBe(401);
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });

  it('avvisar ogiltiga id:n innan något läses', async () => {
    const res = await DELETE(delReq(), { params: { id: WORK_ORDER_ID, reportId: 'inte-ett-uuid' } });
    expect(res.status).toBe(400);
    expect(mockGetOne).not.toHaveBeenCalled();
  });

  it('tar bort raden och svarar med id:t', async () => {
    const res = await DELETE(delReq(), reportCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(reportCtx.params.reportId);
  });

  // Radens adress är BÅDE ordern och raden. Utan orderfiltret kan en rad på en annan arbetsorder
  // tas bort genom den här orderns adress.
  it('läser och raderar på arbetsordern OCH raden, aldrig bara raden', async () => {
    await DELETE(delReq(), reportCtx);
    expect(mockGetOne.mock.calls[0].slice(1)).toEqual([reportCtx.params.reportId, WORK_ORDER_ID]);
    expect(mockDeleteOne.mock.calls[0].slice(1)).toEqual([reportCtx.params.reportId, WORK_ORDER_ID]);
  });

  it('en rad som inte finns är 404, inte ett tyst 200', async () => {
    mockGetOne.mockResolvedValue({ data: null, error: null } as never);
    expect((await DELETE(delReq(), reportCtx)).status).toBe(404);
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });

  // Egenkontrollen är jobbets slutsumma. Försvinner orderns sista final vinner delrapporterna
  // igen, och en borttagning som skulle sänka siffran höjer den (30 + 25 där svaret var 91).
  it('nekar egenkontrollens rader med 409 och ett skäl — och rör dem inte', async () => {
    mockGetOne.mockResolvedValue({ data: row({ kind: 'final' }), error: null } as never);
    const res = await DELETE(delReq(), reportCtx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/egenkontrollen/i);
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });

  // 🧨 PostgREST svarar `error: null` på en DELETE som inte träffar någon rad — den ser exakt ut
  // som en lyckad borttagning. Utan raden tillbaka hade kollegans misslyckade försök gett ett 200,
  // kortet tagit bort raden ur listan, och nästa laddning visat den igen.
  it('en delete som RLS nekade är 403, aldrig ett 200 på noll rader', async () => {
    mockDeleteOne.mockResolvedValue({ data: null, error: null } as never);
    const res = await DELETE(delReq(), reportCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/skrev rapporten|kontoret/i);
  });

  it('ett riktigt databasfel är 500, inte 403', async () => {
    mockDeleteOne.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    expect((await DELETE(delReq(), reportCtx)).status).toBe(500);
  });
});

// ⚠️ can_delete i routen och DELETE-policyn i databasen är SAMMA REGEL skriven två gånger — den
// ena i TypeScript, den andra i SQL som typsystemet inte når. Glider de isär ritar korten en
// knapp som svarar 403 (eller, värre, döljer en knapp som skulle ha fungerat och skickar kontoret
// till Supabase igen). Testet läser migreringsfilen och kräver att de tre villkoren står kvar.
describe('paritet med DELETE-policyn i databasen', () => {
  const policy = (() => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/sql/20260825_ops_segment_reports_delete_own_partial.sql'),
      'utf8',
    );
    return sql.match(/create policy ops_segment_reports_delete_own_partial[\s\S]*?using \(([\s\S]*?)\n  \);/)?.[1] ?? '';
  })();

  it('hittade policyn i migreringsfilen', () => {
    expect(policy).not.toBe('');
  });

  it('nekar finaler — villkoret som hindrar att en borttagning HÖJER jobbets total', () => {
    expect(policy).toMatch(/kind = 'partial'/);
  });

  it('bara rapportörens egen rad, och bara på ett jobb hen är besättning på', () => {
    expect(policy).toMatch(/created_by = auth\.uid\(\)/);
    expect(policy).toMatch(/is_user_on_work_order\(auth\.uid\(\), work_order_id\)/);
  });
});
