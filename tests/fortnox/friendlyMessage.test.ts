import { describe, it, expect, vi } from 'vitest';

// client.ts importerar getSupabaseAdmin i toppen (för tokenlagringen). Mocka bort den så testet
// inte drar in env-beroenden — samma mönster som helpers.test.ts.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';

describe('friendlyFortnoxMessage', () => {
  // FortnoxApiError.message ÄR den tekniska loggsträngen. Den får aldrig nå en säljare —
  // rutter som visade e.message rakt av läckte "Fortnox POST /orders (400): {…}" i en toast.
  it('never returns the technical log string', () => {
    const e = new FortnoxApiError(400, 'Fortnox POST /orders (400): {"ErrorInformation":{...}}', 2004021, 'Dokument med skattereduktionstypen \'none\'…');
    expect(friendlyFortnoxMessage(e)).not.toContain('Fortnox POST');
    expect(friendlyFortnoxMessage(e)).not.toContain('400');
  });

  // 2004021 pekar ut fel ställe i Fortnox egen text: typen sitter på ARTIKELN (ärvs ner på raden,
  // kan inte överröstas därifrån), inte på dokumentet man just försökte spara. Texten måste också
  // säga att den är OSYNLIG i Fortnox artikelvy — annars letar man förgäves, vilket hände 2026-08-12.
  it('translates 2004021 into an actionable instruction about the article', () => {
    const e = new FortnoxApiError(400, 'teknisk sträng', 2004021, "Dokument med skattereduktionstypen 'none' får inte innehålla rader med husarbetestypen 'CONSTRUCTION'.");
    const message = friendlyFortnoxMessage(e);
    expect(message).toContain('husarbetestyp');
    expect(message).toContain('ARTIKELN');
    expect(message).toContain('HouseworkType: null');
  });

  // Okända koder ska falla tillbaka på Fortnox egen svenska text — den är oftast läsbar och
  // alltid bättre än den tekniska strängen.
  it('falls back to the Fortnox message for an unmapped code', () => {
    const e = new FortnoxApiError(400, 'teknisk sträng', 999999, 'Något specifikt från Fortnox.');
    expect(friendlyFortnoxMessage(e)).toBe('Något specifikt från Fortnox.');
  });

  it('explains a missing Fortnox connection instead of failing cryptically', () => {
    expect(friendlyFortnoxMessage(new FortnoxNotConnectedError())).toContain('Fortnox är inte kopplat');
  });

  it('has a safe generic answer for a non-Fortnox error', () => {
    expect(friendlyFortnoxMessage(new Error('boom'))).toBe('Något gick fel. Försök igen.');
  });
});
