import { describe, it, expect } from 'vitest';
import { dayGroup, orderInfo, reorderWithinGroup } from '@/lib/domains/planning/order';

type Seg = { id: string; truck_id: string; start_day: string; sort_index: number };
const s = (id: string, truck_id: string, start_day: string, sort_index = 0): Seg => ({ id, truck_id, start_day, sort_index });

describe('dayGroup', () => {
  const segs = [
    s('a', 't1', '2026-06-15', 1),
    s('b', 't1', '2026-06-15', 0),
    s('c', 't1', '2026-06-16', 0), // different day
    s('d', 't2', '2026-06-15', 0), // different truck
  ];
  it('groups by truck + start day, ordered by sort_index then id', () => {
    expect(dayGroup(segs, s('x', 't1', '2026-06-15')).map((g) => g.id)).toEqual(['b', 'a']);
  });
  it('excludes other trucks and days', () => {
    expect(dayGroup(segs, s('x', 't2', '2026-06-15')).map((g) => g.id)).toEqual(['d']);
  });
});

describe('orderInfo', () => {
  const segs = [s('a', 't1', '2026-06-15', 0), s('b', 't1', '2026-06-15', 1)];
  it('reports index + total within the group', () => {
    expect(orderInfo(segs, segs[1])).toEqual({ index: 1, total: 2 });
  });
  it('total 1 for a lone job', () => {
    expect(orderInfo([s('a', 't1', '2026-06-15', 0)], s('a', 't1', '2026-06-15', 0))).toEqual({ index: 0, total: 1 });
  });
});

describe('reorderWithinGroup', () => {
  it('moves a job up, renumbering so positions are distinct (handles all-zero seed)', () => {
    const group = [s('a', 't1', 'd', 0), s('b', 't1', 'd', 0), s('c', 't1', 'd', 0)];
    // move 'c' up → order becomes a, c, b → c gets index 1, b gets index 2 (a already 0, unchanged)
    expect(reorderWithinGroup(group, 'c', 'up')).toEqual([
      { id: 'c', sort_index: 1 },
      { id: 'b', sort_index: 2 },
    ]);
  });
  it('moves a job down', () => {
    const group = [s('a', 't1', 'd', 0), s('b', 't1', 'd', 1)];
    expect(reorderWithinGroup(group, 'a', 'down')).toEqual([
      { id: 'b', sort_index: 0 },
      { id: 'a', sort_index: 1 },
    ]);
  });
  it('is a no-op at the edges', () => {
    const group = [s('a', 't1', 'd', 0), s('b', 't1', 'd', 1)];
    expect(reorderWithinGroup(group, 'a', 'up')).toEqual([]);
    expect(reorderWithinGroup(group, 'b', 'down')).toEqual([]);
  });
});
