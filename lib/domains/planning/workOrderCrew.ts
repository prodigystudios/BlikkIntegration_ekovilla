import type { SupabaseClient } from '@supabase/supabase-js';

import { listCrewBySegment, type CrewMember } from './crew';
import { listAllDefaultCrew, type DefaultCrewMember } from './defaultCrew';
import { addDaysISO, mondayOfISO } from './timezone';
import { crewForTruckInRange, type TruckCrewMember } from './truckCrew';

// Vilka som bemannar en arbetsorder — hela jobbet, alla placeringar, alla veckor.
//
// Används för att förifylla KMA-planens kontaktlista och signaturlista (lib/domains/crm/kmaPlans/).
// Svaret är ett FÖRSLAG: ett jobb som planerats i gamla /plannering har inga rader här, och den som
// skapar planen redigerar alltid listan. Därför är det här best effort och aldrig en spärr.
//
// ⚠️ REGELN ÄR EN SPEGEL AV SQL:EN — de måste svara likadant. Samma tre grenar som
// `is_user_on_segment_between` (supabase/sql/20260917_get_my_crm_jobs_crew_per_day.sql) släpper
// igenom på, och samma veckoregel som `crewSizeForRange` (truckCrew.ts) räknar med:
//
//   1. placeringens egen besättning (ops_segment_crew) — hela placeringen, oavsett vecka;
//   2. bilens veckobesättning (ops_truck_crew) för varje ISO-vecka placeringen berör;
//   3. bilens standardteam (ops_truck_default_crew) — BARA för en vecka som saknar veckorader.
//
// 🧨 Fallbacken prövas PER VECKA, inte över hela jobbet. Fältfeeden frågar SQL:en dag för dag, så en
// person är på jobbet om hen är det NÅGON dag — och en dag hör till exakt en vecka. Ett fredag–
// måndag-jobb där bara den första veckan har en egen besättning får alltså standardteamet för den
// andra. Att pröva "finns det veckorader någonstans i hela spannet" hade tappat måndagens folk.
//
// Parkerade placeringar (`on_hold`) räknas inte: en parkerad placering är ingen plan, och bilens
// folk den veckan är inte de som gör jobbet.

export type WorkOrderCrewPerson = {
  member_id: string | null;
  member_name: string;
  /** Teamledare på bilen någon av jobbets veckor. Blir "Ledande installatör" i KMA-planen. */
  leader: boolean;
};

export type CrewSegment = {
  id: string;
  truck_id: string;
  start_day: string;
  end_day: string;
  on_hold?: boolean;
};

