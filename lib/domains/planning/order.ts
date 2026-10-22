// Ordering of jobs that share a truck on the same day ("which job is done first"). The order is
// carried by ops_segments.sort_index; these pure helpers compute a segment's position on a day and
// the sort_index changes needed to nudge it earlier/later. Unit-tested.
//
// ⚠️ A DAY'S JOBS ARE EVERY JOB THAT COVERS THE DAY, not the ones that start on it. A job running
// Wednesday–Thursday is on Thursday too, and a job placed on Thursday has to queue behind (or ahead
// of) it. The first version grouped on start_day alone, so the Thursday job was "1 of 1", the order
// picker never appeared, and the continuing job was invisible to the day it shared. The old Blikk
// planning counted covering jobs (app/plannering/page.tsx, `startDay <= refDay && endDay >= refDay`).

type Orderable = { id: string; truck_id: string; start_day: string; end_day: string; sort_index: number };

/**
 * THE order jobs on the same truck and day are shown in: sort_index, then start day, then id.
 *
 * ⚠️ Every surface that renders segments must use this. `sort_index` defaults to 0 for every row
 * (see 20260611_ops_planning_foundation.sql), so untouched jobs are all ties — and a tie decided by
 * anything other than a stable key is decided by nothing. Postgres is free to return equal-ranked
 * rows in any order, and it changes that order after an unrelated UPDATE, so the week board (which
 * rendered in raw array order) reshuffled two jobs on one truck when a job on a DIFFERENT truck was
 * moved to another day. The month board sorted, but left sort_index out entirely, so a card badged
 * "2/2" could sit above the one badged "1/2".
 *
 * The start day breaks a tie in favour of the job that began earlier: a job continuing from
 * yesterday is done before one starting today unless the planner says otherwise (decided
 * 2026-10-22). Within one start day it changes nothing — that order was sort_index, then id.
 */
export function compareBoardOrder(a: Orderable, b: Orderable): number {
  return a.sort_index - b.sort_index || a.start_day.localeCompare(b.start_day) || a.id.localeCompare(b.id);
}

export function coversDay(seg: Pick<Orderable, 'start_day' | 'end_day'>, day: string): boolean {
  return seg.start_day <= day && seg.end_day >= day;
}

// Segments on `truckId` that cover `day`, ordered as shown on the board.
export function dayGroup<T extends Orderable>(segments: T[], truckId: string, day: string): T[] {
  return segments.filter((s) => s.truck_id === truckId && coversDay(s, day)).sort(compareBoardOrder);
}

export type OrderInfo = { day: string; index: number; total: number };

/** The ids on a truck that day, in board order. */
export type DayOrderLookup = (truckId: string, day: string) => string[];

/**
 * dayGroup for every truck+day the boards ask about, each computed once per `segments`.
 *
 * ⚠️ BUILD IT ON ALL SEGMENTS, not the ones the search box or truck filter leaves visible. The order
 * is the crew's real sequence: a job hidden by a search is still driven to, and the arrows reorder
 * against the full list. Counting only visible cards made the badge say "2 of 2" next to a hidden
 * job — and pressing up swapped with that hidden job, so nothing visible moved.
 */
export function dayOrderLookup<T extends Orderable>(segments: T[]): DayOrderLookup {
  const cache = new Map<string, string[]>();
  return (truckId, day) => {
    const key = `${truckId}|${day}`;
    let ids = cache.get(key);
    if (!ids) {
      ids = dayGroup(segments, truckId, day).map((s) => s.id);
      cache.set(key, ids);
    }
    return ids;
  };
}

/**
 * The segment's position on each of `days` it covers and shares with another job — the days an
 * order means anything. A day it has to itself is left out, so an empty list means "no badge".
 */
export function sharedDayOrders(
  order: DayOrderLookup,
  seg: Pick<Orderable, 'id' | 'truck_id' | 'start_day' | 'end_day'>,
  days: string[],
): OrderInfo[] {
  return days
    .filter((day) => coversDay(seg, day))
    .map((day) => {
      const ids = order(seg.truck_id, day);
      return { day, index: ids.indexOf(seg.id), total: ids.length };
    })
    .filter((o) => o.total > 1);
}

