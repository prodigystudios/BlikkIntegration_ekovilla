import { describe, it, expect } from 'vitest';
import { sortPlacements, withPlacementAdded, withPlacementMoved, withPlacementRemoved } from '@/lib/domains/planning/backlogPlacements';
import { placementsByScope } from '@/lib/domains/planning/backlog';
import type { BacklogPlacement } from '@/lib/domains/planning/types';

const p = (segment_id: string, start_day: string, truck_id = 't1', end_day = start_day, on_hold = false): BacklogPlacement => ({
  segment_id, truck_id, start_day, end_day, on_hold,
});

describe('placementsByScope', () => {
  const row = (id: string, work_order_id: string, stage_id: string | null, start_day: string, on_hold: boolean | null = false) => ({
    id, work_order_id, stage_id, truck_id: 't1', start_day, end_day: start_day, on_hold,
  });

  it('grupperar per post — etapp och resten var för sig — och sorterar på startdag', () => {
    const map = placementsByScope([
      row('b', 'wo1', 's1', '2026-10-20'),
      row('a', 'wo1', 's1', '2026-10-14'),
      row('c', 'wo1', null, '2026-10-15'),
    ]);
    expect(map.get('wo1:s1')?.map((x) => x.segment_id)).toEqual(['a', 'b']);
    expect(map.get('wo1:rest')?.map((x) => x.segment_id)).toEqual(['c']);
  });

  it('on_hold null läses som inte pausad', () => {
    expect(placementsByScope([row('a', 'wo1', null, '2026-10-14', null)]).get('wo1:rest')?.[0].on_hold).toBe(false);
  });
});

describe('sortPlacements', () => {
  it('startdag först, sedan bil — samma dag står stilla mellan omladdningar', () => {
    const sorted = sortPlacements([p('x', '2026-10-14', 't2'), p('y', '2026-10-14', 't1'), p('z', '2026-10-01', 't9')]);
    expect(sorted.map((x) => x.segment_id)).toEqual(['z', 'y', 'x']);
  });
});

describe('backloggens kort och räknare hålls ihop', () => {
  const backlog = [
    { key: 'wo1:s1', segment_count: 1, placements: [p('a', '2026-10-20')] },
    { key: 'wo1:s2', segment_count: 0, placements: [] as BacklogPlacement[] },
  ];

  it('ett nytt kort hamnar på rätt etapp, sorterat, och räknaren följer med', () => {
    const next = withPlacementAdded(backlog, 'wo1:s1', p('b', '2026-10-14'));
    expect(next[0].segment_count).toBe(2);
    expect(next[0].placements.map((x) => x.segment_id)).toEqual(['b', 'a']);
    expect(next[1]).toBe(backlog[1]); // etapp 2 orörd
  });

  it('ett borttaget kort försvinner ur listan och räknaren följer listan', () => {
    const next = withPlacementRemoved(backlog, 'wo1:s1', 'a');
    expect(next[0]).toMatchObject({ segment_count: 0, placements: [] });
  });

  // Räknaren är listans längd, aldrig ±1: annars hade "Planerade" kunnat stå på en post utan rader.
  it('ett kort som inte finns i listan ändrar ingenting — inte heller räknaren', () => {
    const next = withPlacementRemoved(backlog, 'wo1:s1', 'a');
    expect(withPlacementRemoved(next, 'wo1:s1', 'a')).toBe(next);
  });

  // En omladdning av backloggen kan hinna före placeringens egen uppdatering och redan bära kortet.
  it('samma kort två gånger ger en rad och räknaren ett', () => {
    const once = withPlacementAdded(backlog, 'wo1:s2', p('n', '2026-10-14'));
    expect(withPlacementAdded(once, 'wo1:s2', p('n', '2026-10-14'))).toBe(once);
    expect(once[1]).toMatchObject({ segment_count: 1 });
  });

  it('en flytt ändrar bil, dagar och paus på kortet och sorterar om; räknaren rörs inte', () => {
    const two = withPlacementAdded(backlog, 'wo1:s1', p('b', '2026-10-14'));
    const moved = withPlacementMoved(two, 'b', { truck_id: 't2', start_day: '2026-10-27', end_day: '2026-10-28', on_hold: true });
    expect(moved[0].segment_count).toBe(2);
    expect(moved[0].placements.map((x) => x.segment_id)).toEqual(['a', 'b']);
    expect(moved[0].placements[1]).toMatchObject({ truck_id: 't2', start_day: '2026-10-27', end_day: '2026-10-28', on_hold: true });
  });

  it('samma array när posten eller kortet inte finns i backloggen', () => {
    expect(withPlacementAdded(backlog, 'okänd', p('x', '2026-10-14'))).toBe(backlog);
    expect(withPlacementRemoved(backlog, 'okänd', 'a')).toBe(backlog);
    expect(withPlacementMoved(backlog, 'okänt-kort', { start_day: '2026-10-01' })).toBe(backlog);
  });
});
