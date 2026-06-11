import type { SupabaseClient } from '@supabase/supabase-js';
import { totalSacks } from '@/lib/domains/crm/materials';
import type { SchedulableWorkOrder } from './types';

// Work-order statuses that still want scheduling. 'ready' is retired; 'completed',
// 'partially_invoiced', 'invoiced' and 'cancelled' are past the install and excluded.
export const SCHEDULABLE_WORK_ORDER_STATUSES = ['draft', 'scheduled', 'in_progress'] as const;

// The crm_work_orders columns the backlog reads.
type WorkOrderRow = {
  id: string;
  order_number: string;
  project_name: string;
  client_name: string;
  status: string;
  desired_installation_date: string | null;
  work_address: Record<string, unknown> | null;
  customer_snapshot: Record<string, unknown> | null;
  line_items: unknown[] | null;
};

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function joinAddress(parts: unknown[]): string | null {
  const cleaned = parts.map(str).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : null;
}

// The job-site address: the separate work address when one is stored (it's only persisted when
// it differs from the customer address), else a separate delivery address on the snapshot, else
// the customer's card address. Mirrors how the order itself resolves the work address.
export function resolveBacklogAddress(
  workAddress: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null,
): string | null {
  const wa = workAddress ?? {};
  if (str(wa.street_address)) return joinAddress([wa.street_address, wa.postal_code, wa.city]);

  const snap = snapshot ?? {};
  if (str(snap.delivery_address)) {
    return joinAddress([snap.delivery_address, snap.delivery_postal_code, snap.delivery_city]);
  }
  return joinAddress([snap.street_address, snap.postal_code, snap.city]);
}

// Pure mapper: a crm_work_orders row (+ how many segments already cover it) → backlog item.
export function mapWorkOrderToBacklogItem(row: WorkOrderRow, segmentCount: number): SchedulableWorkOrder {
  const snap = row.customer_snapshot ?? {};
  return {
    id: row.id,
    order_number: row.order_number,
    project_name: row.project_name,
    client_name: row.client_name,
    status: row.status,
    desired_installation_date: row.desired_installation_date ?? null,
    address: resolveBacklogAddress(row.work_address, row.customer_snapshot),
    contact_email: str(snap.email) || null,
    contact_phone: str(snap.phone) || null,
    total_sacks: totalSacks(row.line_items as never),
    segment_count: segmentCount,
  };
}

const WORK_ORDER_BACKLOG_SELECT =
  'id, order_number, project_name, client_name, status, desired_installation_date, work_address, customer_snapshot, line_items';

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

  // Count existing placements per work order in one query, merged client-side.
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
