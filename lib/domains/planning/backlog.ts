import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWorkOrderJob, type WorkOrderJobRow } from './display';
import { hasUnallocatedWork, type StageScope, type WorkOrderStage } from '@/lib/domains/crm/workOrderStages';
import { scopeKey } from './weekValue';
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
  assigned_to: string | null;
  crm_work_order_stages?: WorkOrderStage[] | null;
};

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

// Pure mapper: a crm_work_orders row + one scope of it → backlog item.
export function mapWorkOrderToBacklogItem(
  row: WorkOrderRow,
  segmentCount: number,
  scope: StageScope = { kind: 'whole' },
  stageId: string | null = null,
): SchedulableWorkOrder {
  const snap = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  return {
    key: scopeKey(row.id, stageId),
    id: row.id,
    stage_id: stageId,
    ...mapWorkOrderJob(row, scope),
    desired_installation_date: row.desired_installation_date ?? null,
    contact_email: str(snap.email) || null,
    contact_phone: str(snap.phone) || null,
    assigned_to: row.assigned_to ?? null,
    segment_count: segmentCount,
  };
}

/**
 * En order → en post per etapp, plus resten.
 *
 * Utan etapper blir det EXAKT en post, identisk med före etappbegreppet — bakåtkompatibiliteten.
 *
 * ⚠️ RESTEN VISAS BARA NÄR DEN FINNS. Har etapperna tagit hela ordern är resten noll, och en post
 * som säger "0 säck, 0 kr" hade sett ut som ett jobb att planera. hasUnallocatedWork avgör det.
 *
 * ⚠️ EN TOM ETAPP VISAS ÄNDÅ. Skrivs den enda rad en etapp bestod av av (`written_off`) krymper den
 * till noll — men att då dölja den ser ut som dataförlust för den som skapade den. Den ligger kvar
 * och kan tas bort avsiktligt.
 */
export function expandWorkOrderToBacklogItems(
  row: WorkOrderRow,
  countForScope: (stageId: string | null) => number,
): SchedulableWorkOrder[] {
  const stages = (row.crm_work_order_stages ?? []) as WorkOrderStage[];
  if (stages.length === 0) {
    return [mapWorkOrderToBacklogItem(row, countForScope(null))];
  }

  const items = [...stages]
    .sort((a, b) => a.stage_number - b.stage_number)
    .map((stage) =>
      mapWorkOrderToBacklogItem(row, countForScope(stage.id), { kind: 'stage', stage, siblings: stages }, stage.id),
    );

  if (hasUnallocatedWork((row.line_items ?? []) as never, stages)) {
    items.push(mapWorkOrderToBacklogItem(row, countForScope(null), { kind: 'rest', stages }, null));
  }
  return items;
}

const WORK_ORDER_BACKLOG_SELECT =
  'id, order_number, fortnox_order_number, project_name, client_name, status, desired_installation_date, assigned_to, work_address, customer_snapshot, line_items, ' +
  'crm_work_order_stages(id, stage_number, title, line_quantities)';

// List CRM work orders eligible for scheduling, annotated with how many ops_segments already
// cover them. RLS applies to both reads (planner needs crm.workorder.read + planning.schedule.read).
//
// Newest order first (created_at desc). The planner's working rhythm is "an order just came in —
// where does it go", so the job they are about to place is the one they just heard about. The list
// was previously ordered by desired_installation_date, which buried a brand-new order among the
// dates and put every order without a wished date last. The wished date is still shown on the card
// ("Önskat"), it just doesn't decide the order any more.
//
// Not order_number: its format is AO-YYYYMMDD-XXXXXX where the tail is a random UUID slice, so
// orders created the same day would sort arbitrarily against each other.
export async function listSchedulableWorkOrders(
  supabase: SupabaseClient,
): Promise<{ data: SchedulableWorkOrder[]; error: { message: string } | null }> {
  const { data: orders, error } = await supabase
    .from('crm_work_orders')
    .select(WORK_ORDER_BACKLOG_SELECT)
    .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[])
    .order('created_at', { ascending: false });

  if (error) return { data: [], error };

  // `as unknown as` eftersom den nästlade stages-inbäddningen gör PostgREST-typningen till
  // GenericStringError[] — samma mönster som listSegments använder för sin embed.
  const rows = (orders ?? []) as unknown as WorkOrderRow[];
  if (rows.length === 0) return { data: [], error: null };

  const ids = rows.map((r) => r.id);
  // ⚠️ stage_id måste med: att etapp 1 är utplacerad säger ingenting om etapp 2, och utan den hade
  // hela ordern räknats som planerad så fort dess första etapp lagts ut.
  const { data: segs, error: segErr } = await supabase
    .from('ops_segments')
    .select('work_order_id, stage_id')
    .in('work_order_id', ids);

  if (segErr) return { data: [], error: segErr };

  const counts = new Map<string, number>();
  for (const s of (segs ?? []) as Array<{ work_order_id: string; stage_id: string | null }>) {
    const key = scopeKey(s.work_order_id, s.stage_id ?? null);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const items = rows.flatMap((r) =>
    expandWorkOrderToBacklogItems(r, (stageId) => counts.get(scopeKey(r.id, stageId)) ?? 0),
  );
  return { data: items, error: null };
}
