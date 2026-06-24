import { describe, it, expect } from 'vitest';
import { serializeTripsCsv, csvFileName, incompleteTripsForExport } from '@/lib/domains/korjournal/csv';
import type { Trip } from '@/lib/domains/korjournal/types';

function trip(partial: Partial<Trip>): Trip {
  return {
    id: partial.id || 't',
    date: partial.date || '2026-04-01',
    startAddress: partial.startAddress ?? 'A',
    endAddress: partial.endAddress ?? 'B',
    startKm: partial.startKm ?? null,
    endKm: partial.endKm ?? null,
    note: partial.note,
  };
}

describe('serializeTripsCsv', () => {
  const trips = [trip({ date: '2026-04-02', startAddress: 'Hem', endAddress: 'Jobb', startKm: 1000, endKm: 1042, note: 'möte' })];

  it('inleds med UTF-8 BOM', () => {
    expect(serializeTripsCsv('2026-04', trips).charCodeAt(0)).toBe(0xfeff);
  });

  it('har titel, rubrikrad, datarad och totalrad', () => {
    const lines = serializeTripsCsv('2026-04', trips).slice(1).split('\n');
    expect(lines[0]).toBe('Körjournal 2026-04');
    expect(lines[1]).toBe('Datum;Startadress;Slutadress;Start km;Slut km;Distans;Anteckning');
    expect(lines[2]).toBe('2026-04-02;Hem;Jobb;1000;1042;42;möte');
    expect(lines[3]).toBe('Total km;42');
  });

  it('citerar och escapar fält med semikolon, citat och radbrytning', () => {
    const t = [trip({ date: '2026-04-03', startAddress: 'A;B', endAddress: 'C"D', startKm: 0, endKm: 5, note: 'rad1\nrad2' })];
    const dataLine = serializeTripsCsv('2026-04', t).slice(1).split('\n');
    // semicolon-field quoted; quote doubled; newline keeps the field quoted (line spans two physical lines)
    expect(dataLine[2]).toContain('"A;B"');
    expect(dataLine[2]).toContain('"C""D"');
  });
});

describe('incompleteTripsForExport', () => {
  it('plockar ut resor med saknade km', () => {
    const trips = [trip({ startKm: 0, endKm: 10 }), trip({ id: 'x', startKm: 10, endKm: null })];
    const incomplete = incompleteTripsForExport(trips);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].id).toBe('x');
  });
});

describe('csvFileName', () => {
  it('bygger filnamn per månad', () => {
    expect(csvFileName('2026-04')).toBe('korjournal_2026-04.csv');
  });
});
