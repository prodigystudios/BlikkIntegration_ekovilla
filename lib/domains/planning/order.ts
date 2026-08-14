// Ordering of jobs that share a truck on the same day ("which job is done first"). The order is
// carried by ops_segments.sort_index; these pure helpers compute a segment's position in its
// truck+day group and the sort_index changes needed to nudge it earlier/later. Unit-tested.

type Orderable = { id: string; truck_id: string; start_day: string; sort_index: number };

/**
 * THE order two jobs on the same truck and day are shown in: sort_index, then id.
 *
 * ⚠️ Every surface that renders segments must use this. `sort_index` defaults to 0 for every row
 * (see 20260611_ops_planning_foundation.sql), so untouched jobs are all ties — and a tie decided by
 * anything other than a stable key is decided by nothing. Postgres is free to return equal-ranked
 * rows in any order, and it changes that order after an unrelated UPDATE, so the week board (which
 * rendered in raw array order) reshuffled two jobs on one truck when a job on a DIFFERENT truck was
 * moved to another day. The month board sorted, but left sort_index out entirely, so a card badged
 * "2/2" could sit above the one badged "1/2".
 */
export function compareBoardOrder(a: Orderable, b: Orderable): number {
  return a.sort_index - b.sort_index || a.id.localeCompare(b.id);
}

// Segments sharing the same truck AND start day, ordered as shown on the board.
export function dayGroup<T extends Orderable>(segments: T[], seg: Pick<Orderable, 'truck_id' | 'start_day'>): T[] {
  return segments
    .filter((s) => s.truck_id === seg.truck_id && s.start_day === seg.start_day)
    .sort(compareBoardOrder);
}

export type OrderInfo = { index: number; total: number };

// A segment's 1-based-friendly position (0-based index) within its truck+day group.
export function orderInfo<T extends Orderable>(segments: T[], seg: T): OrderInfo {
  const group = dayGroup(segments, seg);
  return { index: group.findIndex((s) => s.id === seg.id), total: group.length };
}

// The sort_index updates needed to move `segId` one step earlier ('up') or later ('down') within
// its group. Renumbers the affected members to 0..n so positions are always distinct (the seeded
// default of 0 everywhere would otherwise make a swap a no-op). Returns only the rows that change.
export function reorderWithinGroup<T extends Orderable>(
  group: T[],
  segId: string,
  direction: 'up' | 'down',
): { id: string; sort_index: number }[] {
  const idx = group.findIndex((s) => s.id === segId);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= group.length) return [];
  const ids = group.map((s) => s.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return ids
    .map((id, i) => ({ id, sort_index: i }))
    .filter((next) => group.find((s) => s.id === next.id)!.sort_index !== next.sort_index);
}
