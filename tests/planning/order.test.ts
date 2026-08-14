import { describe, it, expect } from 'vitest';
import { compareBoardOrder, dayGroup, orderInfo, reorderWithinGroup } from '@/lib/domains/planning/order';

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

describe('compareBoardOrder', () => {
  it('orders by sort_index first', () => {
    expect(compareBoardOrder(s('a', 't1', 'd', 2), s('b', 't1', 'd', 1))).toBeGreaterThan(0);
  });

  it('breaks all-zero ties on id, so the order cannot depend on array position', () => {
    // Regression: sort_index defaults to 0 on every row, so untouched jobs are all ties. The week
    // board rendered in raw array order and the server query had no final tiebreak, so moving a job
    // on ONE truck reshuffled two same-day jobs on ANOTHER truck.
    const two = [s('zulu', 't1', 'd'), s('alpha', 't1', 'd')];
    expect([...two].sort(compareBoardOrder).map((x) => x.id)).toEqual(['alpha', 'zulu']);
    expect([...two].reverse().sort(compareBoardOrder).map((x) => x.id)).toEqual(['alpha', 'zulu']);
  });

  it('is the same order dayGroup reports, so cards and badges agree', () => {
    const segs = [s('c', 't1', 'd'), s('a', 't1', 'd'), s('b', 't1', 'd', -1)];
    const byGroup = dayGroup(segs, s('x', 't1', 'd')).map((x) => x.id);
    expect([...segs].sort(compareBoardOrder).map((x) => x.id)).toEqual(byGroup);
    expect(byGroup).toEqual(['b', 'a', 'c']);
  });
});

// Why placeSegment assigns max+1 instead of taking the column default of 0.
describe('a newly placed job must not disturb an order someone set', () => {
  it('lands last when it gets max+1', () => {
    // A day someone ordered deliberately with the arrows: A first, B second.
    const ordered = [s('aaa', 't1', 'd', 0), s('bbb', 't1', 'd', 1)];
    const placedLast = [...ordered, s('000-new', 't1', 'd', 2)]; // nextSortIndex → max+1
    expect(placedLast.sort(compareBoardOrder).map((x) => x.id)).toEqual(['aaa', 'bbb', '000-new']);
  });

  it('would cut into the middle of that order if it took the default 0', () => {
    // The regression this guards: at sort_index 0 the newcomer ties with A, and the id tiebreak
    // decides — so a job placed later can jump ahead of one the planner deliberately put first.
    const ordered = [s('aaa', 't1', 'd', 0), s('bbb', 't1', 'd', 1)];
    const placedAtZero = [...ordered, s('000-new', 't1', 'd', 0)];
    expect(placedAtZero.sort(compareBoardOrder).map((x) => x.id)).toEqual(['000-new', 'aaa', 'bbb']);
  });
});
