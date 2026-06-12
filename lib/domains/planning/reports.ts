import type { SupabaseClient } from '@supabase/supabase-js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pure validation for a sack report.
export function validateReport(reportDay: string, sacksBlown: number): 'invalid_date' | 'invalid_amount' | null {
  if (!ISO_DATE_RE.test(reportDay)) return 'invalid_date';
  if (!Number.isFinite(sacksBlown) || sacksBlown < 0) return 'invalid_amount';
  return null;
}

// Sacks remaining for a job: planned (from line items) minus blown, floored at 0.
export function sacksRemaining(planned: number, blown: number): number {
  return Math.max(0, planned - blown);
}

// Sacks blown beyond plan (overrun), floored at 0. Drives the "över N" warning when installers
// report more sacks than the quote planned.
export function sacksOverrun(planned: number, blown: number): number {
  return Math.max(0, blown - planned);
}

export type CreateReportInput = {
  segmentId: string;
  reportDay: string;
  sacksBlown: number;
  note?: string | null;
  actorUserId: string;
};

// work_order_id is derived server-side from the segment — never trusted from the client.
export async function createSegmentReport(supabase: SupabaseClient, input: CreateReportInput) {
  const { data: seg, error: segErr } = await supabase
    .from('ops_segments')
    .select('work_order_id')
    .eq('id', input.segmentId)
    .single();
  if (segErr || !seg) return { data: null, error: segErr ?? { message: 'Segmentet kunde inte hittas' } };

  return supabase
    .from('ops_segment_reports')
    .insert({
      segment_id: input.segmentId,
      work_order_id: (seg as { work_order_id: string }).work_order_id,
      report_day: input.reportDay,
      sacks_blown: input.sacksBlown,
      note: input.note ?? null,
      created_by: input.actorUserId,
    })
    .select('id, segment_id, work_order_id, report_day, sacks_blown, note, created_at')
    .single();
}

// Sum of blown sacks per work order, across all its segments' reports.
export async function reportedSacksByWorkOrder(
  supabase: SupabaseClient,
  workOrderIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (workOrderIds.length === 0) return map;
  const { data } = await supabase
    .from('ops_segment_reports')
    .select('work_order_id, sacks_blown')
    .in('work_order_id', workOrderIds);
  for (const r of (data ?? []) as Array<{ work_order_id: string; sacks_blown: number | string }>) {
    map.set(r.work_order_id, (map.get(r.work_order_id) ?? 0) + Number(r.sacks_blown));
  }
  return map;
}
