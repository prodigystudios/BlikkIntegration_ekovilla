import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser } from '../crm/helpers/supabase';

// Grinden framför startsidans fakta (säckar, team, klart). Sammanställningen har egna tester
// (scheduleFacts.test.ts); det som prövas HÄR är att rutten bara svarar för placeringar ur läsarens
// EGEN feed — get_my_crm_jobs körd med sessionen — och aldrig för något klienten skickat.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock('@/lib/domains/planning/scheduleFacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/scheduleFacts')>();
  return { ...actual, loadScheduleFacts: vi.fn() };
});

const ADMIN_CLIENT = { __client: 'admin' } as any;
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));

let feedRows: Array<{ segment_id: string; job_day: string }> = [];
let feedError: { message: string } | null = null;
const rpc = vi.fn((_fn: string, _args: unknown) => Promise.resolve(feedError ? { data: null, error: feedError } : { data: feedRows, error: null }));
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({ __client: 'session', rpc })) }));

import { getCurrentUser } from '@/lib/auth/route';
import { loadScheduleFacts } from '@/lib/domains/planning/scheduleFacts';
import { POST } from '@/app/api/crm/planering/my-jobs/facts/route';

const FACT = { plannedSacks: 120, orderSacks: null, staged: false, reported: 45, crew: ['Anna'], material: 'Ekovilla', done: false };
const WEEK = { start_date: '2026-10-19', end_date: '2026-10-25' };

function call(body: unknown) {
  return POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  feedRows = [{ segment_id: 'seg-mine', job_day: '2026-10-22' }];
  feedError = null;
  (getCurrentUser as any).mockResolvedValue(memberUser);
  (loadScheduleFacts as any).mockResolvedValue({ data: { 'seg-mine|2026-10-22': FACT }, error: null });
});

describe('POST /api/crm/planering/my-jobs/facts', () => {
  it('svarar med fakta för läsarens egna placeringar', async () => {
    const json = await (await call(WEEK)).json();
    expect(json.ok).toBe(true);
    expect(json.data.facts).toEqual({ 'seg-mine|2026-10-22': FACT });
  });

  // ⛔ HUVUDVAKTEN. Placeringarna kommer ur feeden med SESSIONEN — besättningsvillkoret — och bara de
  // går vidare till admin-läsningen. Ett id i kroppen påverkar ingenting.
  it('frågar feeden med sessionen, och läser fakta bara för feedens rader', async () => {
    await call({ ...WEEK, segment_ids: ['seg-någon-annans'] });
    expect(rpc).toHaveBeenCalledWith('get_my_crm_jobs', { start_date: '2026-10-19', end_date: '2026-10-25' });
    expect(loadScheduleFacts).toHaveBeenCalledWith(ADMIN_CLIENT, feedRows);
  });

  it('en tom feed ger inga fakta, och ingen admin-läsning', async () => {
    feedRows = [];
    const json = await (await call(WEEK)).json();
    expect(json.data.facts).toEqual({});
    expect(loadScheduleFacts).not.toHaveBeenCalled();
  });

  it('ett fel i feeden är ett fel, inte en tom vecka', async () => {
    feedError = { message: 'tillfälligt fel' };
    expect((await call(WEEK)).status).toBe(500);
    expect(loadScheduleFacts).not.toHaveBeenCalled();
  });

  it('svarar utan team när besättningen inte gick att läsa, och säger det', async () => {
    (loadScheduleFacts as any).mockResolvedValue({ data: { 'seg-mine|2026-10-22': { ...FACT, crew: [] } }, error: { message: 'besättning' } });
    const res = await call(WEEK);
    expect(res.status).toBe(200);
    expect((await res.json()).data.incomplete).toBe(true);
  });

  it('kunde placeringarna inte läsas är det 500', async () => {
    (loadScheduleFacts as any).mockResolvedValue({ data: null, error: { message: 'trasigt' } });
    expect((await call(WEEK)).status).toBe(500);
  });

  it('avvisar trasiga och för långa perioder', async () => {
    expect((await call({ start_date: '19 okt', end_date: '2026-10-25' })).status).toBe(400);
    expect((await call({ start_date: '2026-10-25', end_date: '2026-10-19' })).status).toBe(400);
    expect((await call({ start_date: '2026-01-01', end_date: '2026-03-01' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('utan inloggning 401', async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    expect((await call(WEEK)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
