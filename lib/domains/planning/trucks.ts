import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpsTruck } from './types';

// Truck (fleet) administration for the planning board. The board itself reads active trucks via the
// segments route (listTrucks in schedule.ts); this module is the manage surface (list-all incl
// inactive, create/update/delete), gated by planning.truck.manage. Pure validateTruck is unit-tested.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Pure validation for a truck. A name is required; a colour, when given, must be a 6-digit hex.
export function validateTruck(name: string, color: string | null): 'name_required' | 'name_too_long' | 'bad_color' | null {
  const n = name.trim();
  if (!n) return 'name_required';
  if (n.length > 60) return 'name_too_long';
  if (color && !HEX_RE.test(color)) return 'bad_color';
  return null;
}

// All trucks (including inactive) for the manage panel.
export async function listAllTrucks(supabase: SupabaseClient) {
  return supabase.from('ops_trucks').select('id, name, color, active').order('name', { ascending: true });
}

export async function createTruck(
  supabase: SupabaseClient,
  input: { name: string; color: string | null },
): Promise<{ data: OpsTruck | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_trucks')
    .insert({ name: input.name.trim(), color: input.color })
    .select('id, name, color, active')
    .single();
  return { data: (data as OpsTruck) ?? null, error };
}

export type UpdateTruckInput = {
  name?: string;
  color?: string | null;
  active?: boolean;
};

export async function updateTruck(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateTruckInput,
): Promise<{ data: OpsTruck | null; error: { message: string } | null }> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.active !== undefined) update.active = patch.active;

  const { data, error } = await supabase
    .from('ops_trucks')
    .update(update)
    .eq('id', id)
    .select('id, name, color, active')
    .single();
  return { data: (data as OpsTruck) ?? null, error };
}

// Delete a truck. ops_segments.truck_id is ON DELETE RESTRICT, so a truck still referenced by a
// placement can't be removed — the route turns that FK violation into a friendly "deactivate
// instead" message.
export async function deleteTruck(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_trucks').delete().eq('id', id);
}
