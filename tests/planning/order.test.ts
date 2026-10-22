import { describe, it, expect } from 'vitest';
import {
  compareBoardOrder,
  dayGroup,
  nextSortIndexOnDay,
  orderInfo,
  reorderOnDay,
  sharedDayOrders,
} from '@/lib/domains/planning/order';

type Seg = { id: string; truck_id: string; start_day: string; end_day: string; sort_index: number };
const s = (id: string, truck_id: string, start_day: string, sort_index = 0, end_day = start_day): Seg => ({
  id,
  truck_id,
  start_day,
  end_day,
  sort_index,
});

const WED = '2026-10-21';
const THU = '2026-10-22';
const FRI = '2026-10-23';

const ids = (segs: Seg[]) => segs.map((x) => x.id);
const apply = (segs: Seg[], changes: { id: string; sort_index: number }[]): Seg[] => {
  const next = new Map(changes.map((c) => [c.id, c.sort_index]));
  return segs.map((x) => (next.has(x.id) ? { ...x, sort_index: next.get(x.id)! } : x));
};

describe('dayGroup', () => {
  const segs = [
    s('a', 't1', WED, 1),
    s('b', 't1', WED, 0),
    s('c', 't1', THU, 0), // different day
    s('d', 't2', WED, 0), // different truck
  ];
  it('groups by truck + day, ordered by sort_index then id', () => {
    expect(ids(dayGroup(segs, 't1', WED))).toEqual(['b', 'a']);
  });
  it('excludes other trucks and days', () => {
    expect(ids(dayGroup(segs, 't2', WED))).toEqual(['d']);
  });

  it('counts a job continuing from yesterday, not only the ones starting today', () => {
    // Regression (2026-10-22): the group was keyed on start_day, so a job running Wed–Thu was not on
    // Thursday at all. The Thursday job was "1 of 1" and the order picker never appeared.
    const week = [s('long', 't1', WED, 0, THU), s('thu', 't1', THU, 1)];
    expect(ids(dayGroup(week, 't1', THU))).toEqual(['long', 'thu']);
    expect(ids(dayGroup(week, 't1', WED))).toEqual(['long']);
    expect(ids(dayGroup(week, 't1', FRI))).toEqual([]);
  });
});

describe('orderInfo', () => {
  const segs = [s('a', 't1', WED, 0), s('b', 't1', WED, 1)];
  it('reports index + total within the day', () => {
    expect(orderInfo(segs, segs[1], WED)).toEqual({ day: WED, index: 1, total: 2 });
  });
  it('total 1 for a lone job', () => {
    expect(orderInfo([segs[0]], segs[0], WED)).toEqual({ day: WED, index: 0, total: 1 });
  });
});

describe('sharedDayOrders', () => {
  const long = s('long', 't1', WED, 0, FRI);
  const thu = s('thu', 't1', THU, 1);
  const other = s('other', 't2', WED, 0); // another truck never shares a day with `long`
  const segs = [long, thu, other];

  it('lists only the days the job shares its truck with another job', () => {
    expect(sharedDayOrders(segs, long, [WED, THU, FRI])).toEqual([{ day: THU, index: 0, total: 2 }]);
    expect(sharedDayOrders(segs, thu, [WED, THU, FRI])).toEqual([{ day: THU, index: 1, total: 2 }]);
  });

  it('is empty for a job alone on every day — no badge, no picker', () => {
    expect(sharedDayOrders(segs, other, [WED, THU, FRI])).toEqual([]);
  });

  it('ignores days the job does not cover, and days outside the ones asked about', () => {
    expect(sharedDayOrders(segs, thu, [WED, FRI])).toEqual([]);
  });
});

