import type { SupabaseClient } from '@supabase/supabase-js';
import { materialDemandFromLineItems, materialShortFromLineItems, type MaterialDemand } from '@/lib/domains/crm/materials';
import { SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';
import { effectiveSackReports, sackReportKind } from './sackLedger';

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
const PAGE = 1000;

type ReadError = { message: string } | null;

/**
 * Läser en hel tabell sida för sida.
 *
 * ⚠️ PostgREST kapar ett svar vid projektets max-rows (mätt till 1000) UTAN att fela. En oskyddad
 * select gör därför inte svaret ofullständigt — den gör det FEL, och åt olika håll beroende på
 * vilken läsning som kapades: en kapad leveranslista sänker `delivered` och driver ÖVERbeställning,
 * en kapad segmentlista sänker `planned` och tystar bristvarningen.
 *
 * `.order('id')` hos anroparen är inte kosmetik: utan en stabil och unik ordning är det odefinierat
 * vilka rader som ligger på vilken sida, så rader kan både dubbleras och hoppas över.
 *
 * Vid fel returneras INGA rader, inte de sidor som hann komma. Ett halvt underlag som ser komplett
 * ut är precis det felet som ska undvikas.
 */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: ReadError }>,
): Promise<{ rows: T[]; error: ReadError }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows: [], error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows, error: null };
}

async function listDeliveryRows(supabase: SupabaseClient): Promise<{ rows: StockRow[]; error: ReadError }> {
  // INGET datumfilter, med flit: saldot gäller över all tid. Tavlans remsa, som bara vill ha en
  // veckas leveranser, har en egen datumbegränsad läsning — vidga inte den här.
  const { rows, error } = await readAllPages<{ depot_id: string; material: string; sacks: number | string }>(
    (from, to) => supabase.from('ops_depot_deliveries').select('depot_id, material, sacks').order('id', { ascending: true }).range(from, to),
  );
  if (error) return { rows: [], error };
  return {
    rows: rows.map((r) => ({ depot_id: r.depot_id, material: r.material, sacks: Number(r.sacks) })),
    error: null,
  };
}

/** En registrerad leverans som den visas på tavlan. */
export type DepotDeliveryOnBoard = {
  id: string;
  depot_id: string;
  depot_name: string;
  material: string;
  sacks: number;
  delivered_on: string; // 'YYYY-MM-DD'
  note: string | null;
};

/**
 * Leveranser vars datum faller i [from, to]. RLS (planning.schedule.read).
 *
 * Syskon till listDeliveryRows, inte en ersättare: SALDOT gäller över all tid och får aldrig
 * datumfiltreras, medan TAVLAN bara ska rita den vecka som syns. Vidga inte den ena till den andra.
 *
 * Sidindelad ändå, trots att datumfönstret redan begränsar: fönstret är inte alltid en vecka.
 * Månadsvyn och "Hela månaden" ber om ~42 dagar, och antalet leveranser per dag är inte vårt att
 * bestämma. Ett tak som råkar hålla är inget tak — och tyst kapning är precis det den här filen just
 * härdats mot.
 */