/** ISO-veckorna (måndag–söndag) som ett datumspann berör. Tomt vid ogiltig indata. */
export function isoWeeksTouching(startISO: string, endISO: string): { from: string; to: string }[] {
  const first = mondayOfISO(startISO);
  if (!first || !mondayOfISO(endISO) || endISO < startISO) return [];
  const weeks: { from: string; to: string }[] = [];
  // UTC-förankrad stegning (addDaysISO): en vecka är alltid sju kalenderdagar, även den vecka
  // klockan ställs om. Ingen millisekunddivision någonstans.
  for (let monday = first; monday <= endISO; monday = addDaysISO(monday, 7)) {
    weeks.push({ from: monday, to: addDaysISO(monday, 6) });
  }
  return weeks;
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');

/** Ren: jobbets besättning ur de tre tabellerna. Ledare först, sedan namnordning. */
export function resolveWorkOrderCrew(input: {
  segments: CrewSegment[];
  segmentCrew: Map<string, CrewMember[]>;
  weekly: TruckCrewMember[];
  defaults: DefaultCrewMember[];
}): WorkOrderCrewPerson[] {
  const byId = new Map<string, WorkOrderCrewPerson>();
  const byName = new Map<string, WorkOrderCrewPerson>();

  const add = (memberId: string | null, memberName: string, leader: boolean) => {
    const name = memberName.trim();
    if (!name && !memberId) return;
    const key = normalizeName(name);
    let existing = memberId ? byId.get(memberId) : undefined;
    if (!existing && key) {
      const sameName = byName.get(key);
      // Namnet slår bara ihop när någon av raderna saknar konto. Två OLIKA konton med samma namn är
      // två personer — sammanslagna hade den ena försvunnit ur signaturlistan.
      if (sameName && (!memberId || !sameName.member_id)) existing = sameName;
    }
    if (existing) {
      existing.leader = existing.leader || leader;
      // En namnrad (utan konto) som senare visar sig ha ett id får det — samma person, en rad.
      if (!existing.member_id && memberId) {
        existing.member_id = memberId;
        byId.set(memberId, existing);
      }
      return;
    }
    const person: WorkOrderCrewPerson = { member_id: memberId, member_name: name, leader };
    if (memberId) byId.set(memberId, person);
    if (key && !byName.has(key)) byName.set(key, person);
  };

  for (const segment of input.segments) {
    if (segment.on_hold) continue;

    for (const member of input.segmentCrew.get(segment.id) ?? []) {
      add(member.member_id, member.member_name, false);
    }

    for (const week of isoWeeksTouching(segment.start_day, segment.end_day)) {
      const thisWeek = crewForTruckInRange(input.weekly, segment.truck_id, week.from, week.to);
      // Villkoret står på RADER, som i crewSizeForRange: en vecka med en egen besättning ÄR
      // överstyrd, även om raderna bara är namn utan konto.
      const rows = thisWeek.length > 0 ? thisWeek : input.defaults.filter((d) => d.truck_id === segment.truck_id);
      for (const row of rows) add(row.member_id, row.member_name, row.role === 'leader');
    }
  }

  const people = new Set<WorkOrderCrewPerson>([...byId.values(), ...byName.values()]);
  return [...people].sort((a, b) =>
    a.leader === b.leader ? a.member_name.localeCompare(b.member_name, 'sv') : a.leader ? -1 : 1,
  );
}

const TRUCK_CREW_SELECT = 'id, truck_id, member_id, member_name, start_day, end_day, role';

/**
 * Laddar och löser besättningen för en arbetsorder. Sessionsklienten: alla fyra tabellerna kräver
 * `planning.schedule.read`, och den som saknar nyckeln får en tom lista — aldrig en elevated läsning
 * för att fylla i ett förslag.
 */
export async function listWorkOrderCrew(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ data: WorkOrderCrewPerson[]; error: { message: string } | null }> {
  const { data: rawSegments, error } = await supabase
    .from('ops_segments')
    .select('id, truck_id, start_day, end_day, on_hold')
    .eq('work_order_id', workOrderId)
    .order('id', { ascending: true });
  if (error) return { data: [], error };

  const segments = ((rawSegments ?? []) as CrewSegment[]).filter((s) => !s.on_hold);
  if (segments.length === 0) return { data: [], error: null };

  const truckIds = [...new Set(segments.map((s) => s.truck_id))];
  const from = mondayOfISO(segments.reduce((min, s) => (s.start_day < min ? s.start_day : min), segments[0].start_day));
  const lastDay = segments.reduce((max, s) => (s.end_day > max ? s.end_day : max), segments[0].end_day);
  const lastMonday = mondayOfISO(lastDay);
  if (!from || !lastMonday) return { data: [], error: null };
  const to = addDaysISO(lastMonday, 6);

  // Veckoraderna läses per BIL, inte för alla bilar som listTruckCrew gör: ett etappjobb kan ligga
  // utspritt över månader, och alla bilars rader över ett halvår närmar sig PostgRESTs tysta tak
  // på 1000 rader. Ett kapat svar hade tappat folk utan att någon märker det.
  const [segmentCrew, weekly, defaults] = await Promise.all([
    listCrewBySegment(supabase, segments.map((s) => s.id)),
    supabase
      .from('ops_truck_crew')
      .select(TRUCK_CREW_SELECT)
      .in('truck_id', truckIds)
      .lte('start_day', to)
      .gte('end_day', from)
      .order('id', { ascending: true }),
    listAllDefaultCrew(supabase),
  ]);
  if (weekly.error) return { data: [], error: weekly.error };
  if (defaults.error) return { data: [], error: defaults.error };

  return {
    data: resolveWorkOrderCrew({
      segments,
      segmentCrew,
      weekly: (weekly.data ?? []) as TruckCrewMember[],
      defaults: defaults.data,
    }),
    error: null,
  };
}
