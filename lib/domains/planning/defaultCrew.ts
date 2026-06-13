import type { SupabaseClient } from '@supabase/supabase-js';

// Default crew per truck (standardbemanning): a truck's standing team — one leader + personal. The
// board shows it on every week's lane unless that week has explicit ops_truck_crew rows (an
// override). member_name is denormalised (profiles SELECT RLS is self-only), same as the other crew
// tables. Pure helpers here are unit-tested; the DB functions are thin RLS-scoped queries.

export type CrewRole = 'leader' | 'member';

export type DefaultCrewMember = {
  id: string;
  truck_id: string;
  member_id: string | null;
  member_name: string;
  role: CrewRole;
};

const SELECT = 'id, truck_id, member_id, member_name, role';

// All default-crew rows (every truck), for the board. RLS (planning.schedule.read) applies.
export async function listAllDefaultCrew(
  supabase: SupabaseClient,
): Promise<{ data: DefaultCrewMember[]; error: { message: string } | null }> {
  const { data, error } = await supabase.from('ops_truck_default_crew').select(SELECT).order('role', { ascending: true });
  return { data: (data ?? []) as DefaultCrewMember[], error };
}

// Pure: group rows by truck id, leader first. Used to render a truck's standing team.
export function defaultCrewByTruck(rows: DefaultCrewMember[]): Map<string, DefaultCrewMember[]> {
  const map = new Map<string, DefaultCrewMember[]>();
  for (const r of rows) {
    const list = map.get(r.truck_id) ?? [];
    list.push(r);
    map.set(r.truck_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.role === b.role ? 0 : a.role === 'leader' ? -1 : 1));
  return map;
}

export type DefaultCrewInput = { member_id: string | null; member_name: string; role: CrewRole };

// Pure: validate a replacement team. At most one leader; every member needs a non-empty name.
export function validateDefaultCrew(members: DefaultCrewInput[]): 'too_many_leaders' | 'empty_name' | null {
  if (members.filter((m) => m.role === 'leader').length > 1) return 'too_many_leaders';
  if (members.some((m) => !m.member_name.trim())) return 'empty_name';
  return null;
}

// Replace a truck's whole standing team in one go (delete existing rows, insert the new set). Not a
// transaction, but the window is tiny and the board tolerates a transient empty team.
export async function replaceDefaultCrew(
  supabase: SupabaseClient,
  truckId: string,
  members: DefaultCrewInput[],
  actorUserId: string,
): Promise<{ error: { message: string } | null }> {
  const del = await supabase.from('ops_truck_default_crew').delete().eq('truck_id', truckId);
  if (del.error) return { error: del.error };
  if (members.length === 0) return { error: null };
  const { error } = await supabase.from('ops_truck_default_crew').insert(
    members.map((m) => ({
      truck_id: truckId,
      member_id: m.member_id,
      member_name: m.member_name.trim(),
      role: m.role,
      created_by: actorUserId,
    })),
  );
  return { error };
}
