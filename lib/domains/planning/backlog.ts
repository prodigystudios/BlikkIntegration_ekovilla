import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWorkOrderJob, type WorkOrderJobRow } from './display';
import type { SchedulableWorkOrder } from './types';

// resolveJobAddress is the single source for the job-site address; re-exported under its old name
// so existing tests/imports keep working.
export { resolveJobAddress as resolveBacklogAddress } from './display';

// Work-order statuses that still want scheduling. 'completed', 'partially_invoiced', 'invoiced'
// and 'cancelled' are past the install and excluded.
export const SCHEDULABLE_WORK_ORDER_STATUSES = ['draft', 'scheduled', 'in_progress'] as const;

type WorkOrderRow = WorkOrderJobRow & {
  id: string;
  desired_installation_date: string | null;
};

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

// Pure mapper: a crm_work_orders row (+ how many segments already cover it) → backlog item.
export function mapWorkOrderToBacklogItem(row: WorkOrderRow, segmentCount: number): SchedulableWorkOrder {
  const snap = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    ...mapWorkOrderJob(row),
    desired_installation_date: row.desired_installation_date ?? null,
    contact_email: str(snap.email) || null,
    contact_phone: str(snap.phone) || null,
    segment_count: segmentCount,
  };
}

const WORK_ORDER_BACKLOG_SELECT =
  'id, order_number, fortnox_order_number, project_name, client_name, status, desired_installation_date, work_address, customer_snapshot, line_items';

// List CRM work orders eligible for scheduling, annotated with how many ops_segments already
// cover them. RLS applies to both reads (planner needs crm.workorder.read + planning.schedule.read).
export async function listSchedulableWorkOrders(
  supabase: SupabaseClient,
): Promise<{ data: SchedulableWorkOrder[]; error: { message: string } | null }> {
  const { data: orders, error } = await supabase
    .from('crm_work_orders')
    .select(WORK_ORDER_BACKLOG_SELECT)
    .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[])
    .order('desired_installation_date', { ascending: true, nullsFirst: false });

  if (error) return { data: [], error };

  const rows = (orders ?? []) as WorkOrderRow[];
  if (rows.length === 0) return { data: [], error: null };

  const ids = rows.map((r) => r.id);
  const { data: segs, error: segErr } = await supabase
    .from('ops_segments')
    .select('work_order_id')
    .in('work_order_id', ids);

  if (segErr) return { data: [], error: segErr };

  const counts = new Map<string, number>();
  for (const s of (segs ?? []) as Array<{ work_order_id: string }>) {
    counts.set(s.work_order_id, (counts.get(s.work_order_id) ?? 0) + 1);
  }

  return { data: rows.map((r) => mapWorkOrderToBacklogItem(r, counts.get(r.id) ?? 0)), error: null };
}
