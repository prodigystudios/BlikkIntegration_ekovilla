import { describe, it, expect } from 'vitest';
import { validateReport, sacksRemaining, sacksOverrun, sackProgressState } from '@/lib/domains/planning/reports';

describe('validateReport', () => {
  it('accepts a valid report', () => {
    expect(validateReport('2026-06-17', 12)).toBeNull();
    expect(validateReport('2026-06-17', 0)).toBeNull();
  });
  it('rejects a bad date', () => {
    expect(validateReport('2026/06/17', 12)).toBe('invalid_date');
  });
  it('rejects a negative or non-finite amount', () => {
    expect(validateReport('2026-06-17', -1)).toBe('invalid_amount');
    expect(validateReport('2026-06-17', Number.NaN)).toBe('invalid_amount');
  });
});

// Badgens läge på planeringskortet. Färgen är inte kosmetik — den ändrar vad talet BETYDER: gult
// "kvar 36 / 564" är trettiosex säckar kvar att blåsa, grönt "36 av 564" ett avräknat jobb.
describe('sackProgressState', () => {
  it('inget planerat, inget rapporterat, ingen egenkontroll → ingen badge', () => {
    expect(sackProgressState(0, 0, false)).toBe('hidden');
  });

  it('bara planen → planerat läge', () => {
    expect(sackProgressState(280, 0, false)).toBe('planned');
  });

  it('delrapporterat → pågår', () => {
    expect(sackProgressState(564, 528, false)).toBe('remaining');
  });

  it('delrapporterat över planen → överdrag', () => {
    expect(sackProgressState(168, 174, false)).toBe('overrun');
  });

  it('egenkontroll → slutsumma', () => {
    expect(sackProgressState(564, 528, true)).toBe('final');
    expect(sackProgressState(280, 280, true)).toBe('final');
  });

  // Överdraget behåller sitt eget läge även med egenkontroll: att jobbet är avräknat gör inte
  // överförbrukningen mindre sann, och det är den kortet ska larma om.
  it('egenkontroll över planen larmar fortfarande', () => {
    expect(sackProgressState(168, 174, true)).toBe('final-overrun');
  });

  // 🧨 REGRESSIONSVAKTEN. En ifylld NOLLA i egenkontrollen är ett svar — "vi var här, inget gick
  // åt" — och finalSackEntriesFromEtappRows behåller den med flit. Prövas `final` inuti
  // `reported > 0` faller fallet ut som 'planned' och kortet visar samma sak som för ett jobb ingen
  // rapporterat något på. Då är skillnaden mellan "inget gick åt" och "vi vet inte" raderad.
  // Granskningen fångade det en gång; det här testet finns för att det inte ska gå att återinföra.
  it('egenkontroll med NOLLA säckar är fortfarande en slutsumma, inte "bara planerat"', () => {
    expect(sackProgressState(30, 0, true)).toBe('final');
    expect(sackProgressState(30, 0, false)).toBe('planned');
  });

  it('egenkontroll utan plan och utan säckar syns ändå', () => {
    expect(sackProgressState(0, 0, true)).toBe('final');
  });
});

describe('sacksRemaining', () => {
  it('is planned minus blown', () => {
    expect(sacksRemaining(130, 46)).toBe(84);
  });
  it('floors at zero (never negative)', () => {
    expect(sacksRemaining(40, 55)).toBe(0);
  });
});

describe('sacksOverrun', () => {
  it('is zero while within plan', () => {
    expect(sacksOverrun(130, 46)).toBe(0);
    expect(sacksOverrun(40, 40)).toBe(0);
  });
  it('is blown minus planned once over plan', () => {
    expect(sacksOverrun(40, 55)).toBe(15);
  });
});
