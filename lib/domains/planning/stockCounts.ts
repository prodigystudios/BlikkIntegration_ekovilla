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
// supabase/archive/sql/20260911_ops_depot_stock_counts.sql för hela resonemanget.

/** En räkning, som den används i saldot. */
export type StockCount = {
  depot_id: string;
  material: string;
  sacks: number;
  /**
   * 'YYYY-MM-DD'. För FÖRBRUKNINGEN gäller räkningen vid dagens början. För en LEVERANS samma dag avgör
   * `created_at` — se deliveriesAfterCounts.
   */
  counted_on: string;
  /** När räkningen fördes in (timestamptz). Avgör bara leveranser daterade PÅ räkningsdagen. */
  created_at: string;
};

/** En lagerrörelse med sitt datum — leveransens dag eller rapportens arbetsdag. */
export type DatedMovement = {
  depot_id: string;
  material: string;
  sacks: number;
  /** 'YYYY-MM-DD'. */
  day: string;
};

/**
 * En leverans i saldot. `created_at` är OBLIGATORISK, inte valfri: utan den kan en leverans på
 * räkningsdagen inte placeras, och en läsning som tappar kolumnen ska synas i typkontrollen i stället
 * för att tyst ge tillbaka felet där bekräftade säckar aldrig nådde saldot.
 */
export type DeliveryMovement = DatedMovement & {
  /** När leveransen fördes in — kvitteringen eller en manuell leverans i Lager-fliken (timestamptz). */
  created_at: string;
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
 * Ren: stryk LEVERANSER som redan syns i en räkning.
 *
 * ⚠️ BARA FÖR LEVERANSER. Förbrukningen går via consumptionAfterCounts i depotStock, och den skillnaden
 * är inte kosmetisk: säckrapporteringen har en supersede-regel — egenkontrollen ersätter delrapporterna
 * och bär ett eget datum — så ett datumfilter på förbrukning dubbelräknar. Funktionen hette förut
 * movementsAfterCounts och drog förbrukningen också; det var fel, och namnet är ändrat så att det inte
 * går att göra om av misstag.
 *
 * Regeln:
 *   leverans FÖRE räkningsdagen  -> redan inräknad, läggs inte på
 *   leverans EFTER räkningsdagen -> läggs på
 *   leverans PÅ räkningsdagen    -> INMATNINGSORDNINGEN avgör: förd in efter räkningen läggs den på,
 *                                   förd in före räkningen räknas den som inräknad
 *
 * 🧨 SAMMA DAG AVGJORDES FÖRUT AV DATUMET ENSAMT, och leveransen räknades alltid som inräknad (`>`).
 * Tanken var att en morgonleverans annars dubbelräknades. I drift slog det ut åt andra hållet: Borlänge
 * stämdes av till 486 säck och 33 sekunder senare kvitterades ett lass på 1296 — båda daterade samma
 * dag. Lagerraden skapades, men saldot rörde sig inte och ingenting sa varför. Ekovilla inventerar i
 * slutet av månaden och kvitterar när lasset kommer (Williams besked 2026-09-17): knappen ska lägga på
 * säckarna. Är leveransen kvitterad innan räkningen förs in står den på depån när man räknar, och är
 * den det inte kommer den efter.
 *
 * ⚠️ Kvarvarande risk: en leverans som stod på depån när man räknade men kvitteras först EFTER att
 * räkningen förts in läggs på en gång till. Kvitteringsfönstret och leveransformuläret säger därför till
 * när datumet är räkningsdagen (deliveryVsCount).
 *
 * ⚠️ Samma regel gäller en RÄTTAD räkning: skrivs 486 om till 468 efter att lasset kvitterats, räknas
 * lasset som inräknat i 468. Avstämningsformuläret visar därför säckarna som redan är registrerade på
 * räkningsdagen (sacksOnCountDay).
 *
 * En tidsstämpel som inte går att tolka ger det gamla svaret — inräknad. Kolumnerna är NOT NULL, så det
 * ska aldrig hända; typen kräver fältet för att en läsning inte ska kunna tappa det.
 *
 * Depåer och material UTAN räkning passerar orörda — där gäller saldot över all tid som förut.
 */
export function deliveriesAfterCounts<T extends DeliveryMovement>(deliveries: T[], counts: Map<string, StockCount>): T[] {
  return deliveries.filter((m) => {
    const c = counts.get(key(m.depot_id, m.material));
    if (!c) return true;
    if (m.day !== c.counted_on) return m.day > c.counted_on;
    const deliveredAt = Date.parse(m.created_at);
    const countedAt = Date.parse(c.created_at);
    if (!Number.isFinite(deliveredAt) || !Number.isFinite(countedAt)) return false;
    return deliveredAt > countedAt;
  });
}

export type DeliveryVsCount = 'no_count' | 'before_count' | 'on_count_day' | 'after_count';

/**
 * Ren: var hamnar en leverans som förs in NU, mot depåns senaste räkning? För formulären, som ska säga
 * det INNAN någon trycker.
 *
 *   before_count           -> redan inräknad, saldot ändras inte
 *   on_count_day           -> läggs på, men stod lasset på depån när man räknade blir det dubbelt
 *   after_count / no_count -> läggs på
 *
 * Samma regel som deliveriesAfterCounts för en leverans som förs in efter varje räkning som redan finns,
 * och det gör den alltid eftersom räkningen redan är inläst. Då avgör bara datumet.
 */
export function deliveryVsCount(deliveredOn: string, countedOn: string | null): DeliveryVsCount {
  if (countedOn === null) return 'no_count';
  if (deliveredOn < countedOn) return 'before_count';
  return deliveredOn === countedOn ? 'on_count_day' : 'after_count';
}

/**
 * Ren: säckar som redan är registrerade PÅ räkningsdagen för depån och materialet.
 *
 * En räkning som förs in NU räknar dem som inräknade (deliveriesAfterCounts), också när den bara rättar
 * en tidigare räkning samma dag. Avstämningsformuläret visar talet så att det räknade antalet skrivs in
 * MED dem, annars försvinner ett kvitterat lass ur saldot igen utan att något säger varför.
 */
export function sacksOnCountDay(
  deliveries: Array<{ depot_id: string; material: string; sacks: number; delivered_on: string }>,
  target: { depotId: string; material: string; countedOn: string },
): number {
  return deliveries
    .filter((d) => d.depot_id === target.depotId && d.material === target.material && d.delivered_on === target.countedOn)
    .reduce((sum, d) => sum + d.sacks, 0);
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
      // created_at avgör leveranser på räkningsdagen (deliveriesAfterCounts) — tappas den läggs ingen
      // leverans på räkningsdagen någonsin på.
      .select('depot_id, material, counted_sacks, counted_on, created_at')
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
      created_at: r.created_at as string,
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
