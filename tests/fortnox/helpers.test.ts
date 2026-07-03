import { describe, it, expect, vi } from 'vitest';

// claimFortnoxPush importeras från en modul som även importerar getSupabaseAdmin från
// '@/lib/supabase/server' (i typposition). Mocka den så testet inte drar in env-beroenden.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { claimFortnoxPush, buildRotPropertyNote, appendFortnoxTextNote } from '@/lib/domains/fortnox/helpers';

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

describe('buildRotPropertyNote', () => {
  it('combines property designation and BRF org number on one line (double-space separated)', () => {
    expect(buildRotPropertyNote({ property_designation: 'Haggården 6:3', brf_org_number: '769600-1234' }))
      .toBe('Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234');
  });

  it('handles property designation only', () => {
    expect(buildRotPropertyNote({ property_designation: 'Haggården 6:3' }))
      .toBe('Fastighetsbeteckning: Haggården 6:3');
  });

  it('handles BRF org number only', () => {
    expect(buildRotPropertyNote({ brf_org_number: '769600-1234' })).toBe('BRF org.nr: 769600-1234');
  });

  it('returns null when nothing is entered (incl. blanks/null)', () => {
    expect(buildRotPropertyNote(null)).toBeNull();
    expect(buildRotPropertyNote({})).toBeNull();
    expect(buildRotPropertyNote({ property_designation: '   ', brf_org_number: '' })).toBeNull();
  });
});

describe('appendFortnoxTextNote', () => {
  it('adds a new text row when the last row is a priced article row', () => {
    const rows = [{ Description: 'Lösull', Price: 100, Quantity: 1 }];
    const out = appendFortnoxTextNote(rows, 'Fastighetsbeteckning: Haggården 6:3');
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ Description: 'Fastighetsbeteckning: Haggården 6:3' });
  });

  it('MERGES into the last row when it is already a text row (no two consecutive text rows)', () => {
    // Two consecutive text rows make Fortnox turn the second into a bogus priced row.
    const rows = [{ Description: 'Lösull', Price: 100 }, { Description: 'Vindsbjälklag' }];
    const out = appendFortnoxTextNote(rows, 'Fastighetsbeteckning: Haggården 6:3');
    expect(out).toHaveLength(2);
    expect(out[1].Description).toBe('Vindsbjälklag  Fastighetsbeteckning: Haggården 6:3');
  });

  it('is a no-op when the note is null/empty', () => {
    const rows = [{ Description: 'Lösull', Price: 100 }];
    expect(appendFortnoxTextNote(rows, null)).toHaveLength(1);
    expect(appendFortnoxTextNote(rows, '')).toHaveLength(1);
  });
});
