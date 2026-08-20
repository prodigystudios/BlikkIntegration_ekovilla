import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memberUser } from './helpers/supabase';

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
  };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { createSackReports, listSackReports, listWorkOrderSegments } from '@/lib/domains/planning/reports';

const { GET, POST } = await import('@/app/api/crm/work-orders/[id]/sack-reports/route');

const mockUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listSackReports);
const mockCreate = vi.mocked(createSackReports);
const mockSegments = vi.mocked(listWorkOrderSegments);

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

afterEach(() => {
  vi.restoreAllMocks();
});
