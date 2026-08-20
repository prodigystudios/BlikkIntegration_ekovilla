import { describe, it, expect, vi } from 'vitest';

// claimFortnoxPush importeras från en modul som även importerar getSupabaseAdmin från
// '@/lib/supabase/server' (i typposition). Mocka den så testet inte drar in env-beroenden.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { claimFortnoxPush, buildRotPropertyNote, appendFortnoxTextNote, fortnoxTextRowFields, resolveRotReference, assertLineItemsArePriced, assertOrderRowsSynced } from '@/lib/domains/fortnox/helpers';
import { FortnoxApiError } from '@/lib/domains/fortnox/client';

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
    //
    // ⚠️ Textraden känns igen på symbolen från fortnoxTextRowFields, inte på antalet nycklar.
    // Den gamla kontrollen (`Object.keys(last).length === 1`) slutade gälla när textraderna
    // började bära uttryckliga tomvärden mot Fortnox positionella rad-PUT.
    const rows = [
      { Description: 'Lösull', Price: 100 },
      { ...fortnoxTextRowFields(), Description: 'Vindsbjälklag' },
    ];
    const out = appendFortnoxTextNote(rows, 'Fastighetsbeteckning: Haggården 6:3');
    expect(out).toHaveLength(2);
    expect(out[1].Description).toBe('Vindsbjälklag  Fastighetsbeteckning: Haggården 6:3');
  });

  it('märker textraden med en symbol som aldrig hamnar i payloaden till Fortnox', () => {
    const row = { ...fortnoxTextRowFields(), Description: 'Vindsbjälklag' };
    expect(Object.keys(row)).not.toContain('Symbol(fortnoxTextRow)');
    expect(JSON.parse(JSON.stringify(row))).toEqual({
      Description: 'Vindsbjälklag', ArticleNumber: null, Price: 0, Unit: '', Discount: 0, DiscountType: 'PERCENT',
    });
  });

  // ⚠️ Textraden nämner ALDRIG husarbete. Ett uttryckligt false stämplar EMPTYHOUSEWORK och ett
  // dokument som inte är ROT i Fortnox avvisar fältet med 2004021 — och en orders TaxReductionType
  // sätts bara vid create, så vår rotEnabled kan säga ROT om ett dokument som inte är det. Då hade
  // varje Radtext-rad sänkt hela omsynken.
  it('nämner aldrig husarbete på en textrad', () => {
    expect(fortnoxTextRowFields()).not.toHaveProperty('HouseWork');
    expect(fortnoxTextRowFields()).not.toHaveProperty('HouseWorkType');
  });

  it('is a no-op when the note is null/empty', () => {
    const rows = [{ Description: 'Lösull', Price: 100 }];
    expect(appendFortnoxTextNote(rows, null)).toHaveLength(1);
    expect(appendFortnoxTextNote(rows, '')).toHaveLength(1);
  });
});

// "Ert referensnummer" och ROT-textraden är två halvor av en regel. De låg tidigare som två
// parallella kopior i offers.ts och orders.ts (create + update) — testet låser att exakt EN av
// dem fylls i, så en villa aldrig får både referensfält och rad, och en BRF aldrig tappar båda.
describe('resolveRotReference', () => {
  it('puts a villa fastighetsbeteckning in the reference field, not a row', () => {
    expect(resolveRotReference({ property_designation: 'Haggården 6:3' }, null, true)).toEqual({
      referenceNumber: 'Haggården 6:3',
      propertyNote: null,
    });
  });

  // Bostadsrätt = two values that can't share one field → they ride as a text row instead, and
  // the reference field falls back to the märkning (normally empty for a private ROT customer).
  it('puts a bostadsrätt on a text row and leaves the reference field to the märkning', () => {
    expect(resolveRotReference({ property_designation: 'Haggården 6:3', brf_org_number: '769600-1234' }, null, true)).toEqual({
      referenceNumber: null,
      propertyNote: 'Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234',
    });
  });

  it('uses the företag märkning as the reference number on a non-ROT document', () => {
    expect(resolveRotReference(null, 'Projekt 4711', false)).toEqual({
      referenceNumber: 'Projekt 4711',
      propertyNote: null,
    });
  });

  // ROT details left on a quote whose ROT was later switched off must not leak onto the document.
  it('ignores ROT details when ROT is disabled', () => {
    expect(resolveRotReference({ property_designation: 'Haggården 6:3' }, null, false)).toEqual({
      referenceNumber: null,
      propertyNote: null,
    });
  });

  it('treats blank values as absent', () => {
    expect(resolveRotReference({ property_designation: '   ' }, '  ', true)).toEqual({
      referenceNumber: null,
      propertyNote: null,
    });
  });
});

