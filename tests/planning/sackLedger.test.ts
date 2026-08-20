import { describe, it, expect } from 'vitest';
import {
  effectiveSackReports,
  markSupersededReports,
  resolveSegmentForDay,
  sackReportKind,
  sumSacksByWorkOrder,
  type ResolvableSegment,
} from '@/lib/domains/planning/sackLedger';

// Supersede-regeln är den enda saken som står mellan huvudboken och dubbelräkning, och den anropas
// från TVÅ ställen (reportedSacksByWorkOrder + deriveConsumptionRows). Ett fel här syns aldrig som
// ett fel — bara som ett för högt tal på arbetsordern, eller som ett depåsaldo som upptäcks först
// när en bil står utan material.

const partial = (work_order_id: string, sacks_blown: number | string, extra: Record<string, unknown> = {}) =>
  ({ work_order_id, kind: 'partial', sacks_blown, ...extra });
const final = (work_order_id: string, sacks_blown: number | string, extra: Record<string, unknown> = {}) =>
  ({ work_order_id, kind: 'final', sacks_blown, ...extra });

describe('sackReportKind', () => {
  it('bara exakt "final" är final — allt annat räknas med som partial', () => {
    expect(sackReportKind({ kind: 'final' })).toBe('final');
    expect(sackReportKind({ kind: 'partial' })).toBe('partial');
    expect(sackReportKind({ kind: null })).toBe('partial');
    expect(sackReportKind({ kind: undefined })).toBe('partial');
    expect(sackReportKind({ kind: 'FINAL' })).toBe('partial');
    expect(sackReportKind({ kind: 'slutlig' })).toBe('partial');
  });
});

describe('supersede-regeln', () => {
  // Williams kontrollfråga, genomräknad. Naiv summering ger 146; svaret är 91.
  it('flerbesöksfallet: två delrapporter + en egenkontroll på totalen → 91, inte 146', () => {
    const rows = [partial('wo1', 30), partial('wo1', 25), final('wo1', 91)];
    expect(sumSacksByWorkOrder(rows).get('wo1')).toBe(91);
  });

  it('utan final summeras delrapporterna', () => {
    expect(sumSacksByWorkOrder([partial('wo1', 30), partial('wo1', 25)]).get('wo1')).toBe(55);
  });

  it('flera finaler summeras — egenkontrollen skriver en rad PER ETAPPRAD', () => {
    const rows = [partial('wo1', 30), final('wo1', 60), final('wo1', 31)];
    expect(sumSacksByWorkOrder(rows).get('wo1')).toBe(91);
  });

  // ⚠️ Nycklad per ARBETSORDER. Vore den nycklad per placering hade väggens delrapporter levt kvar
  // och adderats ovanpå en final på vinden — exakt dubbelräkningen regeln finns för att stoppa.
  it('en final släcker jobbets ALLA delrapporter, även på andra placeringar', () => {
    const rows = [
      partial('wo1', 30, { construction: 'vind' }),
      partial('wo1', 12, { construction: 'vagg' }),
      final('wo1', 91, { construction: 'vind' }),
    ];
    expect(sumSacksByWorkOrder(rows).get('wo1')).toBe(91);
  });

  it('regeln gäller per jobb — ett jobbs final rör inte ett annat jobbs delrapporter', () => {
    const rows = [partial('wo1', 30), final('wo1', 91), partial('wo2', 40), partial('wo2', 5)];
    const sums = sumSacksByWorkOrder(rows);
    expect(sums.get('wo1')).toBe(91);
    expect(sums.get('wo2')).toBe(45);
  });

  it('rader utan kind räknas med som delrapporter i stället för att tysta jobbet', () => {
    const rows = [{ work_order_id: 'wo1', sacks_blown: 30 }, { work_order_id: 'wo1', kind: null, sacks_blown: 25 }];
    expect(sumSacksByWorkOrder(rows).get('wo1')).toBe(55);
  });

  // numeric(10,2) kommer tillbaka som STRÄNG från PostgREST.
  it('summerar strängvärden från PostgREST', () => {
    expect(sumSacksByWorkOrder([partial('wo1', '30.50'), partial('wo1', '25')]).get('wo1')).toBe(55.5);
  });

  it('ett jobb utan rapporter SAKNAS i kartan — det är inte samma sak som noll säckar', () => {
    const sums = sumSacksByWorkOrder([partial('wo1', 30)]);
    expect(sums.has('wo2')).toBe(false);
    expect(sums.get('wo2')).toBeUndefined();
  });

  it('en nollrapport ger 0 i kartan — "0 st" är ett svar, till skillnad från "ej rapporterat"', () => {
    const sums = sumSacksByWorkOrder([partial('wo1', 0)]);
    expect(sums.has('wo1')).toBe(true);
    expect(sums.get('wo1')).toBe(0);
  });

  it('tom lista ger tom karta', () => {
    expect(sumSacksByWorkOrder([]).size).toBe(0);
  });
});

describe('effectiveSackReports', () => {
  it('returnerar RADER, inte en summa — depån måste attribuera var och en till depå + material', () => {
    const rows = [partial('wo1', 30), final('wo1', 60), final('wo1', 31), partial('wo2', 40)];
    expect(effectiveSackReports(rows)).toEqual([final('wo1', 60), final('wo1', 31), partial('wo2', 40)]);
  });
});

