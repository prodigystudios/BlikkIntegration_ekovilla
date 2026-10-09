import { describe, it, expect } from 'vitest';
import { daysBetweenInclusiveISO, isoDayNumber, stockholmDayOf, stockholmDayStartISO } from '@/lib/domains/planning/timezone';

// 🕰️ ZONBEROENDE TESTFIL. Flera av påståendena nedan är TOMMA under `TZ=UTC` — där finns ingen
// sommartid att räkna fel på, så en naiv implementation beter sig identiskt. `vitest.config.ts`
// pinnar ingen zon, så `npm test` ensamt bevisar ingenting här.
//
//     TZ=Europe/Stockholm npx vitest run tests/planning/timezone.test.ts
//
// Mutationsprövat 2026-09-18: varje `it()` märkt MUTANT nedan har setts FALLERA under
// `TZ=Europe/Stockholm` när funktionen byttes mot den naiva varianten som kommentaren beskriver.

describe('isoDayNumber', () => {
  it('ger på varandra följande heltal för på varandra följande dagar', () => {
    const a = isoDayNumber('2026-06-15') as number;
    expect(isoDayNumber('2026-06-16')).toBe(a + 1);
    expect(isoDayNumber('2026-07-01')).toBe((isoDayNumber('2026-06-30') as number) + 1);
  });

  it('svarar null på det som inte är ett ISO-datum', () => {
    expect(isoDayNumber(null)).toBeNull();
    expect(isoDayNumber(undefined)).toBeNull();
    expect(isoDayNumber('')).toBeNull();
    expect(isoDayNumber('2026-6-15')).toBeNull();
    expect(isoDayNumber('den 15 juni')).toBeNull();
  });

  it('trimmar omgivande blanktecken', () => {
    expect(isoDayNumber('  2026-06-15  ')).toBe(isoDayNumber('2026-06-15'));
  });
});

describe('daysBetweenInclusiveISO', () => {
  it('räknar ett inklusivt spann (samma dag = 1)', () => {
    expect(daysBetweenInclusiveISO('2026-06-15', '2026-06-15')).toBe(1);
    expect(daysBetweenInclusiveISO('2026-06-15', '2026-06-17')).toBe(3);
  });

  it('ger NaN när ett datum inte går att läsa', () => {
    expect(daysBetweenInclusiveISO('inte ett datum', '2026-06-17')).toBeNaN();
    expect(daysBetweenInclusiveISO('2026-06-15', '')).toBeNaN();
  });

  // MUTANT: byt Math.round mot en rå division i isoDayNumber, alltså
  //   (Date.UTC(...) / 86_400_000)  utan avrundning
  // — eller räkna spannet ur LOKALA midnattstider utan Math.round:
  //   (new Date(y2,m2-1,d2) - new Date(y1,m1-1,d1)) / 86_400_000 + 1
  //
  // Höstens växling i Sverige är natten till söndag 2026-10-25, och det dygnet är 25 timmar långt.
  // Den naiva varianten ger då 14,0417 dagar i stället för 14. Talet är nämnare i fördelningen av
  // omsättning över veckor, så felet blir kronor på fel vecka — inte ett avrundat datum.
  it('MUTANT: håller heltal över höstens sommartidsväxling', () => {
    expect(daysBetweenInclusiveISO('2026-10-19', '2026-11-01')).toBe(14);
    expect(Number.isInteger(daysBetweenInclusiveISO('2026-10-19', '2026-11-01'))).toBe(true);
  });

  // MUTANT: samma byte som ovan. Vårens växling går åt andra hållet (23-timmarsdygn) och ger
  // 13,9583 — ett tal som `Math.floor` hade gjort till 13 och tappat en hel dag.
  it('MUTANT: håller heltal över vårens sommartidsväxling', () => {
    expect(daysBetweenInclusiveISO('2026-03-23', '2026-04-05')).toBe(14);
    expect(Number.isInteger(daysBetweenInclusiveISO('2026-03-23', '2026-04-05'))).toBe(true);
  });

  it('MUTANT: varje dag i en växlingsvecka ligger exakt ett steg från föregående', () => {
    // Går dag för dag genom växlingen. En naiv ms-division ger ett brutet steg vid söndagen.
    const days = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'];
    for (let i = 1; i < days.length; i++) {
      expect(daysBetweenInclusiveISO(days[i - 1], days[i])).toBe(2);
    }
  });
});

