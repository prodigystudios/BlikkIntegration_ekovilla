import { describe, it, expect } from 'vitest';
import {
  groupSackReportsByConstruction,
  totalReportedSacks,
  UNSPECIFIED_CONSTRUCTION_LABEL,
} from '@/lib/domains/planning/sackLedger';

// Grupperingen som säckrapport-kortet renderar. Den bär en fälla som inte syns i en skärmdump:
// efter en egenkontroll ligger delrapporterna KVAR i boken. Räknas de med i gruppsumman läser den
// som står i kryputrymmet 30 + 25 + 91 = 146 och tror att talen inte går ihop — men de måste
// samtidigt SYNAS, annars ser det ut som att en rapport försvunnit.

const r = (construction: string | null, sacks: number, superseded = false, id = `${construction}-${sacks}`) =>
  ({ id, construction, sacks_blown: sacks, superseded });

describe('groupSackReportsByConstruction', () => {
  it('grupperar per placering och summerar', () => {
    const groups = groupSackReportsByConstruction([r('vind', 30), r('vind', 25), r('vagg', 12)]);
    expect(groups.map((g) => [g.label, g.total, g.items.length])).toEqual([
      ['Vägg', 12, 1],
      ['Vind', 55, 2],
    ]);
  });

  it('följer vokabulärens ordning, inte radernas', () => {
    const groups = groupSackReportsByConstruction([r('mellanbjalklag', 1), r('vind', 1), r('vagg', 1), r('snedtak', 1), r('golv', 1)]);
    expect(groups.map((g) => g.label)).toEqual(['Vägg', 'Snedtak', 'Vind', 'Golv', 'Mellanbjälklag']);
  });

  it('bara placeringar som faktiskt rapporterats får en grupp', () => {
    expect(groupSackReportsByConstruction([r('vind', 30)]).map((g) => g.label)).toEqual(['Vind']);
  });

  it('rader utan placering hamnar i Ospecificerad, sist', () => {
    const groups = groupSackReportsByConstruction([r(null, 5), r('vind', 30), r('', 2), r('takstol', 1)]);
    expect(groups.map((g) => g.label)).toEqual(['Vind', UNSPECIFIED_CONSTRUCTION_LABEL]);
    expect(groups[1].total).toBe(8);
    expect(groups[1].construction).toBeNull();
  });

  // ⚠️ Kärnan: summan hoppar över de ersatta, listan gör det inte.
  it('ersatta rader räknas INTE i summan men finns kvar bland raderna', () => {
    const groups = groupSackReportsByConstruction([
      r('vind', 30, true, 'p1'),
      r('vind', 25, true, 'p2'),
      r('vind', 91, false, 'f1'),
    ]);
    expect(groups[0].total).toBe(91);
    expect(groups[0].items.map((i) => i.id)).toEqual(['p1', 'p2', 'f1']);
  });

  it('en grupp där ALLT är ersatt visar 0 men behåller sina rader', () => {
    const groups = groupSackReportsByConstruction([r('vagg', 12, true), r('vind', 91)]);
    const vagg = groups.find((g) => g.label === 'Vägg')!;
    expect(vagg.total).toBe(0);
    expect(vagg.items).toHaveLength(1);
  });

  it('inga rader ger inga grupper', () => {
    expect(groupSackReportsByConstruction([])).toEqual([]);
  });
});

describe('totalReportedSacks', () => {
  it('är summan efter supersede — samma tal som kortets rubrik', () => {
    expect(totalReportedSacks([r('vind', 30, true), r('vind', 25, true), r('vind', 91)])).toBe(91);
    expect(totalReportedSacks([r('vind', 30), r('vagg', 25)])).toBe(55);
    expect(totalReportedSacks([])).toBe(0);
  });

  it('matchar summan av gruppernas summor', () => {
    const rows = [r('vind', 30, true), r('vind', 91), r('vagg', 12), r(null, 5)];
    const groups = groupSackReportsByConstruction(rows);
    expect(groups.reduce((sum, g) => sum + g.total, 0)).toBe(totalReportedSacks(rows));
  });
});
