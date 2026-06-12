import type { SupabaseClient } from '@supabase/supabase-js';

// Per-segment crew (besättning) for the CRM-first planning. A crew member's display name is
// denormalised onto the row (member_name) because profiles SELECT RLS is self-only — the planner
// can't read other people's profile rows, so the board renders entirely from ops_segment_crew
// without ever joining profiles. member_id is kept (nullable) for future installer / "my jobs"
// linking. Pure helpers here are unit-tested; the DB functions are thin RLS-scoped queries.

// A crew member as rendered on a job card.
export type CrewMember = {
  id: string; // ops_segment_crew row id
  member_id: string | null;
  member_name: string;
};

// A person the planner can pick from (any employee with a name — installers included). Sourced via
// the admin client because session RLS hides other profiles.
export type AssignablePerson = {
  id: string;
  full_name: string;
};

// Initials for an avatar chip: first letter of the first + last name token; a single token gives
// its first two letters; empty falls back to '?'.
export function crewInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Muted avatar palette that sits inside the sage/paper CRM system.
const CREW_COLORS = ['#3f6f52', '#5a7d9a', '#9a6f4e', '#7a6a9c', '#a05c6b', '#4f8a82', '#8a7a4e', '#6b7280'];

// Deterministic colour for a crew member, keyed by their id/name so a person reads the same colour
// everywhere on the board (no Math.random — must be stable across renders/runs).
export function crewColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return CREW_COLORS[Math.abs(hash) % CREW_COLORS.length];
}

// Pure validation for a crew assignment. A name is always required (it's the durable display value).
export function validateCrewAssignment(memberName: string): 'invalid_name' | null {
  return memberName.trim().length > 0 ? null : 'invalid_name';
}

type RawCrew = { id: string; segment_id: string; member_id: string | null; member_name: string };

// Crew rows grouped by segment id, for a set of segments. RLS (planning.schedule.read) applies.
export async function listCrewBySegment(
  supabase: SupabaseClient,
  segmentIds: string[],
): Promise<Map<string, CrewMember[]>> {
  const map = new Map<string, CrewMember[]>();
  if (segmentIds.length === 0) return map;
  const { data } = await supabase
    .from('ops_segment_crew')
    .select('id, segment_id, member_id, member_name')
    .in('segment_id', segmentIds)
    .order('member_name', { ascending: true });
  for (const r of (data ?? []) as RawCrew[]) {
    const list = map.get(r.segment_id) ?? [];
    list.push({ id: r.id, member_id: r.member_id, member_name: r.member_name });
    map.set(r.segment_id, list);
  }
  return map;
}

export type AssignCrewInput = {
  segmentId: string;
  memberId: string | null;
  memberName: string;
  actorUserId: string;
};

// created_by must equal the caller (RLS insert policy checks created_by = auth.uid()).
export async function assignCrew(
  supabase: SupabaseClient,
  input: AssignCrewInput,
): Promise<{ data: CrewMember | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_segment_crew')
    .insert({
      segment_id: input.segmentId,
      member_id: input.memberId,
      member_name: input.memberName,
      created_by: input.actorUserId,
    })
    .select('id, segment_id, member_id, member_name')
    .single();
  const row = data as RawCrew | null;
  return {
    data: row ? { id: row.id, member_id: row.member_id, member_name: row.member_name } : null,
    error,
  };
}

// Remove a crew member from a segment (by the person, since (segment_id, member_id) is unique).
export async function unassignCrew(supabase: SupabaseClient, segmentId: string, memberId: string) {
  return supabase.from('ops_segment_crew').delete().eq('segment_id', segmentId).eq('member_id', memberId);
}
