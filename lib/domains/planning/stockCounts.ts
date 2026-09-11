import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages, type ReadError } from './pagedRead';

// Avstämning av depålagret: "den här dagen stod det X säckar på depån".
//
// Saldot är levererat − förbrukat, och båda halvorna gick bara att rätta UPPÅT: en leverans kan inte
// vara negativ och går inte att ändra, och förbrukningen räknas fram ur säckrapporterna. En depå som
// visade för MÅNGA säckar — det vanliga felet, när blåsta säckar aldrig rapporterats — gick inte att
// rätta alls. Och ett för högt saldo tystar bristbanderollen.
//
// ⚠️ AVSTÄMNING, INTE JUSTERING. En justering (skriv in skillnaden som en delta) dubbelräknar när en
// rapport för arbete FÖRE räkningen kommer in efteråt: räknat 400 på måndagen, fredagens 50 säckar
// rapporteras på tisdagen, och saldot blir 350 fast det står 400 på depån. Här räknas saldot i
// stället FRÅN räkningen: det som hände före den syns redan i det räknade antalet. Se
// supabase/sql/20260911_ops_depot_stock_counts.sql för hela resonemanget.

/** En räkning, som den används i saldot. */
export type StockCount = {
  depot_id: string;
  material: string;
  sacks: number;
  /** 'YYYY-MM-DD'. Räkningen gäller vid dagens BÖRJAN. */
  counted_on: string;
};

/** En lagerrörelse med sitt datum — leveransens dag eller rapportens arbetsdag. */
export type DatedMovement = {
  depot_id: string;
  material: string;
  sacks: number;
  /** 'YYYY-MM-DD'. */
  day: string;
};

/** Nyckel per depå och material. U+0000 som avgränsare: materialkoderna innehåller mellanslag. */
function key(depotId: string, material: string): string {
  return `${depotId}\u0000${material}`;
}

/**
 * Ren: den senaste räkningen per depå och material.
 *
 * Senast = högst `counted_on`. Vid två räkningar SAMMA dag vinner den som kom sist i listan — anroparen
 * skickar raderna i `created_at`-ordning, så det blir den senast inmatade. Det är så en felaktig
 * räkning rättas: med en ny, samma dag.
 */
export function latestCounts(rows: StockCount[]): Map<string, StockCount> {
  const out = new Map<string, StockCount>();
  for (const r of rows) {
    const k = key(r.depot_id, r.material);
    const cur = out.get(k);
    // `>=` och inte `>`: vid lika datum ska den SENARE raden vinna, och raderna kommer i
    // inmatningsordning. Med `>` hade den första räkningen samma dag stått kvar, och en rättelse
    // hade varit verkningslös utan att något sa ifrån.
    if (!cur || r.counted_on >= cur.counted_on) out.set(k, r);
  }
  return out;
}

/**
 * Ren: stryk rörelser som redan syns i en räkning.
 *
 * För varje depå+material MED en räkning försvinner rörelser daterade FÖRE räkningsdagen — de är redan
 * med i det räknade antalet. Rörelser PÅ räkningsdagen och senare står kvar och läggs på, eftersom
 * räkningen gäller vid dagens början.
 *
 * ⚠️ `<`, INTE `<=`. Med `<=` hade räkningsdagens egen förbrukning försvunnit, och räknade man på
 * morgonen innan en bil blåste 50 säckar hade de 50 aldrig dragits av — saldot för HÖGT, den farliga
 * riktningen. Med `<` blir felet, om man i själva verket räknade efter dagens arbete, åt andra hållet:
 * en dags förbrukning för lågt, något för mycket beställt.
 *
 * Depåer och material UTAN räkning passerar orörda — där gäller saldot över all tid som förut.
 */
export function movementsAfterCounts<T extends DatedMovement>(movements: T[], counts: Map<string, StockCount>): T[] {
  return movements.filter((m) => {
    const c = counts.get(key(m.depot_id, m.material));
    return !c || m.day >= c.counted_on;
  });
}

/** Räkningen för en depå och ett material, eller undefined. */
export function countFor(counts: Map<string, StockCount>, depotId: string, material: string): StockCount | undefined {
  return counts.get(key(depotId, material));
}

/**
 * Alla räkningar, äldst först i inmatningsordning — latestCounts plockar ut den gällande per nyckel.
 *
 * Sidindelad: tabellen är bara-tillägg och växer med varje avstämning. RLS (planning.schedule.read).
 */
export async function listStockCounts(
  supabase: SupabaseClient,
): Promise<{ data: StockCount[]; error: ReadError }> {
  const { rows, error } = await readAllPages<Record<string, any>>((from, to) =>
    supabase
      .from('ops_depot_stock_counts')
      .select('depot_id, material, counted_sacks, counted_on')
      // Inmatningsordning är det latestCounts vilar på vid två räkningar samma dag. `id` bryter lika
      // `created_at`, så ordningen är unik och sidorna kan varken dubblera eller hoppa över rader.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) return { data: [], error };
  return {
    data: rows.map((r) => ({
      depot_id: r.depot_id as string,
      material: r.material as string,
      sacks: Number(r.counted_sacks),
      counted_on: r.counted_on as string,
    })),
    error: null,
  };
}

export type CreateStockCountInput = {
  depotId: string;
  material: string;
  countedSacks: number;
  countedOn: string;
  note: string | null;
  actorUserId: string;
  actorName: string | null;
};

// created_by måste vara anroparen (RLS insert-policyn kräver created_by = auth.uid()).
export async function createStockCount(supabase: SupabaseClient, input: CreateStockCountInput) {
  return supabase
    .from('ops_depot_stock_counts')
    .insert({
      depot_id: input.depotId,
      material: input.material,
      counted_sacks: input.countedSacks,
      counted_on: input.countedOn,
      note: input.note,
      created_by: input.actorUserId,
      created_by_name: input.actorName,
    })
    .select('id, depot_id, material, counted_sacks, counted_on')
    .single();
}
