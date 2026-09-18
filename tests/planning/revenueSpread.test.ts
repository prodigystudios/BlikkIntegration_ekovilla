import { describe, it, expect } from 'vitest';
import {
  plannedDayCount,
  plannedDays,
  spreadScopeAcrossSpans,
  type SpreadSpan,
} from '@/lib/domains/planning/revenueSpread';

const span = (segment_id: string, truck_id: string, start_day: string, end_day: string): SpreadSpan =>
  ({ segment_id, truck_id, start_day, end_day });

const sumRevenue = (rows: Array<{ revenue: number }>) => Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100;
const sumSacks = (rows: Array<{ sacks: number }>) => rows.reduce((s, r) => s + r.sacks, 0);

describe('plannedDays', () => {
  it('räknar måndag–fredag som planerade dagar', () => {
    // mån 2026-09-28 … sön 2026-10-04
    expect(plannedDays({ start_day: '2026-09-28', end_day: '2026-10-04' })).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('hoppar över helgen mitt i ett spann', () => {
    // tors → tis: fyra arbetsdagar, inte sex kalenderdagar
    expect(plannedDayCount({ start_day: '2026-10-01', end_day: '2026-10-06' })).toBe(4);
    expect(plannedDayCount({ start_day: '2026-10-01', end_day: '2026-10-06' }, 'calendar')).toBe(6);
  });

  it('faller tillbaka på kalenderdagar när spannet ligger HELT på en helg', () => {
    // En lördagsplacering är ovanlig, men den ska omsätta något — annars blir nämnaren noll och
    // hela jobbets värde försvinner ur veckan.
    expect(plannedDays({ start_day: '2026-10-03', end_day: '2026-10-04' })).toEqual(['2026-10-03', '2026-10-04']);
  });

  it('ger tomt för ett bakvänt eller oläsbart spann', () => {
    expect(plannedDays({ start_day: '2026-10-05', end_day: '2026-10-01' })).toEqual([]);
    expect(plannedDays({ start_day: 'imorgon', end_day: '2026-10-01' })).toEqual([]);
  });
});

describe('spreadScopeAcrossSpans', () => {
  // M3 — REGRESSIONSTESTET FÖR BUGGEN WILLIAM RAPPORTERADE.
  // MUTANT: byt fördelningen mot den gamla regeln "hela värdet på varje vecka jobbet är öppet"
  // (WeekBoard.tsx:113, dedup per veckoinstans). Då blir båda veckorna 500 000 i stället för
  // 250 000, alltså en miljon på ett jobb värt en halv.
  it('M3: delar ett tvåveckorsjobb jämnt mellan veckorna', () => {
    const rows = spreadScopeAcrossSpans(
      { revenue: 500_000, sacks: 600 },
      [span('s1', 'bil-1', '2026-09-28', '2026-10-09')], // mån v.40 → fre v.41, 10 arbetsdagar
    );
    expect(rows).toHaveLength(10);

    const week40 = rows.filter((r) => r.day <= '2026-10-04');
    const week41 = rows.filter((r) => r.day > '2026-10-04');
    expect(sumRevenue(week40)).toBe(250_000);
    expect(sumRevenue(week41)).toBe(250_000);
    expect(sumSacks(week40)).toBe(300);
    expect(sumSacks(week41)).toBe(300);
  });

  // ⚠️ DETTA TEST DISKRIMINERAR INTE MELLAN DE TVÅ REGLERNA — det är en summakoll, inte ett skydd.
  // Mutationsprövat 2026-09-18: med dagsvikten satt till 1 i stället för 1/antal bilar (alltså utan
  // delningen) blir totalen 6 × v/6 och varje bil v/2 ändå. Symmetrin döljer skillnaden. Skyddet
  // för delningsregeln är det ASYMMETRISKA testet nedan; skriv inte om det här till att låtsas
  // vakta något.
  it('summerar till exakt beloppet när två bilar kör samma jobb samma dagar', () => {
    const rows = spreadScopeAcrossSpans(
      { revenue: 300_000, sacks: 300 },
      [span('s1', 'bil-1', '2026-09-28', '2026-09-30'), span('s2', 'bil-2', '2026-09-28', '2026-09-30')],
    );
    expect(sumRevenue(rows)).toBe(300_000);
    expect(sumRevenue(rows.filter((r) => r.truck_id === 'bil-1'))).toBe(150_000);
    expect(sumRevenue(rows.filter((r) => r.truck_id === 'bil-2'))).toBe(150_000);
  });

  // M4 — SKYDDET FÖR DELNINGSREGELN. Fallet måste vara ASYMMETRISKT för att bita (se testet ovan).
  // MUTANT: sätt dagsvikten till 1 i stället för 1/antal bilar. Nämnaren blir då 4 placering-dagar
  // i stället för 3 distinkta dagar, och dag 1 och 3 sjunker från 100 000 till 75 000 — fast
  // ingenting ändrats på dem. Mutationsprövat 2026-09-18: rött, "expected 75000 to be 100000".
  it('M4: en bil som hjälper till EN dag drar inte om värdet på jobbets övriga dagar', () => {
    // Skälet att nämnaren är distinkta dagar: bil 2 hoppar in på dag 2. Dag 1 och 3 ska vara
    // orörda — annars hade veckan före rört sig av att någon la till en bil veckan efter.
    const spans = [span('s1', 'bil-1', '2026-09-28', '2026-09-30'), span('s2', 'bil-2', '2026-09-29', '2026-09-29')];
    const rows = spreadScopeAcrossSpans({ revenue: 300_000, sacks: 300 }, spans);
    const day1 = rows.filter((r) => r.day === '2026-09-28');
    const day2 = rows.filter((r) => r.day === '2026-09-29');

    expect(sumRevenue(day1)).toBe(100_000);
    expect(sumRevenue(day2)).toBe(100_000);
    expect(day2.map((r) => r.revenue).sort()).toEqual([50_000, 50_000]);
    expect(sumRevenue(rows)).toBe(300_000);
  });

  // M2 — kronorna måste bevaras EXAKT.
  // MUTANT: avrunda varje del för sig, `roundOre(value * weight / total)`, i stället för den
  // löpande summan. Tre lika veckor ger då 3 × 333 333,33 = 999 999,99.
  it('M2: summan av delarna är exakt beloppet, även när det inte går jämnt ut', () => {
    for (const revenue of [1_000_000, 999_999.99, 1, 0.03, 123_456.78]) {
      const rows = spreadScopeAcrossSpans({ revenue, sacks: 0 }, [span('s1', 'b', '2026-09-28', '2026-10-16')]);
      expect(sumRevenue(rows)).toBe(revenue);
    }
  });

  it('säckar fördelas som heltal och summerar exakt', () => {
    const rows = spreadScopeAcrossSpans({ revenue: 0, sacks: 100 }, [span('s1', 'b', '2026-09-28', '2026-10-02')]);
    expect(sumSacks(rows)).toBe(100);
    expect(rows.every((r) => Number.isInteger(r.sacks))).toBe(true);
  });

  // M1 — DST. ⚠️ Zonberoende: under TZ=UTC beter sig den naiva dagräkningen identiskt.
  // MUTANT: isoDayNumber utan Math.round (se tests/planning/timezone.test.ts). Spannet över
  // höstens växling ger då brutna dagnummer och fördelningen tappar kronor.
  it('M1: fördelar exakt över höstens sommartidsväxling', () => {
    // mån 2026-10-19 → fre 2026-10-30. Växlingen ligger natten till sön 2026-10-25, mitt emellan.
    const rows = spreadScopeAcrossSpans({ revenue: 500_000, sacks: 0 }, [span('s1', 'b', '2026-10-19', '2026-10-30')]);
    expect(rows).toHaveLength(10);
    expect(sumRevenue(rows)).toBe(500_000);
    expect(sumRevenue(rows.filter((r) => r.day <= '2026-10-25'))).toBe(250_000);
    expect(sumRevenue(rows.filter((r) => r.day > '2026-10-25'))).toBe(250_000);
  });

  it('samma placering skickad två gånger är inte två placeringar', () => {
    const one = span('s1', 'bil-1', '2026-09-28', '2026-09-30');
    const rows = spreadScopeAcrossSpans({ revenue: 90_000, sacks: 0 }, [one, { ...one }]);
    expect(rows).toHaveLength(3);
    expect(sumRevenue(rows)).toBe(90_000);
  });

  it('ger tomt när scopet saknar placeringar', () => {
    expect(spreadScopeAcrossSpans({ revenue: 100, sacks: 1 }, [])).toEqual([]);
  });

  it('är deterministisk oavsett i vilken ordning placeringarna kommer', () => {
    const a = span('s1', 'bil-1', '2026-09-28', '2026-09-30');
    const b = span('s2', 'bil-2', '2026-09-28', '2026-09-30');
    const value = { revenue: 100_000, sacks: 77 };
    expect(spreadScopeAcrossSpans(value, [a, b])).toEqual(spreadScopeAcrossSpans(value, [b, a]));
  });
});
