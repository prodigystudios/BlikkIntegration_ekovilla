import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpsDepot } from './types';

// Depot (depå) administration. A depot is a physical store of insulation sacks; each truck belongs
// to one (ops_trucks.depot_id). Reading is board-level (planning.schedule.read); managing is
// planning.depot.manage. Deliveries + per-material balances live in ./depotStock (slice 12b).

// Pure validation for a depot.
export function validateDepot(name: string): 'name_required' | 'name_too_long' | null {
  const n = name.trim();
  if (!n) return 'name_required';
  if (n.length > 80) return 'name_too_long';
  return null;
}

const DEPOT_SELECT = 'id, name, location, active';

// All depots (incl inactive) for the manage panel + truck depot pickers.
export async function listAllDepots(supabase: SupabaseClient) {
  return supabase.from('ops_depots').select(DEPOT_SELECT).order('name', { ascending: true });
}

export async function createDepot(
  supabase: SupabaseClient,
  input: { name: string; location: string | null },
): Promise<{ data: OpsDepot | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_depots')
    .insert({ name: input.name.trim(), location: input.location })
    .select(DEPOT_SELECT)
    .single();
  return { data: (data as OpsDepot) ?? null, error };
}

export type UpdateDepotInput = {
  name?: string;
  location?: string | null;
  active?: boolean;
};

export async function updateDepot(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateDepotInput,
): Promise<{ data: OpsDepot | null; error: { message: string } | null }> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.location !== undefined) update.location = patch.location;
  if (patch.active !== undefined) update.active = patch.active;

  const { data, error } = await supabase
    .from('ops_depots')
    .update(update)
    .eq('id', id)
    .select(DEPOT_SELECT)
    .single();
  return { data: (data as OpsDepot) ?? null, error };
}

// Delete a depot. Trucks referencing it are ON DELETE SET NULL, so they simply lose their depot.
export async function deleteDepot(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_depots').delete().eq('id', id);
}
