import { describe, it, expect, vi } from 'vitest';

// claimFortnoxPush importeras från en modul som även importerar getSupabaseAdmin från
// '@/lib/supabase/server' (i typposition). Mocka den så testet inte drar in env-beroenden.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { claimFortnoxPush } from '@/lib/domains/fortnox/helpers';

// Mock av supabase-kedjan. claimFortnoxPush gör upp till TVÅ försök, vart och ett:
//   .from().update().eq().neq()/.eq().lt().select() → { data, error }
// Varje .from() ger en ny builder; resultaten köas och returneras i tur av .select().
// Inget .or() finns på buildern — anropas det kraschar testet (det ska vi aldrig göra igen).
function mockSupabase(results: Array<{ data: unknown; error: unknown }>) {
  let call = 0;
  const supabase: any = {
    from: vi.fn(() => {
      const builder = {
        update: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        neq: vi.fn(() => builder),
        lt: vi.fn(() => builder),
        select: vi.fn(() => Promise.resolve(results[call++] ?? { data: [], error: null })),
      };
      return builder;
    }),
  };
  return { supabase };
}

const ARGS = ['crm_quotes', 'q1', 'fortnox_sync_status', 'fortnox_offer_claimed_at'] as const;

describe('claimFortnoxPush', () => {
  it('claimar i första försöket när raden inte är pending', async () => {
    const { supabase } = mockSupabase([{ data: [{ id: 'q1' }], error: null }]);
    expect(await claimFortnoxPush(supabase, ...ARGS)).toBe(true);
  });

  it('claimar i andra försöket (stale-återtagning) när raden är pending men gammal', async () => {
    const { supabase } = mockSupabase([
      { data: [], error: null },          // försök 1: raden ÄR pending → 0 rader
      { data: [{ id: 'q1' }], error: null }, // försök 2: pending + stale → claimad
    ]);
    expect(await claimFortnoxPush(supabase, ...ARGS)).toBe(true);
  });

  it('returnerar false när en färsk pending-claim hålls (båda försöken 0 rader)', async () => {
    const { supabase } = mockSupabase([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    expect(await claimFortnoxPush(supabase, ...ARGS)).toBe(false);
  });

  // Regression: ett DB-fel får ALDRIG tolkas som "claim hålls av annan push" — det maskerade
  // tidigare grundbuggen (PostgREST avvisade .or() på UPDATE) som en permanent "synk pågår redan".
  it('kastar vid DB-fel i stället för att svälja det', async () => {
    const { supabase } = mockSupabase([{ data: null, error: { message: 'boom' } }]);
    await expect(claimFortnoxPush(supabase, ...ARGS)).rejects.toThrow(/push-claim/);
  });

  // Regression: claimen får INTE använda .or() (PostgREST avvisar logiska filter på en UPDATE
  // med ett vilseledande "column does not exist"). Buildern saknar .or() helt → skulle krascha.
  it('använder inte .or() på UPDATE:n', async () => {
    const { supabase } = mockSupabase([{ data: [{ id: 'q1' }], error: null }]);
    await claimFortnoxPush(supabase, ...ARGS);
    const builder = supabase.from.mock.results[0].value;
    expect('or' in builder).toBe(false);
    expect(builder.neq).toHaveBeenCalledWith('fortnox_sync_status', 'pending');
  });
});