describe('compareBoardOrder', () => {
  it('orders by sort_index first', () => {
    expect(compareBoardOrder(s('a', 't1', WED, 2), s('b', 't1', WED, 1))).toBeGreaterThan(0);
  });

  it('breaks all-zero ties on id, so the order cannot depend on array position', () => {
    // Regression: sort_index defaults to 0 on every row, so untouched jobs are all ties. The week
    // board rendered in raw array order and the server query had no final tiebreak, so moving a job
    // on ONE truck reshuffled two same-day jobs on ANOTHER truck.
    const two = [s('zulu', 't1', WED), s('alpha', 't1', WED)];
    expect(ids([...two].sort(compareBoardOrder))).toEqual(['alpha', 'zulu']);
    expect(ids([...two].reverse().sort(compareBoardOrder))).toEqual(['alpha', 'zulu']);
  });

  it('puts the job continuing from yesterday first on a tie, whatever the ids say', () => {
    // The default decided 2026-10-22: the crew finishes what it started before the next job.
    // Ids picked so the id tiebreak alone would say the opposite.
    const continuing = s('zzz-continuing', 't1', WED, 0, THU);
    const starting = s('aaa-starting', 't1', THU, 0);
    expect(ids(dayGroup([starting, continuing], 't1', THU))).toEqual(['zzz-continuing', 'aaa-starting']);
  });

  it('lets sort_index override that default', () => {
    const continuing = s('continuing', 't1', WED, 1, THU);
    const starting = s('starting', 't1', THU, 0);
    expect(ids(dayGroup([continuing, starting], 't1', THU))).toEqual(['starting', 'continuing']);
  });

  it('is the same order dayGroup reports, so cards and badges agree', () => {
    const segs = [s('c', 't1', WED), s('a', 't1', WED), s('b', 't1', WED, -1)];
    const byGroup = ids(dayGroup(segs, 't1', WED));
    expect(ids([...segs].sort(compareBoardOrder))).toEqual(byGroup);
    expect(byGroup).toEqual(['b', 'a', 'c']);
  });
});

describe('nextSortIndexOnDay', () => {
  it('is 0 on an empty day', () => {
    expect(nextSortIndexOnDay([], 't1', THU)).toBe(0);
  });

  it('queues behind a job continuing from yesterday', () => {
    // Regression: placement only looked at jobs STARTING that day, so a job placed on Thursday got 0
    // next to a Wed–Thu job numbered 3 — and jumped ahead of the job the crew was in the middle of.
    const continuing = s('continuing', 't1', WED, 3, THU);
    const next = nextSortIndexOnDay([continuing], 't1', THU);
    expect(next).toBe(4);
    const placed = s('000-new', 't1', THU, next);
    expect(ids(dayGroup([continuing, placed], 't1', THU))).toEqual(['continuing', '000-new']);
  });

  it('ignores other trucks and jobs that do not cover the day', () => {
    const segs = [s('other-truck', 't2', THU, 9), s('ended', 't1', WED, 7), s('later', 't1', FRI, 8), s('same', 't1', THU, 1)];
    expect(nextSortIndexOnDay(segs, 't1', THU)).toBe(2);
  });
});

