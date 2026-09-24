import { describe, it, expect } from 'vitest';

import { isoWeeksTouching, resolveWorkOrderCrew, type CrewSegment } from '@/lib/domains/planning/workOrderCrew';
import type { CrewMember } from '@/lib/domains/planning/crew';
import type { DefaultCrewMember } from '@/lib/domains/planning/defaultCrew';
import type { TruckCrewMember } from '@/lib/domains/planning/truckCrew';

// Arbetsorderns besättning — förslaget till KMA-planens kontakt- och signaturlista. Regeln är en
// spegel av `is_user_on_segment_between`; testerna nedan är de fall där en förenklad regel hade
// tappat eller lagt till folk.

const TRUCK_A = 'truck-aaaa';
const TRUCK_B = 'truck-bbbb';

const seg = (overrides: Partial<CrewSegment> = {}): CrewSegment => ({
  id: 'seg-one',
  truck_id: TRUCK_A,
  start_day: '2026-09-21', // måndag
  end_day: '2026-09-23',
  ...overrides,
});

const weekly = (overrides: Partial<TruckCrewMember>): TruckCrewMember => ({
  id: `tc-${Math.abs(JSON.stringify(overrides).length)}`,
  truck_id: TRUCK_A,
  member_id: null,
  member_name: 'Namn',
  start_day: '2026-09-21',
  end_day: '2026-09-27',
  role: 'member',
  ...overrides,
});

const deflt = (overrides: Partial<DefaultCrewMember>): DefaultCrewMember => ({
  id: 'dc',
  truck_id: TRUCK_A,
  member_id: null,
  member_name: 'Namn',
  role: 'member',
  ...overrides,
});

const crewMap = (entries: Record<string, CrewMember[]> = {}) => new Map(Object.entries(entries));

const names = (people: { member_name: string }[]) => people.map((p) => p.member_name);

describe('isoWeeksTouching', () => {
  it('ett fredag–måndag-spann berör två veckor', () => {
    expect(isoWeeksTouching('2026-09-25', '2026-09-28')).toEqual([
      { from: '2026-09-21', to: '2026-09-27' },
      { from: '2026-09-28', to: '2026-10-04' },
    ]);
  });

  it('måndag–söndag är en vecka', () => {
    expect(isoWeeksTouching('2026-09-21', '2026-09-27')).toEqual([{ from: '2026-09-21', to: '2026-09-27' }]);
  });

  it('veckan då klockan ställs tillbaka (25 okt 2026) är sju kalenderdagar', () => {
    // Stegningen sker på kalenderdatum (UTC-förankrat), aldrig i millisekunder — därför kan en
    // 169-timmarsvecka inte flytta nästa måndag till söndagen.
    //
    // ⚠️ ZONBEROENDE. Den naiva varianten (lokal midnatt + 7 × 86 400 000 ms) är KORREKT under
    // TZ=UTC — felet finns bara där klockan ställs om. Testet biter därför bara i en sommartidszon:
    // mutationsprövat rött under TZ=Europe/Stockholm, grönt under TZ=UTC (som CI och Vercel kör).
    // Kör `TZ=Europe/Stockholm npx vitest run tests/planning/workOrderCrew.test.ts` när stegningen ändras.
    expect(isoWeeksTouching('2026-10-23', '2026-10-26')).toEqual([
      { from: '2026-10-19', to: '2026-10-25' },
      { from: '2026-10-26', to: '2026-11-01' },
    ]);
  });

  it('över årsskiftet', () => {
    expect(isoWeeksTouching('2026-12-31', '2027-01-04')).toEqual([
      { from: '2026-12-28', to: '2027-01-03' },
      { from: '2027-01-04', to: '2027-01-10' },
    ]);
  });

  it('ogiltig eller baklänges indata ger inga veckor', () => {
    expect(isoWeeksTouching('inte-ett-datum', '2026-09-21')).toEqual([]);
    expect(isoWeeksTouching('2026-09-28', '2026-09-21')).toEqual([]);
  });
});

