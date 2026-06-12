import type { SupabaseClient } from '@supabase/supabase-js';

// Weekly truck crew (besättning per bil): who crews a truck over a date range. The board resolves
// each truck's crew for the visible week from these rows. member_name is denormalised (profiles are
// self-read-only) — same rationale as ops_segment_crew. Pure helpers here are unit-tested.

export type TruckCrewMember = {
  id: string;
  truck_id: string;
  member_id: string | null;
  member_name: string;
  start_day: string;
  end_day: string;
};

// Pure: crew rows for a truck whose date range overlaps [from, to] (ISO dates sort lexically, so a
// string compare is a correct overlap test).
export function crewForTruckInRange(
  rows: TruckCrewMember[],
  truckId: string,
  from: string,
  to: string,
): TruckCrewMember[] {
  return rows.filter((r) => r.truck_id === truckId && r.start_day <= to && r.end_day >= from);
}

const TRUCK_CREW_SELECT = 'id, truck_id, member_id, member_name, start_day, end_day';

// Crew rows overlapping [from, to]. RLS (planning.schedule.read) applies.
export async function listTruckCrew(
  supabase: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ data: TruckCrewMember[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_truck_crew')
    .select(TRUCK_CREW_SELECT)
    .lte('start_day', range.to)
    .gte('end_day', range.from)
    .order('member_name', { ascending: true });
  return { data: (data ?? []) as TruckCrewMember[], error };
}

export type AssignTruckCrewInput = {
  truckId: string;
  memberId: string | null;
  memberName: string;
  startDay: string;
  endDay: string;
  actorUserId: string;
};

// created_by must equal the caller (RLS insert policy checks created_by = auth.uid()).
export async function assignTruckCrew(
  supabase: SupabaseClient,
  input: AssignTruckCrewInput,
): Promise<{ data: TruckCrewMember | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_truck_crew')
    .insert({
      truck_id: input.truckId,
      member_id: input.memberId,
      member_name: input.memberName,
      start_day: input.startDay,
      end_day: input.endDay,
      created_by: input.actorUserId,
    })
    .select(TRUCK_CREW_SELECT)
    .single();
  return { data: (data as TruckCrewMember) ?? null, error };
}

export async function unassignTruckCrew(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_truck_crew').delete().eq('id', id);
}