describe('assertLineItemsArePriced', () => {
  // Sista spärren mot 900-stubbens efterlämningar. Offertformuläret blockerar sparningen, men
  // offerter och arbetsordrar som REDAN ligger i databasen bär raderna med sig och kan pushas när
  // som helst. En sådan rad blir Price 0 på dokumentet kunden får — och på en ROT-offert dessutom
  // carve 0, alltså ingen "Arbetskostnad ROT"-rad och inget avdragsunderlag.

  const priced = { article_name: 'Ekovilla lösull', article_number: '10058', m2: '100', thickness_mm: '200', article_price: 900 };
  const unpriced = { m2: '100', thickness_mm: '200', unit_price: '', article_price: null };

  it('släpper igenom rader med prisförankring', () => {
    expect(() => assertLineItemsArePriced([priced], 'Offerten')).not.toThrow();
    expect(() => assertLineItemsArePriced([{ ...unpriced, unit_price: '750' }], 'Offerten')).not.toThrow();
  });

  it('släpper igenom tomma rader och tomt underlag', () => {
    // En orörd rad bär inget innehåll och byggs aldrig till någon Fortnox-rad.
    expect(() => assertLineItemsArePriced([{ m2: '', unit_price: '', article_price: null }], 'Offerten')).not.toThrow();
    expect(() => assertLineItemsArePriced([], 'Offerten')).not.toThrow();
    expect(() => assertLineItemsArePriced(null, 'Offerten')).not.toThrow();
  });

  it('⚠️ släpper igenom en ren textrad', () => {
    // Regression: spärren läste först `isBlankLineItem` och hade då krävt pris av varje rad med
    // NÅGOT innehåll. En rad med bara radtext, bara konstruktion eller bara ett ikryssat ROT-arbete
    // passerar offertformuläret utan anmärkning — hade pushen avvisat dem med 409 skulle sådana
    // offerter blivit permanent omöjliga att skicka, utan besked om vilken rad som var problemet.
    expect(() => assertLineItemsArePriced([{ line_note: 'Ställning ingår' }], 'Offerten')).not.toThrow();
    expect(() => assertLineItemsArePriced([{ construction: 'vind', thickness_mm: '200' }], 'Offerten')).not.toThrow();
    expect(() => assertLineItemsArePriced([{ is_rot_work: true }], 'Offerten')).not.toThrow();
  });

  it('stoppar en ifylld rad utan pris', () => {
    expect(() => assertLineItemsArePriced([priced, unpriced], 'Offerten')).toThrow(FortnoxApiError);
    expect(() => assertLineItemsArePriced([priced, unpriced], 'Offerten')).toThrow(/Offerten har en rad utan pris/);
  });

  it('räknar rader och namnger rätt dokument', () => {
    expect(() => assertLineItemsArePriced([unpriced, unpriced], 'Arbetsordern'))
      .toThrow(/Arbetsordern har 2 rader utan pris/);
  });

  it('svarar 409 — det är ett underlagsfel, inte ett Fortnox-fel', () => {
    try {
      assertLineItemsArePriced([unpriced], 'Offerten');
      throw new Error('skulle ha kastat');
    } catch (e) {
      expect(e).toBeInstanceOf(FortnoxApiError);
      expect((e as FortnoxApiError).status).toBe(409);
    }
  });

  it('⚠️ ett skrivet 0 kr passerar', () => {
    // En rad som medvetet ingår i priset är inte samma sak som en rad utan priskälla.
    expect(() => assertLineItemsArePriced([{ ...unpriced, unit_price: '0' }], 'Offerten')).not.toThrow();
  });
});

describe('assertOrderRowsSynced', () => {
  // Fakturan byggs av Fortnox ur ORDERNS rader. Ligger inte våra rader där fakturerar vi gammalt
  // underlag till kunden utan att det syns hos oss.

  it('släpper igenom en synkad order', () => {
    expect(() => assertOrderRowsSynced('synced')).not.toThrow();
  });

  it('stoppar varje läge som inte är synkat', () => {
    for (const status of ['not_synced', 'failed', 'pending']) {
      expect(() => assertOrderRowsSynced(status), status).toThrow(FortnoxApiError);
    }
  });

  it('skiljer på "pågår" och "ligger inte i Fortnox"', () => {
    expect(() => assertOrderRowsSynced('pending')).toThrow(/synk mot Fortnox pågår/);
    expect(() => assertOrderRowsSynced('failed')).toThrow(/inte bekräftat synkade/);
    expect(() => assertOrderRowsSynced('not_synced')).toThrow(/inte bekräftat synkade/);
  });

  it('svarar 409 — underlaget är fel, inte Fortnox', () => {
    try {
      assertOrderRowsSynced('failed');
      throw new Error('skulle ha kastat');
    } catch (e) {
      expect(e).toBeInstanceOf(FortnoxApiError);
      expect((e as FortnoxApiError).status).toBe(409);
    }
  });
});
