import { describe, it, expect } from 'vitest';
import { daysBetweenInclusiveISO, isoDayNumber } from '@/lib/domains/planning/timezone';

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
