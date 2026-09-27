import { describe, it, expect } from 'vitest';
import { FortnoxApiError } from '@/lib/domains/fortnox/client';
import { fortnoxReason } from '@/scripts/fortnox/testCompany';

describe('fortnoxReason (skripten mot testbolaget)', () => {
  it('ger Fortnox eget meddelande och kod — inte JSON-kroppen, som inte går att gruppera på', () => {
    const body = '{"ErrorInformation":{"error":1,"message":"Artikelnummer \\"16770\\" används redan.","code":2000013}}';
    const e = new FortnoxApiError(400, `Fortnox POST /articles misslyckades (400): ${body}`, 2000013, 'Artikelnummer "16770" används redan.');
    expect(fortnoxReason(e)).toBe('Artikelnummer "16770" används redan. (kod 2000013)');
    // Skriptet grupperar på orsaken utan numret.
    expect(fortnoxReason(e).replace(/"[^"]*"/g, '"…"')).toBe('Artikelnummer "…" används redan. (kod 2000013)');
  });

  it('faller tillbaka på det råa felet när Fortnox inte skickade något meddelande', () => {
    expect(fortnoxReason(new Error('fetch failed'))).toBe('fetch failed');
    expect(fortnoxReason(new FortnoxApiError(503, 'Fortnox GET /articles misslyckades (503): Service Unavailable'))).toBe(
      'Fortnox GET /articles misslyckades (503): Service Unavailable',
    );
  });
});
