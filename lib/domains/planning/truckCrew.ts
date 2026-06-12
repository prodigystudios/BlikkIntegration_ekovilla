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

// Pure: source crew members not already present in the target week (deduped by member_id). These
// are the rows to copy when cloning a truck's crew to another week.
export function membersToCopy(source: TruckCrewMember[], targetExisting: TruckCrewMember[]): TruckCrewMember[] {
  const have = new Set(targetExisting.map((m) => m.member_id).filter((v): v is string => Boolean(v)));
  const seen = new Set<string>();
  const out: TruckCrewMember[] = [];
  for (const m of source) {
    if (!m.member_id || have.has(m.member_id) || seen.has(m.member_id)) continue;
    seen.add(m.member_id);
    out.push(m);
  }
  return out;
}

export type CopyTruckCrewInput = {
  truckId: string;
  sourceFrom: string;
  sourceTo: string;
  targetFrom: string;
  targetTo: string;
  actorUserId: string;
};

// Copy a truck's crew from one week to another, skipping anyone already on the target week.
export async function copyTruckCrewWeek(
  supabase: SupabaseClient,
  input: CopyTruckCrewInput,
): Promise<{ data: { copied: number } | null; error: { message: string } | null }> {
  const source = (await listTruckCrew(supabase, { from: input.sourceFrom, to: input.sourceTo })).data.filter((m) => m.truck_id === input.truckId);
  const target = (await listTruckCrew(supabase, { from: input.targetFrom, to: input.targetTo })).data.filter((m) => m.truck_id === input.truckId);
  const toCopy = membersToCopy(source, target);
  if (toCopy.length === 0) return { data: { copied: 0 }, error: null };

  const { error } = await supabase.from('ops_truck_crew').insert(
    toCopy.map((m) => ({
      truck_id: input.truckId,
      member_id: m.member_id,
      member_name: m.member_name,
      start_day: input.targetFrom,
      end_day: input.targetTo,
      created_by: input.actorUserId,
    })),
  );
  return { data: error ? null : { copied: toCopy.length }, error };
}
