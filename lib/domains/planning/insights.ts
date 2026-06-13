import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWorkOrderJob, type WorkOrderJobRow } from './display';
import { SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';

// Forward-looking planning insights: scheduled revenue + sacks per week, per truck, per material,
// and the value of work still waiting to be planned (unplanned backlog). Pure aggregation here is
// unit-tested; the DB read is a thin RLS-scoped query. All figures are deduped by work order so a
// multi-segment job counts once (attributed to its earliest scheduled week + that segment's truck).

export type WeekPoint = { weekStart: string; label: string; revenue: number; sacks: number };
export type TruckPoint = { truck_id: string; truck_name: string; revenue: number; sacks: number };
export type MaterialPoint = { material: string; sacks: number };
export type PlanningInsights = {
  weeks: WeekPoint[];
  byTruck: TruckPoint[];
  byMaterial: MaterialPoint[];
  backlog: { revenue: number; sacks: number; count: number };
};

const OPEN = new Set(SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);

// Pure: Monday (UTC, date-only/DST-safe) of the week containing an ISO date.
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Pure: ISO week number for an ISO date (for the chart label "v.NN").
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86_400_000));
}

export type InsightJob = {
  weekStart: string;
  truck_id: string;
  truck_name: string;
  revenue: number;
  sacks: number;
  material: string | null;
};

// Pure: bucket unique scheduled jobs into weekly / per-truck / per-material aggregates. weekStarts
// fixes the week axis (so empty weeks still render); jobs outside it are ignored for the week series
// but still count for truck/material totals.
export function aggregateInsights(weekStarts: string[], jobs: InsightJob[]): Omit<PlanningInsights, 'backlog'> {
  const weekMap = new Map<string, WeekPoint>(weekStarts.map((w) => [w, { weekStart: w, label: `v.${isoWeek(w)}`, revenue: 0, sacks: 0 }]));
  const truckMap = new Map<string, TruckPoint>();
  const matMap = new Map<string, number>();
  for (const j of jobs) {
    const wk = weekMap.get(j.weekStart);
    if (wk) {
      wk.revenue += j.revenue;
      wk.sacks += j.sacks;
    }
    let t = truckMap.get(j.truck_id);
    if (!t) {
      t = { truck_id: j.truck_id, truck_name: j.truck_name, revenue: 0, sacks: 0 };
      truckMap.set(j.truck_id, t);
    }
    t.revenue += j.revenue;
    t.sacks += j.sacks;
    if (j.material) matMap.set(j.material, (matMap.get(j.material) ?? 0) + j.sacks);
  }
  return {
    weeks: weekStarts.map((w) => weekMap.get(w) as WeekPoint),
    byTruck: [...truckMap.values()].sort((a, b) => b.revenue - a.revenue),
    byMaterial: [...matMap.entries()].map(([material, sacks]) => ({ material, sacks })).sort((a, b) => b.sacks - a.sacks),
  };
}

const JOB_FIELDS =
  'order_number, fortnox_order_number, project_name, client_name, status, customer_snapshot, work_address, line_items';

// Value (revenue + sacks) of schedulable work orders that have NO segments yet — the work still
// waiting to be planned.
async function computeBacklogValue(supabase: SupabaseClient): Promise<{ revenue: number; sacks: number; count: number }> {
  const { data: orders } = await supabase
    .from('crm_work_orders')
    .select(`id, ${JOB_FIELDS}`)
    .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);
  const rows = (orders ?? []) as Array<WorkOrderJobRow & { id: string }>;
  if (rows.length === 0) return { revenue: 0, sacks: 0, count: 0 };

  const { data: segs } = await supabase.from('ops_segments').select('work_order_id').in('work_order_id', rows.map((r) => r.id));
  const scheduled = new Set((segs ?? []).map((s: any) => s.work_order_id as string));

  let revenue = 0;
  let sacks = 0;
  let count = 0;
  for (const o of rows) {
    if (scheduled.has(o.id)) continue;
    const job = mapWorkOrderJob(o);
    revenue += job.revenue;
    sacks += job.total_sacks;
    count++;
  }
  return { revenue, sacks, count };
}

// Forward window of `weeks` starting from the Monday of `fromISO`. RLS (planning.schedule.read).
export async function getPlanningInsights(
  supabase: SupabaseClient,
  opts: { fromISO: string; weeks: number },
): Promise<{ data: PlanningInsights; error: { message: string } | null }> {
  const from = mondayOf(opts.fromISO);
  const weekStarts = Array.from({ length: opts.weeks }, (_, i) => addDaysISO(from, i * 7));
  const to = addDaysISO(from, opts.weeks * 7 - 1);

  const { data: segs, error } = await supabase
    .from('ops_segments')
    .select(`work_order_id, start_day, truck_id, truck:ops_trucks(name), work_order:crm_work_orders(${JOB_FIELDS})`)
    .lte('start_day', to)
    .gte('end_day', from)
    .order('start_day', { ascending: true });

  const empty: PlanningInsights = { weeks: [], byTruck: [], byMaterial: [], backlog: { revenue: 0, sacks: 0, count: 0 } };
  if (error) return { data: empty, error };

  const seen = new Set<string>();
  const jobs: InsightJob[] = [];
  for (const s of (segs ?? []) as Array<Record<string, any>>) {
    const wo = Array.isArray(s.work_order) ? s.work_order[0] : s.work_order;
    if (!wo || !OPEN.has(wo.status) || !s.work_order_id || seen.has(s.work_order_id)) continue;
    seen.add(s.work_order_id);
    const job = mapWorkOrderJob(wo as WorkOrderJobRow);
    const truck = Array.isArray(s.truck) ? s.truck[0] : s.truck;
    jobs.push({
      weekStart: mondayOf(s.start_day),
      truck_id: s.truck_id,
      truck_name: truck?.name ?? '—',
      revenue: job.revenue,
      sacks: job.total_sacks,
      material: job.material,
    });
  }

  const backlog = await computeBacklogValue(supabase);
  return { data: { ...aggregateInsights(weekStarts, jobs), backlog }, error: null };
}