/**
 * The sort_index a job placed on `day` should get: one past every job already on the truck that
 * day, so the order jobs are placed in IS the order they're run in — and a job continuing from
 * yesterday stays ahead of the newcomer. Pure so the rule is testable; placeSegment feeds it the
 * covering rows. Re-filters on truck + day, so a broader read can't put the job in the wrong queue.
 *
 * ⛔ NOT FOR A MOVE. A job dragged to another day or truck keeps its sort_index — William's decision
 * 2026-08-14: they rarely run several jobs per truck and day, and the planner checks the order after
 * a move rather than the app inventing one. Ask before changing it.
 *
 * Only the START day counts, on purpose. On its later days a multi-day job is the one continuing,
 * and continuing jobs go first on a tie — so it may well land ahead of jobs already booked there.
 * That is the default rule, not a newcomer cutting in line.
 */
export function nextSortIndexOnDay(segments: Orderable[], truckId: string, day: string): number {
  let highest = -1;
  for (const s of segments) if (s.truck_id === truckId && coversDay(s, day)) highest = Math.max(highest, s.sort_index);
  return highest + 1;
}

/**
 * Every segment on the truck linked to `day` through overlapping days: the jobs on that day, the
 * jobs those share another day with, and so on. Outside the chain no job shares a day with anyone
 * inside it, so its sort_index can be renumbered without changing what any other day shows.
 */
function overlapChain<T extends Orderable>(segments: T[], truckId: string, day: string): T[] {
  const onTruck = segments.filter((s) => s.truck_id === truckId);
  // Connected spans have no gap, so the chain is everything touching one contiguous window: grow
  // the window to its members' outer edges until it stops growing.
  let lo = day;
  let hi = day;
  for (;;) {
    const members = onTruck.filter((s) => s.start_day <= hi && s.end_day >= lo);
    const nextLo = members.reduce((m, s) => (s.start_day < m ? s.start_day : m), lo);
    const nextHi = members.reduce((m, s) => (s.end_day > m ? s.end_day : m), hi);
    if (nextLo === lo && nextHi === hi) return members;
    lo = nextLo;
    hi = nextHi;
  }
}

/**
 * The sort_index updates that move `segId` one step earlier ('up') or later ('down') on `day`.
 * Returns only the rows that change.
 *
 * ⚠️ RENUMBERS THE OVERLAP CHAIN, NOT THE DAY. A job running Wednesday–Thursday is in both days'
 * groups with ONE sort_index. Renumbering only Thursday's group 0..n gave it a new number that could
 * tie with — or pass — a Wednesday job nobody touched, and Wednesday reshuffled on its own. Here the
 * whole chain is laid out in its current board order, the job is moved next to its neighbour on
 * `day`, and the chain gets strictly increasing numbers. Every other pair keeps its order, so no
 * other day changes. The one exception: a job spanning several days that passes a job on another of
 * its days — then it has passed that job there too, because one number can't hold two positions.
 *
 * The numbers start at the chain's lowest and are only raised as far as needed to make them
 * distinct, so they stay close to what was stored and few rows are written.
 *
 * Only `segments` is seen — the board's loaded window. A chain member outside it would keep its
 * number; that takes a job spanning out of the window that overlaps one entirely outside it.
 */
export function reorderOnDay<T extends Orderable>(
  segments: T[],
  segId: string,
  day: string,
  direction: 'up' | 'down',
): { id: string; sort_index: number }[] {
  const seg = segments.find((s) => s.id === segId);
  if (!seg || !coversDay(seg, day)) return [];
  const group = dayGroup(segments, seg.truck_id, day);
  const idx = group.findIndex((s) => s.id === segId);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= group.length) return [];
  const neighbourId = group[target].id;

  const chain = overlapChain(segments, seg.truck_id, day).sort(compareBoardOrder);
  const numbers: number[] = [];
  for (const s of chain) numbers.push(numbers.length ? Math.max(s.sort_index, numbers[numbers.length - 1] + 1) : s.sort_index);

  const ids = chain.map((s) => s.id).filter((id) => id !== segId);
  const at = ids.indexOf(neighbourId);
  ids.splice(direction === 'up' ? at : at + 1, 0, segId);

  const stored = new Map(chain.map((s) => [s.id, s.sort_index]));
  return ids.map((id, i) => ({ id, sort_index: numbers[i] })).filter((next) => stored.get(next.id) !== next.sort_index);
}
