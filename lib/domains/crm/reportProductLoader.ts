import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkIds } from '@/lib/domains/planning/pagedRead';
import { readEveryRow } from './reports';
import type { ProductDepotRow, ProductSegmentRow } from './reportProduct';

// Läsningarna bakom Produkt & marknad: orderraderna (sålda m³) och orderns segment på schemat med
// bilens depå (fakturerat och orderstock per depå). Rutten kör dem med admin-klienten, samma skäl som
// resten av rapporten, och fångar var och en för sig — en trasig läsning blir null, aldrig nollor.
//
// ⚠️ KLUMPAR OM 100 ID:N (`.in()` ligger i URL:en, se IN_CHUNK), och varje klump läses ändå SIDINDELAT:
// en order kan ha många segment, och PostgREST kapar tyst vid 1000 rader. Radtyperna härleds ur
// select-strängarna (readEveryRow), så en select som tappar en obligatorisk kolumn fäller typkontrollen.

/** Klumpar som läses samtidigt. Tolv månaders order är ~18 klumpar — en i taget hade lagt dem på varandra. */
const PARALLEL = 4;

async function readInChunks<Row>(ids: string[], read: (chunk: string[]) => Promise<Row[]>): Promise<Row[]> {
  const chunks = chunkIds([...new Set(ids)]);
  const rows: Row[] = [];
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batches = await Promise.all(chunks.slice(i, i + PARALLEL).map(read));
    for (const batch of batches) rows.push(...batch);
  }
  return rows;
}

export type ProductLineItemsRow = { id: string; line_items: unknown };

/**
 * Orderraderna per order-id. Bara för de order som räknas (volumeOrderIds) — inte i rapportens breda
 * orderläsning, där tolv månaders rader hade varit en tung nyttolast för alla flikar.
 */
export async function fetchOrderLineItems(admin: SupabaseClient, ids: string[]): Promise<Map<string, unknown>> {
  const rows: ProductLineItemsRow[] = await readInChunks(ids, (chunk) =>
    readEveryRow('orderrader', (from, to) =>
      admin.from('crm_work_orders')
        .select('id, line_items')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to)),
  );
  return new Map(rows.map((row) => [row.id, row.line_items]));
}

/**
 * Orderns segment med bilens depå. Platshållare (utan work_order_id) kommer aldrig med — de matchar
 * inget id — och ignoreras dessutom i orderDepots.
 *
 * ⚠️ BILEN MED UTPEKAD NYCKEL. ops_segments har en nyckel mot ops_trucks i dag; utpekningen gör att en
 * andra nyckel i framtiden inte fäller hela rapporten med "more than one relationship".
 */
export async function fetchOrderSegments(admin: SupabaseClient, orderIds: string[]): Promise<ProductSegmentRow[]> {
  return readInChunks(orderIds, async (chunk) => {
    const rows: ProductSegmentRow[] = await readEveryRow('schemat', (from, to) =>
      admin.from('ops_segments')
        .select('id, work_order_id, start_day, end_day, truck:ops_trucks!ops_segments_truck_id_fkey(depot_id)')
        .in('work_order_id', chunk)
        .order('id', { ascending: true })
        .range(from, to));
    return rows;
  });
}

/** Alla depåer, även inaktiva — en nedlagd depå kan ha fakturerat i en historisk period. */
export function fetchDepots(admin: SupabaseClient): Promise<ProductDepotRow[]> {
  return readEveryRow('depåerna', (from, to) =>
    admin.from('ops_depots')
      .select('id, name, active')
      .order('id', { ascending: true })
      .range(from, to));
}