describe('reorderOnDay', () => {
  it('moves a job up, renumbering so positions are distinct (handles all-zero seed)', () => {
    const segs = [s('a', 't1', WED), s('b', 't1', WED), s('c', 't1', WED)];
    // move 'c' up → order becomes a, c, b
    const changes = reorderOnDay(segs, 'c', WED, 'up');
    expect(ids(dayGroup(apply(segs, changes), 't1', WED))).toEqual(['a', 'c', 'b']);
    expect(changes).toEqual([
      { id: 'c', sort_index: 1 },
      { id: 'b', sort_index: 2 },
    ]);
  });

  it('moves a job down', () => {
    const segs = [s('a', 't1', WED, 0), s('b', 't1', WED, 1)];
    expect(reorderOnDay(segs, 'a', WED, 'down')).toEqual([
      { id: 'b', sort_index: 0 },
      { id: 'a', sort_index: 1 },
    ]);
  });

  it('is a no-op at the edges and on a day the job is not on', () => {
    const segs = [s('a', 't1', WED, 0), s('b', 't1', WED, 1)];
    expect(reorderOnDay(segs, 'a', WED, 'up')).toEqual([]);
    expect(reorderOnDay(segs, 'b', WED, 'down')).toEqual([]);
    expect(reorderOnDay(segs, 'a', THU, 'down')).toEqual([]);
    expect(reorderOnDay(segs, 'missing', WED, 'down')).toEqual([]);
  });

  it('moves the Thursday job ahead of the job continuing from Wednesday', () => {
    const segs = [s('long', 't1', WED, 0, THU), s('thu', 't1', THU, 1)];
    const after = apply(segs, reorderOnDay(segs, 'thu', THU, 'up'));
    expect(ids(dayGroup(after, 't1', THU))).toEqual(['thu', 'long']);
  });

  it('reordering Thursday leaves Wednesday exactly as it was', () => {
    // Regression guard for the shared-number problem. `long` runs Wed–Thu and is in BOTH days'
    // groups with one sort_index. Renumbering only Thursday's group 0..n gave it 1, which tied with
    // the Wednesday job — and the id tiebreak (aaa < long) flipped Wednesday nobody had touched.
    // Numbers are what the old per-start-day placement left behind: each start day counts from 0.
    const segs = [s('long', 't1', WED, 0, THU), s('aaa-wed', 't1', WED, 1), s('thu', 't1', THU, 0)];
    expect(ids(dayGroup(segs, 't1', WED))).toEqual(['long', 'aaa-wed']);
    expect(ids(dayGroup(segs, 't1', THU))).toEqual(['long', 'thu']);

    const after = apply(segs, reorderOnDay(segs, 'thu', THU, 'up'));
    expect(ids(dayGroup(after, 't1', THU))).toEqual(['thu', 'long']);
    expect(ids(dayGroup(after, 't1', WED))).toEqual(['long', 'aaa-wed']);
  });

  it('leaves every other day alone when a one-day job moves, across a whole tangled week', () => {
    // Every move of every one-day job, in both directions, on a truck where multi-day jobs chain
    // Mon → Fri through overlaps and the numbers are full of ties. Only the day moved on may change,
    // and there exactly the two neighbours swap.
    const MON = '2026-10-19';
    const TUE = '2026-10-20';
    const days = [MON, TUE, WED, THU, FRI];
    const segs = [
      s('m1', 't1', MON, 0, TUE),
      s('m2', 't1', MON, 1),
      s('tu1', 't1', TUE, 0),
      s('tu2', 't1', TUE, 0, THU),
      s('w1', 't1', WED, 0),
      s('w2', 't1', WED, 2),
      s('h1', 't1', THU, 0, FRI),
      s('h2', 't1', THU, 1),
      s('f1', 't1', FRI, 0),
      s('x1', 't2', WED, 0), // another truck: never touched
    ];
    const oneDay = segs.filter((x) => x.truck_id === 't1' && x.start_day === x.end_day);
    let moves = 0;
    for (const seg of oneDay) {
      for (const dir of ['up', 'down'] as const) {
        const before = Object.fromEntries(days.map((d) => [d, ids(dayGroup(segs, 't1', d))]));
        const changes = reorderOnDay(segs, seg.id, seg.start_day, dir);
        if (changes.length === 0) continue;
        moves++;
        const after = apply(segs, changes);
        expect(changes.every((c) => c.id !== 'x1')).toBe(true);
        for (const d of days) {
          const now = ids(dayGroup(after, 't1', d));
          if (d !== seg.start_day) {
            expect(now, `${seg.id} ${dir} changed ${d}`).toEqual(before[d]);
            continue;
          }
          const expected = [...before[d]];
          const i = expected.indexOf(seg.id);
          const j = dir === 'up' ? i - 1 : i + 1;
          [expected[i], expected[j]] = [expected[j], expected[i]];
          expect(now, `${seg.id} ${dir} on ${d}`).toEqual(expected);
        }
      }
    }
    // Make sure the loop actually exercised moves rather than skipping everything as an edge.
    expect(moves).toBeGreaterThan(6);
  });
});

// Why placement assigns max+1 instead of taking the column default of 0.
describe('a newly placed job must not disturb an order someone set', () => {
  it('lands last when it gets max+1', () => {
    // A day someone ordered deliberately with the arrows: A first, B second.
    const ordered = [s('aaa', 't1', WED, 0), s('bbb', 't1', WED, 1)];
    const placedLast = [...ordered, s('000-new', 't1', WED, nextSortIndexOnDay(ordered, 't1', WED))];
    expect(ids(placedLast.sort(compareBoardOrder))).toEqual(['aaa', 'bbb', '000-new']);
  });

  it('would cut into the middle of that order if it took the default 0', () => {
    // The regression this guards: at sort_index 0 the newcomer ties with A, and the id tiebreak
    // decides — so a job placed later can jump ahead of one the planner deliberately put first.
    const ordered = [s('aaa', 't1', WED, 0), s('bbb', 't1', WED, 1)];
    const placedAtZero = [...ordered, s('000-new', 't1', WED, 0)];
    expect(ids(placedAtZero.sort(compareBoardOrder))).toEqual(['000-new', 'aaa', 'bbb']);
  });
});
