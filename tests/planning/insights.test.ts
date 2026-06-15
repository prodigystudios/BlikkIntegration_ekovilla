import { describe, it, expect } from 'vitest';
import { mondayOf, isoWeek, aggregateInsights, type InsightJob } from '@/lib/domains/planning/insights';

describe('mondayOf', () => {
  it('returns the Monday of the week', () => {
    expect(mondayOf('2026-06-17')).toBe('2026-06-15'); // Wed → Mon
    expect(mondayOf('2026-06-15')).toBe('2026-06-15'); // Mon → itself
    expect(mondayOf('2026-06-21')).toBe('2026-06-15'); // Sun → Mon
  });
});

describe('isoWeek', () => {
  it('matches the ISO week number', () => {
    expect(isoWeek('2026-06-15')).toBe(25);
    expect(isoWeek('2026-01-01')).toBe(1);
  });
});

describe('aggregateInsights', () => {
  const weekStarts = ['2026-06-15', '2026-06-22'];
  const jobs: InsightJob[] = [
    { weekStart: '2026-06-15', truck_id: 't1', truck_name: 'Bil 1', revenue: 1000, sacks: 40, material: 'Ekovilla' },
    { weekStart: '2026-06-15', truck_id: 't2', truck_name: 'Bil 2', revenue: 500, sacks: 20, material: 'Vitull' },
    { weekStart: '2026-06-22', truck_id: 't1', truck_name: 'Bil 1', revenue: 800, sacks: 30, material: 'Ekovilla' },
  ];

  it('sums revenue + sacks per week (empty weeks stay at zero)', () => {
    const { weeks } = aggregateInsights(['2026-06-15', '2026-06-22', '2026-06-29'], jobs);
    expect(weeks.map((w) => [w.label, w.revenue, w.sacks])).toEqual([
      ['v.25', 1500, 60],
      ['v.26', 800, 30],
      ['v.27', 0, 0],
    ]);
  });

  it('sums per truck, sorted by revenue desc', () => {
    const { byTruck } = aggregateInsights(weekStarts, jobs);
    expect(byTruck.map((t) => [t.truck_name, t.revenue, t.sacks])).toEqual([
      ['Bil 1', 1800, 70],
      ['Bil 2', 500, 20],
    ]);
  });

  it('sums sacks per material, sorted desc, ignoring null material', () => {
    const withNull = [...jobs, { weekStart: '2026-06-15', truck_id: 't3', truck_name: 'Bil 3', revenue: 100, sacks: 5, material: null }];
    const { byMaterial } = aggregateInsights(weekStarts, withNull);
    expect(byMaterial).toEqual([
      { material: 'Ekovilla', sacks: 70 },
      { material: 'Vitull', sacks: 20 },
    ]);
  });
});