describe('resolveWorkOrderCrew', () => {
  it('placeringens egen besättning tas alltid med, även när veckan har veckobesättning', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap({ 'seg-one': [{ id: 'sc1', member_id: 'user-extra', member_name: 'Extra Snickare' }] }),
      weekly: [weekly({ member_id: 'user-anna', member_name: 'Anna Ledare', role: 'leader' })],
      defaults: [],
    });
    expect(names(people)).toEqual(['Anna Ledare', 'Extra Snickare']);
  });

  it('en vecka med egen besättning överstyr standardteamet — bara den veckan', () => {
    // Fredag–måndag: vecka 1 har en egen besättning, vecka 2 saknar den och får standardteamet.
    const people = resolveWorkOrderCrew({
      segments: [seg({ start_day: '2026-09-25', end_day: '2026-09-28' })],
      segmentCrew: crewMap(),
      weekly: [
        weekly({ member_id: 'user-anna', member_name: 'Anna Ledare', role: 'leader' }),
        weekly({ member_id: 'user-bo', member_name: 'Bo Blåsare' }),
      ],
      defaults: [
        deflt({ member_id: 'user-cecilia', member_name: 'Cecilia Standard', role: 'leader' }),
        deflt({ member_id: 'user-david', member_name: 'David Standard' }),
      ],
    });
    expect(names(people)).toEqual(['Anna Ledare', 'Cecilia Standard', 'Bo Blåsare', 'David Standard']);
    expect(people.filter((p) => p.leader).map((p) => p.member_name)).toEqual(['Anna Ledare', 'Cecilia Standard']);
  });

  it('en överstyrd vecka tar INTE med standardteamet', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap(),
      weekly: [weekly({ member_id: 'user-anna', member_name: 'Anna Ledare' })],
      defaults: [deflt({ member_id: 'user-cecilia', member_name: 'Cecilia Standard' })],
    });
    expect(names(people)).toEqual(['Anna Ledare']);
  });

  it('en veckorad utan konto överstyr också — villkoret står på rader, inte på konton', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap(),
      weekly: [weekly({ member_id: null, member_name: 'Inhyrd Montör' })],
      defaults: [deflt({ member_id: 'user-cecilia', member_name: 'Cecilia Standard' })],
    });
    expect(names(people)).toEqual(['Inhyrd Montör']);
  });

  it('samma person i flera tabeller blir en rad, och ledarskap någonstans befordrar', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap({ 'seg-one': [{ id: 'sc1', member_id: 'user-anna', member_name: 'Anna Ledare' }] }),
      weekly: [weekly({ member_id: 'user-anna', member_name: 'Anna Ledare', role: 'leader' })],
      defaults: [],
    });
    expect(people).toEqual([{ member_id: 'user-anna', member_name: 'Anna Ledare', leader: true }]);
  });

  it('en namnrad utan konto slås ihop med kontot med samma namn', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap({ 'seg-one': [{ id: 'sc1', member_id: null, member_name: '  anna  LEDARE ' }] }),
      weekly: [weekly({ member_id: 'user-anna', member_name: 'Anna Ledare', role: 'leader' })],
      defaults: [],
    });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ member_id: 'user-anna', leader: true });
  });

  it('två OLIKA konton med samma namn är två personer', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap({ 'seg-one': [{ id: 'sc1', member_id: 'user-johan-1', member_name: 'Johan Andersson' }] }),
      weekly: [weekly({ member_id: 'user-johan-2', member_name: 'Johan Andersson' })],
      defaults: [],
    });
    expect(people.map((p) => p.member_id).sort()).toEqual(['user-johan-1', 'user-johan-2']);
  });

  it('en parkerad placering bidrar inte med någon', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg({ on_hold: true })],
      segmentCrew: crewMap({ 'seg-one': [{ id: 'sc1', member_id: 'user-extra', member_name: 'Extra Snickare' }] }),
      weekly: [weekly({ member_id: 'user-anna', member_name: 'Anna Ledare' })],
      defaults: [],
    });
    expect(people).toEqual([]);
  });

  it('andra bilars folk följer inte med', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg()],
      segmentCrew: crewMap(),
      weekly: [weekly({ truck_id: TRUCK_B, member_id: 'user-other', member_name: 'Annan Bil' })],
      defaults: [deflt({ member_id: 'user-cecilia', member_name: 'Cecilia Standard' })],
    });
    // Bil B:s veckorad överstyr INTE bil A:s vecka — standardteamet gäller för bil A.
    expect(names(people)).toEqual(['Cecilia Standard']);
  });

  it('två placeringar på olika bilar ger båda bilarnas folk', () => {
    const people = resolveWorkOrderCrew({
      segments: [seg(), seg({ id: 'seg-two', truck_id: TRUCK_B })],
      segmentCrew: crewMap(),
      weekly: [],
      defaults: [
        deflt({ member_id: 'user-cecilia', member_name: 'Cecilia Standard' }),
        deflt({ truck_id: TRUCK_B, member_id: 'user-erik', member_name: 'Erik Bil B' }),
      ],
    });
    expect(names(people)).toEqual(['Cecilia Standard', 'Erik Bil B']);
  });
});
