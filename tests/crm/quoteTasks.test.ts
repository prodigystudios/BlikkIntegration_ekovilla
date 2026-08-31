import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, memberUser, effectivePermissionsForRole, makeQueryChain } from './helpers/supabase';

// ---------------------------------------------------------------------------
// Mockar måste deklareras INNAN modulimporter
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/quotes', () => ({ getCrmQuoteStatus: vi.fn() }));

vi.mock('@/lib/domains/crm/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/tasks')>();
  return { ...actual, listCrmQuoteTasks: vi.fn(), attachCrmTaskParticipantNames: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// ---------------------------------------------------------------------------
// Importer (efter mock-deklarationer)
// ---------------------------------------------------------------------------

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmQuoteStatus } from '@/lib/domains/crm/quotes';
import { listCrmQuoteTasks, attachCrmTaskParticipantNames } from '@/lib/domains/crm/tasks';
import { buildFollowUpTaskPayload } from '@/app/crm/offerter/quoteSerializers';
import { createCrmTaskSchema } from '@/app/api/crm/tasks/_lib';
import { quoteLabel } from '@/app/crm/lib/quoteDisplay';

const { GET } = await import('@/app/api/crm/quotes/[id]/tasks/route');

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockQuoteStatus = vi.mocked(getCrmQuoteStatus);
const mockListQuoteTasks = vi.mocked(listCrmQuoteTasks);
const mockAttachNames = vi.mocked(attachCrmTaskParticipantNames);

const QUOTE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockAttachNames.mockImplementation(async (_admin, tasks: any[]) =>
    tasks.map((t) => ({ ...t, assignee_name: null, creator_name: null })) as any);
});

function makeRequest() {
  return new Request(`http://localhost/api/crm/quotes/${QUOTE_ID}/tasks`);
}

function context(id = QUOTE_ID) {
  return { params: { id } };
}

// ---------------------------------------------------------------------------
// Grinden: offerten avgör vem som når uppgifterna
// ---------------------------------------------------------------------------

describe('GET /api/crm/quotes/[id]/tasks — behörighetsgrinden', () => {
  it('kräver crm.access', async () => {
    mockGetCurrentUser.mockResolvedValue(memberUser);

    const res = await GET(makeRequest(), context());

    expect(res.status).toBe(403);
    expect(mockListQuoteTasks).not.toHaveBeenCalled();
  });

  // 🧨 Kärnan i hela konstruktionen. Uppgifterna läses med en ELEVATED klient — den enda
  // spärren mot att läsa vilka uppgifter som helst är att offerten först måste ha gått att läsa
  // med SESSIONSKLIENTEN. Faller den ordningen blir offert-id:t i adressen en fri nyckel.
  it('404:ar och kör INGEN elevated fråga när offerten inte syns för sessionsklienten', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockQuoteStatus.mockResolvedValue({ data: null, error: { code: 'PGRST116' } } as any);

    const res = await GET(makeRequest(), context());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.errorDetails.code).toBe('crm_quote_not_found');
    expect(mockListQuoteTasks).not.toHaveBeenCalled();
  });

  it('avvisar ett id som inte är uuid innan offerten ens slås upp', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await GET(makeRequest(), context('inte-ett-uuid'));

    expect(res.status).toBe(400);
    expect(mockQuoteStatus).not.toHaveBeenCalled();
    expect(mockListQuoteTasks).not.toHaveBeenCalled();
  });

  it('läser uppgifterna när offerten syns', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockQuoteStatus.mockResolvedValue({ data: { id: QUOTE_ID, status: 'sent' }, error: null } as any);
    mockListQuoteTasks.mockResolvedValue({
      data: [{
        id: 't1', user_id: 'kollega-1', created_by: 'kollega-1', kind: 'note', title: 'Ring kunden',
        body: null, status: 'active', due_at: null, remind_at: null, completed_at: null,
        created_at: '2026-08-31T08:00:00Z', updated_at: '2026-08-31T08:00:00Z',
        related_type: 'crm_quote', related_id: QUOTE_ID, metadata: { crm: true },
      }],
      error: null,
    } as any);

    const res = await GET(makeRequest(), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockListQuoteTasks).toHaveBeenCalledWith(expect.anything(), QUOTE_ID);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].title).toBe('Ring kunden');
    // Uppgiften ligger på någon annan och kommer ändå med — det är hela poängen med flödet.
    expect(body.data.items[0].user_id).toBe('kollega-1');
  });
});

