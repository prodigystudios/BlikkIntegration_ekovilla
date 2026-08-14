import type { SupabaseClient } from '@supabase/supabase-js';
import { materialShortFromLineItems, totalSacks } from '@/lib/domains/crm/materials';
import { SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';

// Depot stock (slice 12b): per-material balance per depot = sum(deliveries) − consumption, where
// consumption is derived from ops_segment_reports (a job's blown sacks → its segment's truck → that
// truck's depot, attributed to the work order's material). Pure computeDepotBalances is unit-tested;
// the DB functions are thin RLS-scoped reads/writes.

export type StockRow = { depot_id: string; material: string; sacks: number };

export type DepotMaterialBalance = {
  material: string;
  delivered: number;
  consumed: number;
  balance: number;
  // Planned sacks still booked to be blown (open scheduled jobs drawing from this depot+material).
  planned: number;
  // How many sacks the booked work needs beyond what's in stock (planned − balance, floored at 0).
  shortfall: number;
};

export type DepotBalance = {
  depot_id: string;
  depot_name: string;
  rows: DepotMaterialBalance[];
  total_balance: number;
};

// Pure: combine delivered + consumed rows into a per-depot, per-material balance. A material appears
// for a depot if it has any delivery or any consumption there. Depots are returned in input order;
// material rows are sorted alphabetically.
export function computeDepotBalances(
  depots: { id: string; name: string }[],
  delivered: StockRow[],
  consumed: StockRow[],
  planned: StockRow[] = [],
): DepotBalance[] {
  // depot_id -> material -> { delivered, consumed, planned }
  const acc = new Map<string, Map<string, { delivered: number; consumed: number; planned: number }>>();
  const ensure = (depotId: string, material: string) => {
    let byMat = acc.get(depotId);
    if (!byMat) {
      byMat = new Map();
      acc.set(depotId, byMat);
    }
    let cell = byMat.get(material);
    if (!cell) {
      cell = { delivered: 0, consumed: 0, planned: 0 };
      byMat.set(material, cell);
    }
    return cell;
  };
  for (const r of delivered) ensure(r.depot_id, r.material).delivered += r.sacks;
  for (const r of consumed) ensure(r.depot_id, r.material).consumed += r.sacks;
  for (const r of planned) ensure(r.depot_id, r.material).planned += r.sacks;

  return depots.map((d) => {
    const byMat = acc.get(d.id);
    const rows: DepotMaterialBalance[] = byMat
      ? [...byMat.entries()]
          .map(([material, cell]) => {
            const balance = cell.delivered - cell.consumed;
            return {
              material,
              delivered: cell.delivered,
              consumed: cell.consumed,
              balance,
              planned: cell.planned,
              shortfall: Math.max(0, cell.planned - balance),
            };
          })
          .sort((a, b) => a.material.localeCompare(b.material, 'sv'))
      : [];
    return {
      depot_id: d.id,
      depot_name: d.name,
      rows,
      total_balance: rows.reduce((sum, r) => sum + r.balance, 0),
    };
  });
}

// Raw delivery stock rows (one per delivery; computeDepotBalances aggregates).
async function listDeliveryRows(supabase: SupabaseClient): Promise<StockRow[]> {
  const { data } = await supabase.from('ops_depot_deliveries').select('depot_id, material, sacks');
  return ((data ?? []) as Array<{ depot_id: string; material: string; sacks: number | string }>).map((r) => ({
    depot_id: r.depot_id,
    material: r.material,
    sacks: Number(r.sacks),
  }));
}

// Consumption stock rows derived from sack reports: blown sacks → segment's truck → truck's depot,
// attributed to the work order's material. Empty until the installer reporting flow populates
// ops_segment_reports.
//
// ⚠️ KNOWN LIMITATIONS — revisit when wiring the installer sack-reporting flow (currently dormant
// because there are no reports yet):
//   1. materialShortFromLineItems returns only the FIRST recognised material, so a work order with
//      two materials debits all its blown sacks from that one material. A faithful split needs the
//      report (or line items) to carry sacks-per-material, which the reporting model must define.
//   2. A segment whose truck has depot_id = null is silently skipped (`if (depotId && material)`),
//      so those blown sacks are never subtracted from any depot. Decide where un-depoted consumption
//      lands (a default depot? surfaced as a warning?) once trucks-without-depots is a real case.
async function deriveConsumptionRows(supabase: SupabaseClient): Promise<StockRow[]> {
  const { data: trucks } = await supabase.from('ops_trucks').select('id, depot_id');
  const truckDepot = new Map((trucks ?? []).map((t: any) => [t.id as string, (t.depot_id as string | null) ?? null]));

  const { data: reports } = await supabase
    .from('ops_segment_reports')
    .select('sacks_blown, segment:ops_segments(truck_id), work_order:crm_work_orders(line_items)');

  const rows: StockRow[] = [];
  for (const r of (reports ?? []) as Array<Record<string, any>>) {
    const seg = Array.isArray(r.segment) ? r.segment[0] : r.segment;
    const wo = Array.isArray(r.work_order) ? r.work_order[0] : r.work_order;
    const depotId = seg ? truckDepot.get(seg.truck_id) : null;
    const material = materialShortFromLineItems(wo?.line_items);
    if (depotId && material) rows.push({ depot_id: depotId, material, sacks: Number(r.sacks_blown) });
  }
  return rows;
}

// One scheduled segment, already resolved down to the fields the attribution needs.
export type PlannedDemandSegment = {
  work_order_id: string | null;
  depot_id: string | null;
  status: string | null;
  material: string | null;
  sacks: number;
};

/**
 * Pure: one planned-demand row per open work order, attributed to the first segment (in the given
 * order) that resolves to BOTH a depot and a material.
 *
 * ⚠️ A work order counts as seen only once it has actually been counted. Marking it seen before the
 * validity check — which is what this did — meant a job whose first segment sat on a truck with no
 * depot was dropped entirely, and the dedup then skipped its remaining segments too. The demand
 * silently vanished and the shortfall banner stayed quiet. Splitting a job across two trucks is a
 * normal move on the board ("Kopiera till bil"), so this was reachable.
 */
export function attributePlannedDemand(segments: PlannedDemandSegment[]): StockRow[] {
  const open = new Set(SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);
  const seen = new Set<string>();
  const rows: StockRow[] = [];
  for (const s of segments) {
    if (!s.work_order_id || !s.status || !open.has(s.status) || seen.has(s.work_order_id)) continue;
    if (!s.depot_id || !s.material || !(s.sacks > 0)) continue;
    seen.add(s.work_order_id);
    rows.push({ depot_id: s.depot_id, material: s.material, sacks: s.sacks });
  }
  return rows;
}

// Planned demand rows: for each OPEN scheduled job (work order still draft/scheduled/in_progress),
// the sacks it's booked to blow → its segment's truck → that truck's depot, attributed to the work
// order's material. Deduped by work order so a multi-segment job counts once. This is what the booked
// schedule needs from the depot, regardless of the visible week. (While installer reporting is
// dormant, consumed≈0, so balance is the physical stock and planned is the full booked demand —
// refine to "remaining" once reports land.)
async function derivePlannedDemandRows(supabase: SupabaseClient): Promise<StockRow[]> {
  const { data: trucks } = await supabase.from('ops_trucks').select('id, depot_id');
  const truckDepot = new Map((trucks ?? []).map((t: any) => [t.id as string, (t.depot_id as string | null) ?? null]));

  // Open work orders first, then only THEIR segments — the same two-step listSchedulableWorkOrders
  // and getPlanningInsights use. Reading every ops_segments row ever created and filtering in JS
  // grew with the table and put the result within reach of PostgREST's row cap, which would have
  // quietly hollowed out the demand figure (and the shortfall warning) with no error anywhere.
  const { data: openWos } = await supabase
    .from('crm_work_orders')
    .select('id, status, line_items')
    .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);

  // Parsed once per work order, not once per segment: line_items is the expensive part and a job's
  // material/sack count is the same on every segment it spans.
  const woById = new Map(
    (openWos ?? []).map((w: any) => [
      w.id as string,
      { status: (w.status as string | null) ?? null, material: materialShortFromLineItems(w.line_items), sacks: totalSacks(w.line_items) },
    ]),
  );
  if (woById.size === 0) return [];

  // Ordered so the attribution is deterministic: a job split across trucks is booked against its
  // EARLIEST segment's depot, not whichever row came back first. Cheap now that the set is bounded.
  const { data: segs } = await supabase
    .from('ops_segments')
    .select('id, work_order_id, truck_id, start_day')
    .in('work_order_id', [...woById.keys()])
    .order('start_day', { ascending: true })
    .order('id', { ascending: true });

  const candidates: PlannedDemandSegment[] = ((segs ?? []) as Array<Record<string, any>>).flatMap((s) => {
    const wo = woById.get(s.work_order_id as string);
    if (!wo) return [];
    return [{
      work_order_id: (s.work_order_id as string | null) ?? null,
      depot_id: truckDepot.get(s.truck_id) ?? null,
      status: wo.status,
      material: wo.material,
      sacks: wo.sacks,
    }];
  });
  return attributePlannedDemand(candidates);
}

