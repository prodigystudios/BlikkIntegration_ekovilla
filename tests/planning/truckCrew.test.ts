import { describe, it, expect } from 'vitest';
import { crewForTruckInRange, crewSizeForRange, membersToCopy, shiftISO, type TruckCrewMember } from '@/lib/domains/planning/truckCrew';

function row(id: string, truck_id: string, start_day: string, end_day: string): TruckCrewMember {
  return { id, truck_id, member_id: id, member_name: `M${id}`, start_day, end_day, role: 'member' };
}

function member(memberId: string | null): TruckCrewMember {
  return { id: `row-${memberId}`, truck_id: 't1', member_id: memberId, member_name: `M${memberId}`, start_day: '2026-06-15', end_day: '2026-06-21', role: 'member' };
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

describe('shiftISO', () => {
  it('shifts a date forward by whole days', () => {
    expect(shiftISO('2026-06-15', 7)).toBe('2026-06-22');
  });
  it('shifts across a month boundary', () => {
    expect(shiftISO('2026-06-29', 7)).toBe('2026-07-06');
  });
  it('preserves a partial-week range offset (Mon–Wed stays 3 days after a +7 copy)', () => {
    // Source Mon–Wed copied to next week must remain Mon–Wed, not become the full week.
    expect(shiftISO('2026-06-15', 7)).toBe('2026-06-22'); // Mon → next Mon
    expect(shiftISO('2026-06-17', 7)).toBe('2026-06-24'); // Wed → next Wed
  });
});

// Hur många som ser en publicerad platshållare. Siffran står i platshållarmodalen och avgör om
// planeraren varnas för att ingen ser bokningen — så den måste svara exakt som
// `is_user_on_segment` i supabase/sql/20260908_ops_segments_field_visible.sql släpper igenom på.
// Räknar de olika lovar modalen en mottagare som feeden inte har.
describe('crewSizeForRange', () => {
  const weekly = [
    row('a', 't1', '2026-06-15', '2026-06-21'),
    row('b', 't1', '2026-06-15', '2026-06-21'),
    row('c', 't2', '2026-06-15', '2026-06-21'),
  ];
  const defaults = [{ truck_id: 't1' }, { truck_id: 't1' }, { truck_id: 't1' }, { truck_id: 't2' }];

  it('räknar veckans besättning när veckan har egna rader', () => {
    expect(crewSizeForRange(weekly, defaults, 't1', '2026-06-15', '2026-06-21')).toBe(2);
  });

  it('faller tillbaka på standardbemanningen när veckan är otilldelad', () => {
    expect(crewSizeForRange([], defaults, 't1', '2026-06-15', '2026-06-21')).toBe(3);
  });

  it('låter veckan vinna även när den är MINDRE än standardteamet', () => {
    // Regeln är "veckan överstyr", inte "flest vinner". En forkad vecka med en person är ett
    // medvetet undantag — att svara 3 hade räknat in dem som uttryckligen bytts bort.
    const one = [row('a', 't1', '2026-06-15', '2026-06-21')];
    expect(crewSizeForRange(one, defaults, 't1', '2026-06-15', '2026-06-21')).toBe(1);
  });

  it('svarar 0 när bilen varken har veckobesättning eller standardteam', () => {
    // Det här är tillståndet som ska varnas för: switchen står på och ingen ser bokningen.
    expect(crewSizeForRange(weekly, defaults, 't3', '2026-06-15', '2026-06-21')).toBe(0);
  });

  it('hittar en besättning som bara täcker DEL av veckan', () => {
    // Vidgningen till hela ISO-veckor sker hos anroparen; den här raden bevisar varför den behövs.
    // En måndag–onsdag-besättning ska hittas av ett torsdagsjobb vars vecka vidgats.
    const partial = [row('a', 't1', '2026-06-15', '2026-06-17')];
    expect(crewSizeForRange(partial, defaults, 't1', '2026-06-15', '2026-06-21')).toBe(1);
    // Utan vidgning (bara torsdagen) hade den missats och standardteamet svarat i stället.
    expect(crewSizeForRange(partial, defaults, 't1', '2026-06-18', '2026-06-18')).toBe(3);
  });
});