describe('markSupersededReports', () => {
  // Spåret på ordern listar ALLA rader. Utan märkningen läser kontoret 30 + 25 + 91 = 146 och tror
  // att talen inte går ihop.
  it('märker de ersatta delrapporterna och behåller inordningen', () => {
    const rows = [partial('wo1', 30), partial('wo1', 25), final('wo1', 91), partial('wo2', 40)];
    expect(markSupersededReports(rows).map((r) => r.superseded)).toEqual([true, true, false, false]);
  });

  it('utan final är ingenting ersatt', () => {
    const rows = [partial('wo1', 30), partial('wo1', 25)];
    expect(markSupersededReports(rows).every((r) => !r.superseded)).toBe(true);
  });
});

describe('resolveSegmentForDay', () => {
  const seg = (id: string, start_day: string, end_day: string): ResolvableSegment => ({ id, start_day, end_day });

  it('täckning först — dagen ligger i intervallet', () => {
    const segments = [seg('a', '2026-08-10', '2026-08-12'), seg('b', '2026-08-17', '2026-08-19')];
    expect(resolveSegmentForDay(segments, '2026-08-18')).toEqual({ segmentId: 'b', match: 'covering', daysOff: 0 });
  });

  it('intervallet är inklusivt i båda ändar', () => {
    const segments = [seg('a', '2026-08-10', '2026-08-12')];
    expect(resolveSegmentForDay(segments, '2026-08-10')?.match).toBe('covering');
    expect(resolveSegmentForDay(segments, '2026-08-12')?.match).toBe('covering');
  });

  it('endagssegment täcker sin enda dag', () => {
    expect(resolveSegmentForDay([seg('a', '2026-08-10', '2026-08-10')], '2026-08-10')?.match).toBe('covering');
  });

  // ⚠️ Reserven. Anroparen MÅSTE logga när den faller ut — annars är det enda spåret av ett trasigt
  // antagande att säckarna tyst hamnade på fel bil, och därmed på fel depå.
  it('utan täckning väljs närmaste segment och märks som reserv, med avståndet', () => {
    const segments = [seg('a', '2026-08-10', '2026-08-12'), seg('b', '2026-08-20', '2026-08-22')];
    expect(resolveSegmentForDay(segments, '2026-08-14')).toEqual({ segmentId: 'a', match: 'nearest', daysOff: 2 });
    expect(resolveSegmentForDay(segments, '2026-08-18')).toEqual({ segmentId: 'b', match: 'nearest', daysOff: 2 });
  });

  it('reserven mäter åt båda hållen — före första och efter sista segmentet', () => {
    const segments = [seg('a', '2026-08-10', '2026-08-12')];
    expect(resolveSegmentForDay(segments, '2026-08-07')).toEqual({ segmentId: 'a', match: 'nearest', daysOff: 3 });
    expect(resolveSegmentForDay(segments, '2026-08-15')).toEqual({ segmentId: 'a', match: 'nearest', daysOff: 3 });
  });

  // Ett jobb splittat på två bilar är ett normalt drag på tavlan. Valet måste vara deterministiskt,
  // annars vandrar depåattribueringen mellan två bilar utan att något ändrats.
  it('två täckande segment: tidigast start vinner, id som tiebreak', () => {
    const later = seg('b', '2026-08-11', '2026-08-14');
    const earlier = seg('a', '2026-08-10', '2026-08-14');
    expect(resolveSegmentForDay([later, earlier], '2026-08-12')?.segmentId).toBe('a');
    const sameStart = [seg('z', '2026-08-10', '2026-08-14'), seg('c', '2026-08-10', '2026-08-14')];
    expect(resolveSegmentForDay(sameStart, '2026-08-12')?.segmentId).toBe('c');
  });

  it('lika avstånd: tidigast start vinner', () => {
    const segments = [seg('b', '2026-08-16', '2026-08-18'), seg('a', '2026-08-10', '2026-08-12')];
    expect(resolveSegmentForDay(segments, '2026-08-14')?.segmentId).toBe('a');
  });

  it('inga segment, eller bara segment med trasiga datum, ger null', () => {
    expect(resolveSegmentForDay([], '2026-08-18')).toBeNull();
    expect(resolveSegmentForDay([seg('a', '2026/08/10', '2026-08-12')], '2026-08-18')).toBeNull();
  });

  it('ogiltig rapportdag ger null i stället för att gissa', () => {
    expect(resolveSegmentForDay([seg('a', '2026-08-10', '2026-08-12')], '2026/08/11')).toBeNull();
    expect(resolveSegmentForDay([seg('a', '2026-08-10', '2026-08-12')], '')).toBeNull();
  });

  it('segment med trasiga datum hoppas över, resten löses ändå', () => {
    const segments = [seg('trasig', '', 'x'), seg('a', '2026-08-10', '2026-08-12')];
    expect(resolveSegmentForDay(segments, '2026-08-11')?.segmentId).toBe('a');
  });

  // Datumen är rena kalenderdagar. Aritmetiken är UTC-förankrad, så en sommartidsövergång i
  // intervallet får inte bli en dags fel i avståndet. Sverige växlar till vintertid 2026-10-25.
  it('sommartidsövergång i intervallet ändrar inte dagräkningen', () => {
    const segments = [seg('a', '2026-10-20', '2026-10-22')];
    expect(resolveSegmentForDay(segments, '2026-10-28')).toEqual({ segmentId: 'a', match: 'nearest', daysOff: 6 });
    expect(resolveSegmentForDay([seg('a', '2026-10-20', '2026-10-30')], '2026-10-26')?.match).toBe('covering');
  });
});