// ---------------------------------------------------------------------------
// listCrmQuoteTasks — filtren
// ---------------------------------------------------------------------------

describe('listCrmQuoteTasks', () => {
  it('filtrerar på alla tre kolumnerna', async () => {
    const actual = await vi.importActual<typeof import('@/lib/domains/crm/tasks')>('@/lib/domains/crm/tasks');
    const chain = makeQueryChain({ data: [], error: null });
    const admin = { from: vi.fn().mockReturnValue(chain) } as any;

    await actual.listCrmQuoteTasks(admin, QUOTE_ID);

    expect(admin.from).toHaveBeenCalledWith('dashboard_work_items');
    // kind='note' håller MÖTEN utanför — dashboarden delar tabell med uppgifterna.
    expect(chain.eq).toHaveBeenCalledWith('kind', 'note');
    expect(chain.eq).toHaveBeenCalledWith('related_type', 'crm_quote');
    expect(chain.eq).toHaveBeenCalledWith('related_id', QUOTE_ID);
  });
});

// ---------------------------------------------------------------------------
// Uppföljningsuppgiften — regressionsvakt
// ---------------------------------------------------------------------------

describe('buildFollowUpTaskPayload', () => {
  const quote = {
    id: QUOTE_ID,
    project_name: 'Vindsisolering Storgatan 1',
    quote_number: 'OFF-A1B2C3D4',
    notes: null,
    description: null,
  };

  it('kopplar uppgiften till OFFERTEN', () => {
    const payload = buildFollowUpTaskPayload(quote, '2026-09-15', quoteLabel(quote));

    expect(payload.related_type).toBe('crm_quote');
    expect(payload.related_id).toBe(QUOTE_ID);
    expect(payload.related_label).toBe('Vindsisolering Storgatan 1 (#OFF-A1B2C3D4)');
    expect(payload.due_date).toBe('2026-09-15');
  });

  // 🧨 Den ursprungliga buggen: nyttolasten bar `prospect_id`, en nyckel som inte finns i schemat.
  // Zod strippar okända nycklar TYST, så uppgiften skapades utan koppling och gick inte att hitta
  // från offerten. Testet prövar nyttolasten mot det RIKTIGA schemat — ett felstavat eller
  // borttaget fältnamn faller här i stället för att försvinna i tysthet igen.
  it('överlever createCrmTaskSchema utan att tappa kopplingen', () => {
    const payload = buildFollowUpTaskPayload(quote, '2026-09-15', quoteLabel(quote));
    const parsed = createCrmTaskSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.related_type).toBe('crm_quote');
    expect(parsed.data.related_id).toBe(QUOTE_ID);
    expect(parsed.data.related_label).toBe('Vindsisolering Storgatan 1 (#OFF-A1B2C3D4)');
  });

  it('mutationstest: den gamla formen passerar schemat men tappar kopplingen', () => {
    // Beviset att vakten ovan biter. Så här såg nyttolasten ut före fixen.
    const gammal = {
      prospect_id: 'prospekt-1',
      title: 'Följ upp offert: Vindsisolering Storgatan 1',
      priority: 'high' as const,
      due_date: '2026-09-15',
      source: 'crm_quote',
      status: 'open' as const,
    };
    const parsed = createCrmTaskSchema.safeParse(gammal);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.related_type).toBeNull();
    expect(parsed.data.related_id).toBeNull();
    expect('prospect_id' in parsed.data).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// quoteLabel — etiketten som fryses på uppgiften
// ---------------------------------------------------------------------------

describe('quoteLabel', () => {
  it('sätter offertnumret inom parentes', () => {
    expect(quoteLabel({ project_name: 'Vind', quote_number: 'OFF-1' })).toBe('Vind (#OFF-1)');
  });

  it('klarar sig utan offertnummer', () => {
    expect(quoteLabel({ project_name: 'Vind', quote_number: null })).toBe('Vind');
  });
});
