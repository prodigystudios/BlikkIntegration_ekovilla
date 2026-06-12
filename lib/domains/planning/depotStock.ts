import type { SupabaseClient } from '@supabase/supabase-js';
import { materialShortFromLineItems } from '@/lib/domains/crm/materials';

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
): DepotBalance[] {
  // depot_id -> material -> { delivered, consumed }
  const acc = new Map<string, Map<string, { delivered: number; consumed: number }>>();
  const ensure = (depotId: string, material: string) => {
    let byMat = acc.get(depotId);
    if (!byMat) {
      byMat = new Map();
      acc.set(depotId, byMat);
    }
    let cell = byMat.get(material);
    if (!cell) {
      cell = { delivered: 0, consumed: 0 };
      byMat.set(material, cell);
    }
    return cell;
  };
  for (const r of delivered) ensure(r.depot_id, r.material).delivered += r.sacks;
  for (const r of consumed) ensure(r.depot_id, r.material).consumed += r.sacks;

  return depots.map((d) => {
    const byMat = acc.get(d.id);
    const rows: DepotMaterialBalance[] = byMat
      ? [...byMat.entries()]
          .map(([material, cell]) => ({
            material,
            delivered: cell.delivered,
            consumed: cell.consumed,
            balance: cell.delivered - cell.consumed,
          }))
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

// Per-depot, per-material balances for the stock view. RLS (planning.schedule.read) applies.
export async function getDepotStock(supabase: SupabaseClient): Promise<{ data: DepotBalance[]; error: { message: string } | null }> {
  const { data: depots, error } = await supabase.from('ops_depots').select('id, name').order('name', { ascending: true });
  if (error) return { data: [], error };

  const [delivered, consumed] = await Promise.all([listDeliveryRows(supabase), deriveConsumptionRows(supabase)]);
  return {
    data: computeDepotBalances((depots ?? []) as { id: string; name: string }[], delivered, consumed),
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
