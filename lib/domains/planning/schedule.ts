import type { SupabaseClient } from '@supabase/supabase-js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pure validation for a placement/move. Returns an error code or null when valid. ISO dates
// sort lexicographically, so a string compare is a correct range check.
export function validateSegmentDates(startDay: string, endDay: string): 'invalid_date' | 'end_before_start' | null {
  if (!ISO_DATE_RE.test(startDay) || !ISO_DATE_RE.test(endDay)) return 'invalid_date';
  if (endDay < startDay) return 'end_before_start';
  return null;
}

const SEGMENT_SELECT =
  'id, work_order_id, truck_id, start_day, end_day, sort_index, created_by, created_at, updated_at, ' +
  'work_order:crm_work_orders(order_number, project_name, client_name, status)';

// Segments overlapping the [from, to] window: anything that starts on/before `to` and ends
// on/after `from`. RLS (planning.schedule.read) applies.
export async function listSegments(supabase: SupabaseClient, range: { from: string; to: string }) {
  return supabase
    .from('ops_segments')
    .select(SEGMENT_SELECT)
    .lte('start_day', range.to)
    .gte('end_day', range.from)
    .order('start_day', { ascending: true })
    .order('sort_index', { ascending: true });
}

export async function listTrucks(supabase: SupabaseClient) {
  return supabase
    .from('ops_trucks')
    .select('id, name, color, active')
    .eq('active', true)
    .order('name', { ascending: true });
}

export type PlaceSegmentInput = {
  workOrderId: string;
  truckId: string;
  startDay: string;
  endDay: string;
  sortIndex?: number;
  actorUserId: string;
};

// created_by must equal the caller (RLS insert policy checks created_by = auth.uid()).
export async function placeSegment(supabase: SupabaseClient, input: PlaceSegmentInput) {
  return supabase
    .from('ops_segments')
    .insert({
      work_order_id: input.workOrderId,
      truck_id: input.truckId,
      start_day: input.startDay,
      end_day: input.endDay,
      sort_index: input.sortIndex ?? 0,
      created_by: input.actorUserId,
    })
    .select(SEGMENT_SELECT)
    .single();
}

export type MoveSegmentInput = {
  truckId?: string;
  startDay?: string;
  endDay?: string;
  sortIndex?: number;
};

// Patch a placement (drag to another truck/day, reorder). Only sent fields are written.
export async function moveSegment(supabase: SupabaseClient, id: string, patch: MoveSegmentInput) {
  const update: Record<string, unknown> = {};
  if (patch.truckId !== undefined) update.truck_id = patch.truckId;
  if (patch.startDay !== undefined) update.start_day = patch.startDay;
  if (patch.endDay !== undefined) update.end_day = patch.endDay;
  if (patch.sortIndex !== undefined) update.sort_index = patch.sortIndex;
  return supabase.from('ops_segments').update(update).eq('id', id).select(SEGMENT_SELECT).single();
}
