import { describe, it, expect } from 'vitest';
import { segmentWeekValues, weekTotals, type ScopeSpan, type ScopeValue } from '@/lib/domains/planning/weekValue';

const span = (key: string, segment_id: string, truck_id: string, start_day: string, end_day: string): ScopeSpan =>
  ({ key, segment_id, truck_id, start_day, end_day });

const value = (key: string, revenue: number, sacks: number): ScopeValue => ({ key, revenue, sacks });

describe('segmentWeekValues', () => {
  it('slår ihop dagsandelarna till en rad per placering och vecka', () => {
    const slices = segmentWeekValues(
      [value('wo-1:rest', 500_000, 600)],
      [span('wo-1:rest', 's1', 'bil-1', '2026-09-28', '2026-10-09')],
    );
    expect(slices).toHaveLength(2);
    expect(slices.map((s) => s.weekStart).sort()).toEqual(['2026-09-28', '2026-10-05']);
    expect(slices.every((s) => s.revenue === 250_000)).toBe(true);
    expect(slices.reduce((sum, s) => sum + s.sacks, 0)).toBe(600);
  });

  it('håller isär två etapper på samma arbetsorder', () => {
    // Kärnan i etappfallet: samma order, två scopes, olika veckor och olika värden.
    const slices = segmentWeekValues(
      [value('wo-1:stage-a', 720_000, 380), value('wo-1:stage-b', 520_000, 184)],
      [
        span('wo-1:stage-a', 's1', 'bil-1', '2026-09-28', '2026-10-02'),
        span('wo-1:stage-b', 's2', 'bil-1', '2026-10-12', '2026-10-16'),
      ],
    );
    expect(weekTotals(slices, '2026-09-28')).toEqual({ revenue: 720_000, sacks: 380, jobs: 1 });
    expect(weekTotals(slices, '2026-10-12')).toEqual({ revenue: 520_000, sacks: 184, jobs: 1 });
  });

  it('hoppar över scopes utan placeringar och placeringar utan värde', () => {
    expect(segmentWeekValues([value('oplanerad', 100_000, 10)], [])).toEqual([]);
    expect(segmentWeekValues([], [span('okänd', 's1', 'b', '2026-09-28', '2026-09-30')])).toEqual([]);
  });
});

describe('weekTotals', () => {
  const slices = segmentWeekValues(
    [value('wo-1:rest', 500_000, 600), value('wo-2:rest', 100_000, 50)],
    [
      span('wo-1:rest', 's1', 'bil-1', '2026-09-28', '2026-10-09'),
      span('wo-2:rest', 's2', 'bil-2', '2026-09-28', '2026-10-02'),
    ],
  );

  // M3 — MUTANT: byt weekTotals mot den gamla dedupen på work_order_id per veckoinstans. Jobbet
  // wo-1 hade då räknats med hela 500 000 i BÅDA veckorna i stället för 250 000 i varje.
  it('M3: ett flerveckorsjobb räknas inte fullt i varje vecka', () => {
    expect(weekTotals(slices, '2026-09-28').revenue).toBe(350_000); // 250 000 + 100 000
    expect(weekTotals(slices, '2026-10-05').revenue).toBe(250_000);

    const allWeeks = weekTotals(slices, '2026-09-28').revenue + weekTotals(slices, '2026-10-05').revenue;
    expect(allWeeks).toBe(600_000); // exakt summan av de två ordrarna, inte 1 100 000
  });

  it('filtrerar på bil utan att dubbelräkna', () => {
    expect(weekTotals(slices, '2026-09-28', new Set(['bil-1'])).revenue).toBe(250_000);
    expect(weekTotals(slices, '2026-09-28', new Set(['bil-2'])).revenue).toBe(100_000);

    // Summan av banorna ska vara veckans total — det var den INTE förut: per-bana-dedupen låg
    // inne i trucks.map, så ett jobb på två bilar räknades fullt på båda medan veckototalen
    // räknade det en gång.
    const perLane = weekTotals(slices, '2026-09-28', new Set(['bil-1'])).revenue
      + weekTotals(slices, '2026-09-28', new Set(['bil-2'])).revenue;
    expect(perLane).toBe(weekTotals(slices, '2026-09-28').revenue);
  });

  it('räknar jobb som distinkta scopes i veckan, inte placeringar', () => {
    const split = segmentWeekValues(
      [value('wo-1:rest', 300_000, 0)],
      [
        span('wo-1:rest', 's1', 'bil-1', '2026-09-28', '2026-09-30'),
        span('wo-1:rest', 's2', 'bil-2', '2026-09-28', '2026-09-30'),
      ],
    );
    expect(weekTotals(split, '2026-09-28')).toEqual({ revenue: 300_000, sacks: 0, jobs: 1 });
  });

  it('ger nollor för en vecka utan skivor', () => {
    expect(weekTotals(slices, '2026-11-02')).toEqual({ revenue: 0, sacks: 0, jobs: 0 });
  });
});