export async function listDeliveriesInRange(
  supabase: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ data: DepotDeliveryOnBoard[]; error: ReadError }> {
  const { rows: data, error } = await readAllPages<Record<string, any>>((from, to) =>
    supabase
      .from('ops_depot_deliveries')
      .select('id, depot_id, material, sacks, delivered_on, note, depot:ops_depots(name)')
      .gte('delivered_on', range.from)
      .lte('delivered_on', range.to)
      .order('delivered_on', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) return { data: [], error };

  const rows = ((data ?? []) as Array<Record<string, any>>).map((r) => {
    const depot = Array.isArray(r.depot) ? r.depot[0] : r.depot;
    return {
      id: r.id as string,
      depot_id: r.depot_id as string,
      depot_name: (depot?.name as string) ?? 'Okänd depå',
      material: r.material as string,
      sacks: Number(r.sacks),
      delivered_on: r.delivered_on as string,
      note: (r.note as string | null) ?? null,
    };
  });
  return { data: rows, error: null };
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
async function deriveConsumptionRows(
  supabase: SupabaseClient,
): Promise<{ rows: StockRow[]; reported: Map<string, ReportedDemand>; error: ReadError }> {
  const empty = { rows: [] as StockRow[], reported: new Map<string, ReportedDemand>() };
  const { data: trucks, error: truckError } = await supabase.from('ops_trucks').select('id, depot_id');
  // Ett fel här ger en tom depåkarta, alltså NOLL förbrukning på varje depå — saldot ser fullt ut.
  // Bilparken är liten nog att aldrig nå max-rows, men felet måste ändå fram.
  if (truckError) return { ...empty, error: truckError };
  const truckDepot = new Map((trucks ?? []).map((t: any) => [t.id as string, (t.depot_id as string | null) ?? null]));

  // ⚠️ SIDINDELAD. PostgREST kapar svaret vid max-rows UTAN att fela, och supersede-regeln nycklas
  // per arbetsorder: hamnar ett jobbs final på sida 2 medan dess delrapporter ligger på sida 1 ser
  // regeln bara delrapporterna och debiterar depån för BÅDA besöken. En kapning gör alltså inte
  // svaret ofullständigt, den gör det FEL — och åt fel håll.
  //
  // ops_segment_reports är dessutom den läsning som växer snabbast: tabellen var tom före
  // säckrapporteringen och växer nu monotont med varje besök, medan systerläsningarna är bundna
  // till mängden ÖPPNA ordrar.
  const { rows: reports, error: reportError } = await readAllPages<Record<string, any> & { work_order_id: string }>(
    (from, to) =>
      supabase
        .from('ops_segment_reports')
        .select('work_order_id, sacks_blown, kind, material, segment:ops_segments(truck_id), work_order:crm_work_orders(line_items)')
        .order('id', { ascending: true })
        .range(from, to),
  );
  // Tidigare `break`:ade den här loopen vid fel och returnerade de sidor som hunnit komma. Ett halvt
  // underlag är värre än inget: supersede prövas då bara på raderna som kom fram, så en final på den
  // kapade sidan gör att delrapporterna räknas — precis felmoden pagineringen infördes för.
  if (reportError) return { ...empty, error: reportError };

  const counted = effectiveSackReports(reports);

  const rows: StockRow[] = [];
  for (const r of counted) {
    const seg = Array.isArray(r.segment) ? r.segment[0] : r.segment;
    const wo = Array.isArray(r.work_order) ? r.work_order[0] : r.work_order;
    const depotId = seg ? truckDepot.get(seg.truck_id) : null;
    const material = (typeof r.material === 'string' && r.material.trim()) || materialShortFromLineItems(wo?.line_items);
    if (depotId && material) rows.push({ depot_id: depotId, material, sacks: Number(r.sacks_blown) });
  }
  // Samma rader bär BÅDA halvorna av saldot: det som gått åt (rows) och det som därför inte längre
  // är kvar att blåsa (reported). De MÅSTE komma ur en och samma läsning — läses tabellen två
  // gånger kan en rapport skriven mellan läsningarna finnas i den ena och saknas i den andra, och
  // då tar dubbelräkningen inte ut sig exakt. sackLedger varnar för just det.
  return { rows, reported: reportedDemandByWorkOrder(reports, truckDepot), error: null };
}

/** Vad en arbetsorder redan blåst, per depå och material — och om egenkontrollen satt punkt. */
export type ReportedDemand = {
  /** Jobbet har en egenkontroll. Gäller HELA jobbet, inte en depå. */
  hasFinal: boolean;
  /** depå → material → blåsta säckar. Måste vara per depå: se invarianten nedan. */
  byDepotMaterial: Map<string, Map<string, number>>;
};

/**
 * Ren: blåsta säckar per arbetsorder och material, ur RÅA rapportrader.
 *
 * `hasFinal` läses ur de råa raderna, inte ur de effektiva — supersede får inte dölja ATT en final
 * finns, den avgör bara vilka rader som räknas. Beloppen kommer däremot ur effectiveSackReports,
 * alltså finalerna när jobbet har några och annars dess partials. Aldrig addition mellan dem.
 *
 * Materialet tas från radens egen kolumn, med orderns första igenkända material som reserv för
 * rader skrivna innan kolumnen fanns — EXAKT samma härledning som förbrukningen använder. Skulle de
 * två skilja sig åt drogs säckarna från ett material i saldot och från ett annat i behovet.
 *
 * ⚠️ INVARIANTEN ÄR PER DEPÅ, INTE GLOBAL. `shortfall` räknas per depå och material, så det räcker
 * inte att varje avdragen säck finns bokförd som förbrukning NÅGONSTANS — den måste vara bokförd på
 * SAMMA depå. Därför nycklas beloppen på den depå förbrukningen faktiskt debiterades, med exakt
 * samma härledning (segmentets bil → bilens depå).
 *
 * Ett jobb splittat på två bilar vid olika depåer ("Kopiera till bil" är ett normalt drag) är
 * precis fallet: säckar som fysiskt togs ur depå B får inte krympa behovet vid depå A. Ett globalt
 * nycklat avdrag gjorde just det, och A:s brist blev för liten — den farliga riktningen.
 *
 * Samma grind som förbrukningen i övrigt: en rad räknas bara när den löser BÅDE en depå och ett
 * material. deriveConsumptionRows hoppar tyst över segment vars bil saknar depot_id (en dokumenterad
 * lucka), så räknades de här skulle behovet sjunka utan att saldot gjorde det. Hellre ett för högt
 * behov (dyrt) än ett för lågt (en bil utan material).
 *
 * En rad vars material eller depå inte går att härleda lämnar arbetsordern i kartan men utan belopp:
 * jobbet är känt, avdraget är det inte.
 */
export function reportedDemandByWorkOrder(
  reports: Array<Record<string, any> & { work_order_id: string; kind?: string | null }>,
  truckDepot: Map<string, string | null>,
): Map<string, ReportedDemand> {
  const map = new Map<string, ReportedDemand>();
  const ensure = (workOrderId: string): ReportedDemand => {
    let cell = map.get(workOrderId);
    if (!cell) {
      cell = { hasFinal: false, byDepotMaterial: new Map() };
      map.set(workOrderId, cell);
    }
    return cell;
  };

  for (const r of reports) {
    if (sackReportKind(r) === 'final') ensure(r.work_order_id).hasFinal = true;
  }

  for (const r of effectiveSackReports(reports)) {
    const cell = ensure(r.work_order_id);
    const seg = Array.isArray(r.segment) ? r.segment[0] : r.segment;
    const wo = Array.isArray(r.work_order) ? r.work_order[0] : r.work_order;
    const depotId = seg ? truckDepot.get(seg.truck_id) : null;
    const material = (typeof r.material === 'string' && r.material.trim()) || materialShortFromLineItems(wo?.line_items);
    const sacks = Number(r.sacks_blown ?? 0);
    if (!depotId || !material || !Number.isFinite(sacks)) continue;
    const byMaterial = cell.byDepotMaterial.get(depotId) ?? new Map<string, number>();
    byMaterial.set(material, (byMaterial.get(material) ?? 0) + sacks);
    cell.byDepotMaterial.set(depotId, byMaterial);
  }

  return map;
}

/**
 * Ren: drar av det som redan blåsts från varje segments materialbehov.
 *
 * ⚠️ EN IFYLLD EGENKONTROLL BETYDER BLÅST FÄRDIGT. Den är jobbets slutsiffra, så inget mer material
 * behövs — även när ordern säger 564 och egenkontrollen 528. Skillnaden är att det gick åt mindre
 * än beräknat, inte att 36 säckar återstår. Statusen sätts för hand och flyttas inte av
 * egenkontrollen, så ett färdigblåst jobb ligger ofta kvar som `in_progress` och skulle annars
 * fortsätta kräva material ur depån. (Williams beslut 2026-09-10.)
 *
 * Utan egenkontroll räknas behovet ned mot planen, per material — samma "kvar"-innebörd som
 * jobbkortets badge redan visar när egenkontroll saknas.
 *
 * En order utan rapportrader lämnas orörd: "ej rapporterat" är inte "noll blåsta".
 *
 * ⚠️ `hasFinal` är INTE grindat på depå, till skillnad från beloppen. Ett färdigt jobb behöver noll
 * mer material, och det är sant oavsett vilken depå säckarna kom ifrån. Följden är att ett jobb som
 * blåstes från en bil utan depot_id tar bort ett behov som aldrig bokfördes som förbrukning — en
 * konsekvens av den dokumenterade luckan i deriveConsumptionRows, inte av regeln här. Grinden hör
 * hemma där förbrukningen får en depå, inte här.
 */
export function applyReportedToDemand(
  segments: PlannedDemandSegment[],
  reported: Map<string, ReportedDemand>,
): PlannedDemandSegment[] {
  return segments.map((s) => {
    const rep = s.work_order_id ? reported.get(s.work_order_id) : undefined;
    if (!rep) return s;
    if (rep.hasFinal) return { ...s, materials: [] };
    // Bara det som blåstes ur DEN HÄR depån får krympa behovet här — se invarianten vid
    // reportedDemandByWorkOrder. Ett segment vid en depå som aldrig rapporterats mot lämnas orört.
    const blown = s.depot_id ? rep.byDepotMaterial.get(s.depot_id) : undefined;
    if (!blown) return s;
    return {
      ...s,
      materials: (s.materials ?? []).map((m) => ({
        material: m.material,
        sacks: Math.max(0, m.sacks - (blown.get(m.material) ?? 0)),
      })),
    };
  });
}

// One scheduled segment, already resolved down to the fields the attribution needs.
export type PlannedDemandSegment = {
  work_order_id: string | null;
  depot_id: string | null;
  status: string | null;
  /**
   * Behovet per material (materialDemandFromLineItems). En order kan bära flera material, och de
   * dras från depån var för sig — tom lista betyder att inget material gick att härleda.
   */
  materials: MaterialDemand[];
};

/**
 * Pure: planned-demand rows per open work order, attributed to the first segment (in the given
 * order) that resolves to BOTH a depot and at least one material with sacks to blow.
 *
 * ⚠️ A work order counts as seen only once it has actually been counted. Marking it seen before the
 * validity check — which is what this did — meant a job whose first segment sat on a truck with no
 * depot was dropped entirely, and the dedup then skipped its remaining segments too. The demand
 * silently vanished and the shortfall banner stayed quiet. Splitting a job across two trucks is a
 * normal move on the board ("Kopiera till bil"), so this was reachable.
 *
 * ⚠️ EN RAD PER MATERIAL, inte per arbetsorder. Dedupen gäller fortfarande jobbet — ett jobb över
 * flera segment räknas en gång — men det jobbet kan mycket väl behöva två material ur samma depå.
 * Att lägga hela säckantalet på orderns första material (vilket det här gjorde) lämnade det andra
 * materialet utan planerat behov, och i materialbeställningen är materialet dessutom det som väljer
 * fabrik.
 */
export function attributePlannedDemand(segments: PlannedDemandSegment[]): StockRow[] {
  const open = new Set(SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);
  const seen = new Set<string>();
  const rows: StockRow[] = [];
  for (const s of segments) {
    if (!s.work_order_id || !s.status || !open.has(s.status) || seen.has(s.work_order_id)) continue;
    const demand = (s.materials ?? []).filter((m) => m.material && m.sacks > 0);
    if (!s.depot_id || demand.length === 0) continue;
    seen.add(s.work_order_id);
    for (const d of demand) rows.push({ depot_id: s.depot_id, material: d.material, sacks: d.sacks });
  }
  return rows;
}

// Kandidatsegmenten bakom det planerade behovet: för varje ÖPPET bokat jobb (arbetsordern
// fortfarande draft/scheduled/in_progress) säckarna den ska blåsa → segmentets bil → bilens depå,
// uppdelat PER MATERIAL.
//
// Bara LÄSNINGEN bor här. Avdraget för det som redan blåsts (applyReportedToDemand) och urvalet av
// vilket segment som vinner (attributePlannedDemand) är rena och görs av getDepotStock — dels för
// att de går att enhetstesta isolerat, dels för att avdraget måste använda samma rapportrader som
// förbrukningen räknades ur.
async function derivePlannedDemandSegments(
  supabase: SupabaseClient,
): Promise<{ segments: PlannedDemandSegment[]; error: ReadError }> {
  const { data: trucks, error: truckError } = await supabase.from('ops_trucks').select('id, depot_id');
  // Tom depåkarta betyder att INGET segment löser en depå, alltså noll planerat behov överallt och
  // en bristvarning som tiger. Felet måste fram.
  if (truckError) return { segments: [], error: truckError };
  const truckDepot = new Map((trucks ?? []).map((t: any) => [t.id as string, (t.depot_id as string | null) ?? null]));

  // Open work orders first, then only THEIR segments — the same two-step listSchedulableWorkOrders
  // and getPlanningInsights use. This bounds the read to the working set instead of every
  // ops_segments row ever created, which grew with the table forever.
  //
  // Sidindelad ovanpå det: bunden till öppna ordrar är inte samma sak som bunden under max-rows.
  // Utkast ackumuleras, och en kapad lista tappar poster tyst — segmenten faller ur flatMap:en
  // nedan, `planned` underskattas, `shortfall` golvas till 0 och banderollen tiger på en verklig
  // brist. (listSchedulableWorkOrders/computeBacklogValue har kvar samma exponering.)
  const { rows: openWos, error: woError } = await readAllPages<Record<string, any>>((from, to) =>
    supabase
      .from('crm_work_orders')
      .select('id, status, line_items')
      .in('status', SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[])
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (woError) return { segments: [], error: woError };

  // Parsed once per work order, not once per segment: line_items is the expensive part and a job's
  // material/sack count is the same on every segment it spans.
  const woById = new Map(
    (openWos ?? []).map((w: any) => [
      w.id as string,
      { status: (w.status as string | null) ?? null, materials: materialDemandFromLineItems(w.line_items) },
    ]),
  );
  if (woById.size === 0) return { segments: [], error: null };

  // Ordered so the attribution is deterministic: a job split across trucks is booked against its
  // EARLIEST segment's depot, not whichever row came back first. Ordningen bär alltså ett resultat,
  // inte bara ett utseende — och den är därför också vad sidindelningen måste följa. `id` bryter
  // lika start_day, så ordningen är unik och sidorna kan varken dubblera eller hoppa över rader.
  //
  // ⚠️ `.in()` LIGGER I URL:EN. Så länge orderläsningen ovan kapades vid max-rows höll den listan
  // under tusen id:n av en ren slump; nu när den paginerar finns inget sådant tak, och en lista som
  // växer med varje utkast spränger till slut querysträngen. Det felet hade dessutom, med
  // fail-closed, tagit ned hela lagervyn. Därför i portioner — ordningen inom varje portion är
  // densamma, och sorteringen som avgör vilken depå ett splittat jobb bokas mot återställs nedan.
  const woIds = [...woById.keys()];
  const IN_CHUNK = 300;
  const segs: Array<Record<string, any>> = [];
  for (let i = 0; i < woIds.length; i += IN_CHUNK) {
    const chunk = woIds.slice(i, i + IN_CHUNK);
    const { rows, error: segError } = await readAllPages<Record<string, any>>((from, to) =>
      supabase
        .from('ops_segments')
        .select('id, work_order_id, truck_id, start_day')
        .in('work_order_id', chunk)
        .order('start_day', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (segError) return { segments: [], error: segError };
    segs.push(...rows);
  }

  // Portionerna kom var för sig, så den globala ordningen måste återställas: attributionen väljer
  // FÖRSTA giltiga segmentet, och vilket det är får inte bero på hur id-listan råkade delas.
  segs.sort((a, b) => String(a.start_day).localeCompare(String(b.start_day)) || String(a.id).localeCompare(String(b.id)));

  const segments = segs.flatMap((s) => {
    const wo = woById.get(s.work_order_id as string);
    if (!wo) return [];
    return [{
      work_order_id: (s.work_order_id as string | null) ?? null,
      depot_id: truckDepot.get(s.truck_id) ?? null,
      status: wo.status,
      materials: wo.materials,
    }];
  });
  return { segments, error: null };
}

// Per-depot, per-material balances + planned demand for the stock view. RLS (planning.schedule.read).
export async function getDepotStock(supabase: SupabaseClient): Promise<{ data: DepotBalance[]; error: { message: string } | null }> {
  const { data: depots, error } = await supabase.from('ops_depots').select('id, name').order('name', { ascending: true });
  if (error) return { data: [], error };

  const [delivered, consumption, demand] = await Promise.all([
    listDeliveryRows(supabase),
    deriveConsumptionRows(supabase),
    derivePlannedDemandSegments(supabase),
  ]);

  // ⚠️ FAILA STÄNGT. Tidigare svalde varje läsning sitt fel och getDepotStock returnerade hårdkodat
  // `error: null`, så rutten kunde bara vidarebefordra ett fel den aldrig fick. Utfallet blev ett
  // TAL i stället för ett fel — och åt olika håll beroende på vilken läsning som gick sönder:
  // ett fel på leveranserna ger `delivered = 0` och uppblåst brist, ett fel på segmenten ger
  // `planned = 0` och en tyst banderoll på en depå som är tom.
  //
  // "Kunde inte räkna" är ett svar. "Behöver 0 säck" är en lögn, och den lögnen ska snart få fylla
  // i en beställning till fabriken.
  const readError = delivered.error ?? consumption.error ?? demand.error;
  if (readError) return { data: [], error: readError };

  // Behovet är det som är KVAR att blåsa, inte orderns hela säckantal. Utan avdraget räknades de
  // blåsta säckarna två gånger — en gång som sänkt `balance` och en gång som kvarstående `planned`
  // — och `shortfall` överskattades med exakt det blåsta antalet, växande under veckan.
  // Avdraget görs ur SAMMA rapportrader som förbrukningen räknades ur (consumption.reported), så de
  // två halvorna alltid ser samma tillstånd.
  const planned = attributePlannedDemand(applyReportedToDemand(demand.segments, consumption.reported));

  return {
    data: computeDepotBalances((depots ?? []) as { id: string; name: string }[], delivered.rows, consumption.rows, planned),
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
