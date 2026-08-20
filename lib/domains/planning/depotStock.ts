import type { SupabaseClient } from '@supabase/supabase-js';
import { materialShortFromLineItems, totalSacks } from '@/lib/domains/crm/materials';
import { SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';
import { effectiveSackReports } from './sackLedger';

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

// Förbrukade säckar per depå och material: blåsta säckar → segmentets bil → bilens depå.
//
// ⚠️ SUPERSEDE MÅSTE KÖRAS HÄR OCKSÅ. Det här är det ANDRA av exakt två ställen som summerar
// sacks_blown (det första är reportedSacksByWorkOrder). Glöms regeln drar depån både delrapporterna
// och egenkontrollen och DUBBELDEBITERAR lagret — och till skillnad från snabböversiktens tal, som
// någon läser varje dag, upptäcks ett fel depåsaldo först när en bil står utan material.
//
// `work_order_id` och `kind` måste därför med i select:en; regeln nycklas per arbetsorder.
//
// ⚠️ KVARSTÅENDE BRIST: ett segment vars bil saknar depot_id hoppas tyst över (`if (depotId &&
// material)`), så de säckarna dras aldrig från någon depå. Var odepåad förbrukning ska landa (en
// standarddepå? en varning?) är ett eget beslut när bil-utan-depå blir ett verkligt fall.
//
// (Bristen där materialShortFromLineItems debiterade allt på orderns FÖRSTA igenkända material är
// löst för nya rader: rapporten bär sitt eget material. Rader utan materialkolumn — legacy, eller
// en etapprad vars artikelnamn inte gick att tyda — faller tillbaka på den gamla härledningen.)
async function deriveConsumptionRows(supabase: SupabaseClient): Promise<StockRow[]> {
  const { data: trucks } = await supabase.from('ops_trucks').select('id, depot_id');
  const truckDepot = new Map((trucks ?? []).map((t: any) => [t.id as string, (t.depot_id as string | null) ?? null]));

  const { data: reports } = await supabase
    .from('ops_segment_reports')
    .select('work_order_id, sacks_blown, kind, material, segment:ops_segments(truck_id), work_order:crm_work_orders(line_items)');

  const counted = effectiveSackReports((reports ?? []) as Array<Record<string, any> & { work_order_id: string }>);

  const rows: StockRow[] = [];
  for (const r of counted) {
    const seg = Array.isArray(r.segment) ? r.segment[0] : r.segment;
    const wo = Array.isArray(r.work_order) ? r.work_order[0] : r.work_order;
    const depotId = seg ? truckDepot.get(seg.truck_id) : null;
    const material = (typeof r.material === 'string' && r.material.trim()) || materialShortFromLineItems(wo?.line_items);
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
  // and getPlanningInsights use. This bounds the read to the working set instead of every
  // ops_segments row ever created, which grew with the table forever.
  //
  // ⚠️ It is NOT an absolute bound. Open orders (draft especially) still accumulate, and neither
  // this query nor its siblings paginate, so past PostgREST's max-rows the map silently loses
  // entries: those segments fall out of the flatMap below, `planned` under-counts, `shortfall`
  // floors to 0 and the depot banner stays quiet on a real shortage — with no error anywhere.
  // Same exposure as listSchedulableWorkOrders/computeBacklogValue; worth solving for all three at
  // once rather than paginating this one call site into a pattern the rest of the domain lacks.
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