// Per-depot, per-material balances + planned demand for the stock view. RLS (planning.schedule.read).
export async function getDepotStock(supabase: SupabaseClient): Promise<{ data: DepotBalance[]; error: { message: string } | null }> {
  const { data: depots, error } = await supabase.from('ops_depots').select('id, name').order('name', { ascending: true });
  if (error) return { data: [], error };

  const [delivered, consumed, planned] = await Promise.all([
    listDeliveryRows(supabase),
    deriveConsumptionRows(supabase),
    derivePlannedDemandRows(supabase),
  ]);
  return {
    data: computeDepotBalances((depots ?? []) as { id: string; name: string }[], delivered, consumed, planned),
    error: null,
  };
}

export type CreateDeliveryInput = {
  depotId: string;
  material: string;
  sacks: number;
  deliveredOn: string;
  note: string | null;
  actorUserId: string;
};

// created_by must equal the caller (RLS insert policy checks created_by = auth.uid()).
export async function createDelivery(supabase: SupabaseClient, input: CreateDeliveryInput) {
  return supabase
    .from('ops_depot_deliveries')
    .insert({
      depot_id: input.depotId,
      material: input.material,
      sacks: input.sacks,
      delivered_on: input.deliveredOn,
      note: input.note,
      created_by: input.actorUserId,
    })
    .select('id, depot_id, material, sacks, delivered_on, note')
    .single();
}
