import { describe, it, expect } from 'vitest';
import { crewForTruckInRange, membersToCopy, type TruckCrewMember } from '@/lib/domains/planning/truckCrew';

function row(id: string, truck_id: string, start_day: string, end_day: string): TruckCrewMember {
  return { id, truck_id, member_id: id, member_name: `M${id}`, start_day, end_day };
}

function member(memberId: string | null): TruckCrewMember {
  return { id: `row-${memberId}`, truck_id: 't1', member_id: memberId, member_name: `M${memberId}`, start_day: '2026-06-15', end_day: '2026-06-21' };
}

describe('crewForTruckInRange', () => {
  const rows = [
    row('a', 't1', '2026-06-15', '2026-06-21'), // covers the week
    row('b', 't1', '2026-06-08', '2026-06-14'), // the week before
    row('c', 't2', '2026-06-15', '2026-06-21'), // other truck
    row('d', 't1', '2026-06-20', '2026-06-26'), // overlaps the tail of the week
  ];

  it('returns crew for the truck whose range overlaps the window', () => {
    const ids = crewForTruckInRange(rows, 't1', '2026-06-15', '2026-06-21').map((r) => r.id);
    expect(ids.sort()).toEqual(['a', 'd']);
  });

  it('excludes other trucks', () => {
    expect(crewForTruckInRange(rows, 't2', '2026-06-15', '2026-06-21').map((r) => r.id)).toEqual(['c']);
  });

  it('excludes non-overlapping ranges', () => {
    expect(crewForTruckInRange(rows, 't1', '2026-06-22', '2026-06-28').map((r) => r.id)).toEqual(['d']);
  });

  it('returns empty when nothing matches', () => {
    expect(crewForTruckInRange(rows, 't9', '2026-06-15', '2026-06-21')).toEqual([]);
  });
});

describe('membersToCopy', () => {
  it('copies source members not already on the target week', () => {
    const source = [member('a'), member('b'), member('c')];
    const target = [member('b')];
    expect(membersToCopy(source, target).map((m) => m.member_id)).toEqual(['a', 'c']);
  });
  it('dedupes the source and skips freetext (null member_id)', () => {
    const source = [member('a'), member('a'), member(null)];
    expect(membersToCopy(source, []).map((m) => m.member_id)).toEqual(['a']);
  });
  it('copies nothing when the target already has everyone', () => {
    const source = [member('a'), member('b')];
    expect(membersToCopy(source, [member('a'), member('b')])).toEqual([]);
  });
});
