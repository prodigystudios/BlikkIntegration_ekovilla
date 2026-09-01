import { describe, expect, it } from 'vitest';
import { parseDateParam } from '@/app/tid/dateParam';

// `?datum=` bär genvägarnas dag in i tidrapporten. Två fel att vakta: ett datum som SLINKER IGENOM
// och blir fel dag (ett pass på fel dygn i löneunderlaget), och ett giltigt datum som avvisas (den
// som klickade på gårdagens jobb landar tyst på idag).
describe('parseDateParam', () => {
  it('släpper igenom ett giltigt datum oförändrat', () => {
    expect(parseDateParam('2026-09-01')).toBe('2026-09-01');
    expect(parseDateParam('2026-12-31')).toBe('2026-12-31');
    expect(parseDateParam('2024-02-29')).toBe('2024-02-29'); // skottår
  });

  // ⚠️ KÄRNAN. Formen är rätt, dagen finns inte — och `new Date(2026, 1, 31)` svarar 3 mars utan
  // att klaga. Utan round-trip-provet hade adressen kunnat peka rapporteringen på en annan dag än
  // den som stod i den.
  it('avvisar datum som ser rätt ut men inte finns', () => {
    expect(parseDateParam('2026-02-31')).toBeNull();
    expect(parseDateParam('2026-13-01')).toBeNull();
    expect(parseDateParam('2026-00-10')).toBeNull();
    expect(parseDateParam('2026-04-31')).toBeNull();
    expect(parseDateParam('2025-02-29')).toBeNull(); // inget skottår
  });

  it('avvisar allt som inte är ett datum', () => {
    for (const value of ['', 'idag', '2026-9-1', '26-09-01', '2026-09-01T08:00', 'null', undefined, null]) {
      expect(parseDateParam(value)).toBeNull();
    }
  });

  // Next ger en array när parametern står två gånger. Första värdet vinner — en dubblerad parameter
  // ska inte tyst kasta dagen och öppna på idag.
  it('tar första värdet när parametern står flera gånger', () => {
    expect(parseDateParam(['2026-09-01', '2026-09-02'])).toBe('2026-09-01');
    expect(parseDateParam(['skräp', '2026-09-02'])).toBeNull();
    expect(parseDateParam([])).toBeNull();
  });
});
