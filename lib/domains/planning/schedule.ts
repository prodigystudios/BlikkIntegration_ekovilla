import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWorkOrderJob, type WorkOrderJobRow } from './display';
import type { OpsSegment } from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pure validation for a placement/move. Returns an error code or null when valid. ISO dates sort
// lexicographically, so a string compare is a correct range check.
export function validateSegmentDates(startDay: string, endDay: string): 'invalid_date' | 'end_before_start' | null {
  if (!ISO_DATE_RE.test(startDay) || !ISO_DATE_RE.test(endDay)) return 'invalid_date';
  if (endDay < startDay) return 'end_before_start';
  return null;
}

const SEGMENT_SELECT =
  'id, work_order_id, truck_id, start_day, end_day, sort_index, created_by, created_at, updated_at, ' +
  'work_order:crm_work_orders(order_number, fortnox_order_number, project_name, client_name, status, customer_snapshot, work_address, line_items)';

type RawSegment = {
  id: string;
  work_order_id: string;
  truck_id: string;
  start_day: string;
  end_day: string;
  sort_index: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  work_order: WorkOrderJobRow | WorkOrderJobRow[] | null;
};

// Map a raw ops_segments row (with the embedded work order) to the OpsSegment the UI renders.
// Supabase returns a to-one embed as an object, but the generated typing can be an array —
// normalise either way.
export function mapSegment(row: RawSegment): OpsSegment {
  const wo = Array.isArray(row.work_order) ? row.work_order[0] : row.work_order;
  return {
    id: row.id,
    work_order_id: row.work_order_id,
    truck_id: row.truck_id,
    start_day: row.start_day,
    end_day: row.end_day,
    sort_index: row.sort_index,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    job: wo ? mapWorkOrderJob(wo) : null,
  };
}

// Segments overlapping the [from, to] window: anything that starts on/before `to` and ends
// on/after `from`. RLS (planning.schedule.read) applies.
export async function listSegments(
  supabase: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ data: OpsSegment[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_segments')
    .select(SEGMENT_SELECT)
    .lte('start_day', range.to)
    .gte('end_day', range.from)
    .order('start_day', { ascending: true })
    .order('sort_index', { ascending: true });

  if (error) return { data: [], error };
  return { data: ((data ?? []) as unknown as RawSegment[]).map(mapSegment), error: null };
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
export async function placeSegment(
  supabase: SupabaseClient,
  input: PlaceSegmentInput,
): Promise<{ data: OpsSegment | null; error: { message: string } | null }> {
  const { data, error } = await supabase
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

  return { data: data ? mapSegment(data as unknown as RawSegment) : null, error };
}

export type MoveSegmentInput = {
  truckId?: string;
  startDay?: string;
  endDay?: string;
  sortIndex?: number;
};

// Patch a placement (drag to another truck/day, reorder). Only sent fields are written.
export async function moveSegment(
  supabase: SupabaseClient,
  id: string,
  patch: MoveSegmentInput,
): Promise<{ data: OpsSegment | null; error: { message: string } | null }> {
  const update: Record<string, unknown> = {};
  if (patch.truckId !== undefined) update.truck_id = patch.truckId;
  if (patch.startDay !== undefined) update.start_day = patch.startDay;
  if (patch.endDay !== undefined) update.end_day = patch.endDay;
  if (patch.sortIndex !== undefined) update.sort_index = patch.sortIndex;

  const { data, error } = await supabase.from('ops_segments').update(update).eq('id', id).select(SEGMENT_SELECT).single();
  return { data: data ? mapSegment(data as unknown as RawSegment) : null, error };
}

// Unschedule a placement (e.g. dragged back to the backlog).
export async function removeSegment(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_segments').delete().eq('id', id);
}
