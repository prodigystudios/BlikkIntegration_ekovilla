import { describe, it, expect } from 'vitest';
import { defaultCrewByTruck, validateDefaultCrew, type DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';

function m(id: string, truck: string, role: 'leader' | 'member'): DefaultCrewMember {
  return { id, truck_id: truck, member_id: id, member_name: `M${id}`, role };
}

describe('defaultCrewByTruck', () => {
  it('groups by truck and sorts the leader first', () => {
    const map = defaultCrewByTruck([
      m('a', 't1', 'member'),
      m('b', 't1', 'leader'),
      m('c', 't2', 'member'),
    ]);
    expect(map.get('t1')!.map((x) => x.id)).toEqual(['b', 'a']); // leader first
    expect(map.get('t2')!.map((x) => x.id)).toEqual(['c']);
    expect(map.has('t3')).toBe(false);
  });
});

describe('validateDefaultCrew', () => {
  it('accepts a team with one leader', () => {
    expect(validateDefaultCrew([
      { member_id: 'a', member_name: 'Anna', role: 'leader' },
      { member_id: 'b', member_name: 'Bo', role: 'member' },
    ])).toBeNull();
  });
  it('accepts a team with no leader', () => {
    expect(validateDefaultCrew([{ member_id: 'b', member_name: 'Bo', role: 'member' }])).toBeNull();
  });
  it('rejects two leaders', () => {
    expect(validateDefaultCrew([
      { member_id: 'a', member_name: 'Anna', role: 'leader' },
      { member_id: 'b', member_name: 'Bo', role: 'leader' },
    ])).toBe('too_many_leaders');
  });
  it('rejects an empty name', () => {
    expect(validateDefaultCrew([{ member_id: 'a', member_name: '  ', role: 'member' }])).toBe('empty_name');
  });
});
