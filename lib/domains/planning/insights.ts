import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWorkOrderJob, scopeForSegment, type WorkOrderJobRow } from './display';
import { expandWorkOrderToBacklogItems, SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';
import { mondayOfISO } from './timezone';
import { listScopeSpans } from './schedule';
import { scopeKey, segmentWeekValues, type ScopeValue } from './weekValue';

// Forward-looking planning insights: scheduled revenue + sacks per week, per truck, per material,
// and the value of work still waiting to be planned (unplanned backlog). Pure aggregation here is
// unit-tested; the DB read is a thin RLS-scoped query.
//
// Ett jobbs värde FÖRDELAS över de dagar det faktiskt utförs (weekValue.ts) — en vecka svarar på
// "vad ska utföras och omsättas den här veckan". Tidigare deduppades varje jobb till sitt TIDIGASTE
// segment, så ett femveckorsjobb lade hela ordervärdet på startveckan medan tavlan lade hela värdet
// på var och en av de fem. Samma modul räknar nu båda vyerna, så de kan inte svara olika.

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
//
// Delegerar till domänens veckoankare. Tavlan och insikterna summerar samma dagsandelar till samma
// veckor (weekValue.ts), och två implementationer av "vilken vecka hör den här dagen till" är
// exakt det som gör att de två vyerna kan svara olika. Kastar på oläsbart datum, precis som den
// tidigare Date-baserade varianten gjorde via toISOString.
export function mondayOf(iso: string): string {
  const monday = mondayOfISO(iso);
  if (monday === null) throw new RangeError(`mondayOf: ogiltigt datum ${JSON.stringify(iso)}`);
  return monday;
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
  'order_number, fortnox_order_number, project_name, client_name, status, customer_snapshot, work_address, line_items, ' +
  'crm_work_order_stages(id, stage_number, title, line_quantities)';

// Value (revenue + sacks) of schedulable work orders that have NO segments yet — the work still
// waiting to be planned.
async function computeBacklogValue(supabase: SupabaseClient): Promise<{ revenue: number; sacks: number; count: number }> {
  const { data: orders } = await supabase
    .from('crm_work_orders')
    .select(`id, desired_installation_date, assigned_to, ${JOB_FIELDS}`)
    .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);
  const rows = (orders ?? []) as unknown as Parameters<typeof expandWorkOrderToBacklogItems>[0][];
  if (rows.length === 0) return { revenue: 0, sacks: 0, count: 0 };

  // ⚠️ PER SCOPE, inte per order. En order med etapp 1 utplacerad och etapp 2 oplanerad bidrog
  // tidigare 0 till "Oplanerat värde" — snedtaket såg ut att vara inplanerat bara för att väggen
  // var det. Samma expansion som backloggens lista använder, så de två kan inte säga olika.
  const { data: segs } = await supabase
    .from('ops_segments')
    .select('work_order_id, stage_id')
    .in('work_order_id', rows.map((r) => r.id));
  const scheduled = new Set(
    (segs ?? []).map((s: any) => scopeKey(s.work_order_id as string, (s.stage_id as string | null) ?? null)),
  );

  let revenue = 0;
  let sacks = 0;
  let count = 0;
  for (const row of rows) {
    for (const item of expandWorkOrderToBacklogItems(row, () => 0)) {
      if (scheduled.has(item.key)) continue;
      revenue += item.revenue;
      sacks += item.total_sacks;
      count++;
    }
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
    .select(`work_order_id, stage_id, start_day, truck_id, truck:ops_trucks(name), work_order:crm_work_orders(${JOB_FIELDS})`)
    .lte('start_day', to)
    .gte('end_day', from)
    .order('start_day', { ascending: true });

  const empty: PlanningInsights = { weeks: [], byTruck: [], byMaterial: [], backlog: { revenue: 0, sacks: 0, count: 0 } };
  if (error) return { data: empty, error };

  // Ett scopes värde och etikett, plus bilnamnen. Dedupen är på SCOPE, inte på placering: samma jobb
  // kan ligga på flera segment och ska bara bidra med sitt värde en gång — fördelningen avgör sedan
  // hur det värdet landar över veckor och bilar.
  const values = new Map<string, ScopeValue>();
  const labels = new Map<string, { material: string | null }>();
  const truckNames = new Map<string, string>();
  const workOrderIds = new Set<string>();
  for (const s of (segs ?? []) as Array<Record<string, any>>) {
    const wo = Array.isArray(s.work_order) ? s.work_order[0] : s.work_order;
    if (!wo || !OPEN.has(wo.status) || !s.work_order_id) continue;
    const truck = Array.isArray(s.truck) ? s.truck[0] : s.truck;
    if (truck?.name) truckNames.set(s.truck_id, truck.name);
    workOrderIds.add(s.work_order_id);

    // Per ETAPP, inte per order: två etapper på samma order är två olika saker som ska utföras,
    // och deras värden hör till var sin vecka.
    const stageId = (s.stage_id as string | null) ?? null;
    const key = scopeKey(s.work_order_id, stageId);
    if (values.has(key)) continue;
    const job = mapWorkOrderJob(wo as WorkOrderJobRow, scopeForSegment(stageId, wo.crm_work_order_stages));
    values.set(key, { key, revenue: job.revenue, sacks: job.total_sacks });
    labels.set(key, { material: job.material });
  }

  // 🧨 NÄMNAREN HÄMTAS SEPARAT. Frågan ovan ger bara segment som överlappar fönstret; fördelas
  // värdet över dem får ett jobb som sträcker sig utanför fönstret för hög andel i den synliga
  // veckan — samma uppblåsning som fördelningen finns för att döda. Se listScopeSpans.
  const spans = await listScopeSpans(supabase, [...workOrderIds]);
  if (spans.error) return { data: empty, error: spans.error };

  // ⚠️ SKIVORNA KLIPPS TILL FÖNSTRET. Nämnaren är jobbets HELA spann, så ett femveckorsjobb ger
  // skivor även för veckor utanför [from, to]. aggregateInsights hoppar över dem i veckoserien men
  // räknar dem i bil- och materialtotalerna — utan klippningen hade "Omsättning per bil" dragit in
  // arbete från veckor som inte ens visas.
  //
  // Följd, och den är en förbättring: byTruck summerar nu till samma tal som veckoserien. Förut
  // gjorde den medvetet inte det (se kommentaren vid aggregateInsights), eftersom dedupen mot
  // första segmentet kunde peka ut en vecka före fönstret.
  const inWindow = new Set(weekStarts);
  const jobs: InsightJob[] = segmentWeekValues([...values.values()], spans.data)
    .filter((slice) => inWindow.has(slice.weekStart))
    .map((slice) => ({
      weekStart: slice.weekStart,
      truck_id: slice.truck_id,
      truck_name: truckNames.get(slice.truck_id) ?? '—',
      revenue: slice.revenue,
      sacks: slice.sacks,
      material: labels.get(slice.key)?.material ?? null,
    }));

  const backlog = await computeBacklogValue(supabase);
  return { data: { ...aggregateInsights(weekStarts, jobs), backlog }, error: null };
}