// Svensk tid överallt (William 2026-10-09). Skydden skrivs med EXAKTA ögonblick, så de biter i varje
// runtime-zon — även under TZ=UTC, där ett datumbaserat test hade varit tomt.
describe('stockholmDayOf — svensk dag för en tidsstämpel', () => {
  it('kl. 00.30 svensk tid är redan nästa dag, fast UTC-delen säger gårdagen', () => {
    expect(stockholmDayOf('2026-08-16T22:30:00Z')).toBe('2026-08-17'); // sommartid, +2
    expect(stockholmDayOf('2026-01-31T23:30:00+00:00')).toBe('2026-02-01'); // vintertid, +1, och ny månad
    expect(stockholmDayOf('2026-12-31T23:30:00Z')).toBe('2027-01-01'); // nyårsnatten
  });
  it('mitt på dagen samma dag som UTC', () => {
    expect(stockholmDayOf('2026-08-17T10:00:00Z')).toBe('2026-08-17');
  });
  it('kl. 23.59 svensk tid är fortfarande samma dag', () => {
    expect(stockholmDayOf('2026-08-17T21:59:00Z')).toBe('2026-08-17');
    expect(stockholmDayOf('2026-02-01T22:59:00Z')).toBe('2026-02-01');
  });
  it('ett rent datum (date-kolumn) är sin egen dag — så samma funktion duger för båda sorterna', () => {
    // Ett datum utan klockslag tolkas som UTC-midnatt, alltså kl. 01/02 samma dag i Sverige.
    expect(stockholmDayOf('2026-08-17')).toBe('2026-08-17');
    expect(stockholmDayOf('2026-01-01')).toBe('2026-01-01');
    expect(stockholmDayOf('2026-10-25')).toBe('2026-10-25');
  });
  it('samma svar andra gången (cachen ändrar inget)', () => {
    expect(stockholmDayOf('2026-08-16T22:30:00Z')).toBe('2026-08-17');
    expect(stockholmDayOf('2026-08-16T22:30:00Z')).toBe('2026-08-17');
  });
  it('null för saknat eller oläsligt värde', () => {
    expect(stockholmDayOf(null)).toBeNull();
    expect(stockholmDayOf('')).toBeNull();
    expect(stockholmDayOf('inte ett datum')).toBeNull();
  });
});

describe('stockholmDayStartISO — svensk midnatt som UTC-ögonblick', () => {
  it('sommartid: midnatt är kl. 22 UTC dagen före; vintertid kl. 23', () => {
    expect(stockholmDayStartISO('2026-08-01')).toBe('2026-07-31T22:00:00.000Z');
    expect(stockholmDayStartISO('2026-01-15')).toBe('2026-01-14T23:00:00.000Z');
  });
  it('vårens växling (29 mars 2026, kl. 02 → 03): midnatt före växlingen är vintertid, dagen efter sommartid', () => {
    expect(stockholmDayStartISO('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
    expect(stockholmDayStartISO('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
  });
  it('höstens växling (25 oktober 2026, kl. 03 → 02): midnatt före växlingen är sommartid, dagen efter vintertid', () => {
    expect(stockholmDayStartISO('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(stockholmDayStartISO('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
  });
  it('går ihop med stockholmDayOf: gränsen hör till dagen, en millisekund före till dagen innan', () => {
    for (const day of ['2026-03-29', '2026-03-30', '2026-08-01', '2026-10-25', '2026-10-26', '2027-01-01']) {
      const start = stockholmDayStartISO(day);
      expect(stockholmDayOf(start)).toBe(day);
      expect(stockholmDayOf(new Date(Date.parse(start) - 1).toISOString())).not.toBe(day);
    }
  });
  it('kastar på ett ogiltigt datum i stället för att ge ett påhittat filter', () => {
    expect(() => stockholmDayStartISO('2026-13-45x')).toThrow();
    // Rätt form men ingen sådan dag: får inte rulla över till mars.
    expect(() => stockholmDayStartISO('2026-02-30')).toThrow();
    expect(() => stockholmDayStartISO('2026-13-01')).toThrow();
  });
});
