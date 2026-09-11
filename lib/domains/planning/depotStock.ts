import type { SupabaseClient } from '@supabase/supabase-js';
import { materialDemandFromLineItems, materialShortFromLineItems, type MaterialDemand } from '@/lib/domains/crm/materials';
import { SCHEDULABLE_WORK_ORDER_STATUSES } from './backlog';
import { effectiveSackReports, sackReportKind } from './sackLedger';
import { chunkIds, readAllPages, type ReadError } from './pagedRead';
import { listOpenExpected } from './expectedDeliveries';
import { defaultSupplierForMaterial, listSupplyTerms } from './materialSuppliers';
import { forecastDepotRunOut, supplyKey, type DepotForecast, type ForecastEvent } from './depotForecast';
import { countFor, latestCounts, listStockCounts, movementsAfterCounts, type DatedMovement, type StockCount } from './stockCounts';

// Depot stock (slice 12b): per-material balance per depot = sum(deliveries) − consumption, where
// consumption is derived from ops_segment_reports (a job's blown sacks → its segment's truck → that
// truck's depot, attributed to the work order's material). Pure computeDepotBalances is unit-tested;
// the DB functions are thin RLS-scoped reads/writes.

export type StockRow = { depot_id: string; material: string; sacks: number };

export type DepotMaterialBalance = {
  material: string;
  /** Levererat — sedan senaste avstämningen om det finns en, annars över all tid. */
  delivered: number;
  /** Förbrukat — samma avgränsning som `delivered`. */
  consumed: number;
  /**
   * Säckarna vid senaste avstämningen, eller null när depån+materialet aldrig stämts av.
   *
   * ⚠️ null och 0 är OLIKA saker. 0 betyder "vi räknade och depån var tom" — ett av de viktigaste
   * svaren, eftersom det tänder bristbanderollen. null betyder att saldot vilar på levererat − förbrukat
   * över all tid, precis som före avstämningarna.
   */
  counted: number | null;
  /** 'YYYY-MM-DD', eller null. Räkningen gäller vid dagens början. */
  counted_on: string | null;
  /** (counted ?? 0) + delivered − consumed. */
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
  /**
   * Senaste avstämning per depå+material (latestCounts). Valfri: utan den räknas saldot som förut,
   * över all tid.
   *
   * ⚠️ Rörelserna i `delivered` och `consumed` måste REDAN vara filtrerade med movementsAfterCounts
   * mot samma karta. Den här funktionen lägger bara på baslinjen — den stryker ingenting. Skickas
   * ofiltrerade rader in räknas allt före räkningen två gånger: en gång i det räknade antalet och en
   * gång som rörelse.
   */
  counts: Map<string, StockCount> = new Map(),
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
  // En räkning skapar sin rad även utan någon rörelse efteråt — en depå som stämts av till 400 och
  // sedan stått orörd ska visa 400, inte saknas i tabellen.
  for (const c of counts.values()) ensure(c.depot_id, c.material);

  return depots.map((d) => {
    const byMat = acc.get(d.id);
    const rows: DepotMaterialBalance[] = byMat
      ? [...byMat.entries()]
          .map(([material, cell]) => {
            const c = countFor(counts, d.id, material);
            // Baslinjen är räkningen om det finns en, annars noll — och då är det exakt formeln som
            // gällde före avstämningarna. `?? 0` och inte `|| 0` behövs inte här (c.sacks är ett tal),
            // men poängen är att en räkning på 0 är en baslinje på 0, inte en frånvarande baslinje.
            const balance = (c ? c.sacks : 0) + cell.delivered - cell.consumed;
            return {
              material,
              delivered: cell.delivered,
              consumed: cell.consumed,
              counted: c ? c.sacks : null,
              counted_on: c ? c.counted_on : null,
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
async function listDeliveryRows(supabase: SupabaseClient): Promise<{ rows: DatedMovement[]; error: ReadError }> {
  // INGET datumfilter, med flit: saldot gäller över all tid. Tavlans remsa, som bara vill ha en
  // veckas leveranser, har en egen datumbegränsad läsning — vidga inte den här.
  //
  // `delivered_on` följer med sedan avstämningarna kom: en leverans FÖRE en räkning syns redan i det
  // räknade antalet och får inte läggas på en gång till (movementsAfterCounts).
  const { rows, error } = await readAllPages<{ depot_id: string; material: string; sacks: number | string; delivered_on: string }>(
    (from, to) =>
      supabase
        .from('ops_depot_deliveries')
        .select('depot_id, material, sacks, delivered_on')
        .order('id', { ascending: true })
        .range(from, to),
  );
  if (error) return { rows: [], error };
  return {
    rows: rows.map((r) => ({ depot_id: r.depot_id, material: r.material, sacks: Number(r.sacks), day: r.delivered_on })),
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

/**
 * Ren: vilken depå och vilket material en rapportrad hör till, och med hur många säckar — eller null.
 *
 * ⚠️ EN ENDA HÄRLEDNING, INTE TRE. Uttrycket fanns kopierat i deriveConsumptionRows OCH i
 * reportedDemandByWorkOrder, och de två hade redan glidit isär: den ena prövade `Number.isFinite`,
 * den andra inte. Etapp 0:s invariant — "varje säck ur planned måste också ur balance" — vilar på att
 * förbrukningen och avdraget använder EXAKT samma villkor. Två kopior av ett villkor är två villkor.
 *
 * null när segmentets bil saknar depå (den dokumenterade luckan), när materialet inte går att härleda,
 * eller när antalet inte är ett tal. Materialet tas ur radens egen kolumn, med orderns första
 * igenkända material som reserv för rader skrivna innan kolumnen fanns.
 */
export function attributeReport(
  r: Record<string, any>,
  truckDepot: Map<string, string | null>,
): { depot_id: string; material: string; sacks: number; day: string } | null {
  const seg = Array.isArray(r.segment) ? r.segment[0] : r.segment;
  const wo = Array.isArray(r.work_order) ? r.work_order[0] : r.work_order;
  const depotId = seg ? truckDepot.get(seg.truck_id) : null;
  const material = (typeof r.material === 'string' && r.material.trim()) || materialShortFromLineItems(wo?.line_items);
  const sacks = Number(r.sacks_blown ?? 0);
  if (!depotId || !material || !Number.isFinite(sacks)) return null;
  return { depot_id: depotId, material, sacks, day: r.report_day as string };
}

/**
 * Ren: förbrukningen per depå och material — efter senaste avstämningen där det finns en.
 *
 * 🧨 "DET HUVUDBOKEN SÄGER NU, MINUS DET DEN SA I RÄKNINGSÖGONBLICKET". Inte ett datumfilter på
 * rapportraderna, och skillnaden är supersede-regeln:
 *
 *     jobb över två dagar:  fredag delrapport 50,  måndag egenkontroll 120.  Räkning måndag morgon.
 *
 *     datumfilter:  egenkontrollen ERSÄTTER delrapporten och bär måndagens datum -> hela 120 dras av
 *                   efter räkningen. Men bara 70 blåstes efter den; fredagens 50 syns redan i det
 *                   räknade antalet. Dubbelräknat.
 *     här:          vid räkningen sa huvudboken 50 (bara delrapporten fanns). Nu säger den 120
 *                   (egenkontrollen gäller). Efter räkningen: 120 − 50 = 70.
 *
 * Det är inget kantfall: delrapporter följda av en egenkontroll är NORMALFLÖDET för flerdagarsjobb, så
 * varje jobb som pågick vid räkningen hade dragit saldot under det som just skrevs in.
 *
 * Supersede tillämpas på BÅDA sidor (effectiveSackReports), så regeln skrivs inte en gång till här.
 *
 * Depå+material UTAN räkning får hela summan, precis som före avstämningarna.
 *
 * ⚠️ Golvat vid noll per depå+material. Det negativa fallet uppstår bara när ett jobbs rapporter
 * hamnar på OLIKA depåer före och efter räkningen — egenkontrollen flyttar då hela attributionen, och
 * depån som räknades skulle få en negativ förbrukning, alltså säckar tillbaka som aldrig kom. Man kan
 * inte avblåsa säckar; noll är det enda försvarbara svaret.
 */
export function consumptionAfterCounts(
  reports: Array<Record<string, any> & { work_order_id: string }>,
  truckDepot: Map<string, string | null>,
  counts: Map<string, StockCount>,
): StockRow[] {
  const sumByKey = (rows: typeof reports) => {
    const out = new Map<string, { depot_id: string; material: string; sacks: number }>();
    for (const r of effectiveSackReports(rows)) {
      const a = attributeReport(r, truckDepot);
      if (!a) continue;
      const k = `${a.depot_id}\u0000${a.material}`;
      const cur = out.get(k) ?? { depot_id: a.depot_id, material: a.material, sacks: 0 };
      cur.sacks += a.sacks;
      out.set(k, cur);
    }
    return out;
  };

  // Det huvudboken hade sett i räkningsögonblicket: rapporter för arbete FÖRE sin depås räkning.
  // En rapport vars depå+material saknar räkning är aldrig "före" — där gäller all tid.
  const before = reports.filter((r) => {
    const a = attributeReport(r, truckDepot);
    if (!a) return false;
    const c = countFor(counts, a.depot_id, a.material);
    // `<`: räkningen gäller vid dagens BÖRJAN — räkningsdagens arbete är efter räkningen.
    return c ? a.day < c.counted_on : false;
  });

  const total = sumByKey(reports);
  const atCount = sumByKey(before);

  const rows: StockRow[] = [];
  for (const [k, t] of total) {
    const counted = countFor(counts, t.depot_id, t.material);
    const sacks = counted ? Math.max(0, t.sacks - (atCount.get(k)?.sacks ?? 0)) : t.sacks;
    rows.push({ depot_id: t.depot_id, material: t.material, sacks });
  }
  return rows;
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
  truckDepot: Map<string, string | null>,
): Promise<{
  rows: DatedMovement[];
  raw: Array<Record<string, any> & { work_order_id: string }>;
  reported: Map<string, ReportedDemand>;
  error: ReadError;
}> {
  const empty = { rows: [] as DatedMovement[], raw: [] as Array<Record<string, any> & { work_order_id: string }>, reported: new Map<string, ReportedDemand>() };

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
        // `report_day` följer med sedan avstämningarna kom: förbrukning FÖRE en räkning syns redan i
        // det räknade antalet. Det är ARBETSDAGEN som avgör, inte när rapporten skickades — annars
        // hade en sen rapport för fredagens arbete dragits av efter måndagens räkning, dubbelt.
        .select('work_order_id, sacks_blown, kind, material, report_day, segment:ops_segments(truck_id), work_order:crm_work_orders(line_items)')
        .order('id', { ascending: true })
        .range(from, to),
  );
  // Tidigare `break`:ade den här loopen vid fel och returnerade de sidor som hunnit komma. Ett halvt
  // underlag är värre än inget: supersede prövas då bara på raderna som kom fram, så en final på den
  // kapade sidan gör att delrapporterna räknas — precis felmoden pagineringen infördes för.
  if (reportError) return { ...empty, error: reportError };

  const counted = effectiveSackReports(reports);

  const rows: DatedMovement[] = [];
  for (const r of counted) {
    const a = attributeReport(r, truckDepot);
    if (a) rows.push(a);
  }
  // Samma rader bär BÅDA halvorna av saldot: det som gått åt (rows) och det som därför inte längre
  // är kvar att blåsa (reported). De MÅSTE komma ur en och samma läsning — läses tabellen två
  // gånger kan en rapport skriven mellan läsningarna finnas i den ena och saknas i den andra, och
  // då tar dubbelräkningen inte ut sig exakt. sackLedger varnar för just det.
  // `raw` följer med för avstämningen: förbrukning efter en räkning måste räknas som "det huvudboken
  // säger nu minus det den sa vid räkningen", och det kräver råraderna — supersede-regeln måste kunna
  // tillämpas på båda sidor. Se consumptionAfterCounts.
  return { rows, raw: reports, reported: reportedDemandByWorkOrder(reports, truckDepot), error: null };
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
    const a = attributeReport(r, truckDepot);
    if (!a) continue;
    const byMaterial = cell.byDepotMaterial.get(a.depot_id) ?? new Map<string, number>();
    byMaterial.set(a.material, (byMaterial.get(a.material) ?? 0) + a.sacks);
    cell.byDepotMaterial.set(a.depot_id, byMaterial);
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
    // ⚠️ NOLLAR materialen, RADERAR dem inte. Skillnaden är inte kosmetisk: en tom lista betyder
    // "inget material gick att härleda" nedströms, och ett färdigblåst jobb rapporterades då som
    // no_material i excluded — kortet påstod att siffrorna var för låga för jobb som behöver noll.
    // Materialet ÄR känt; det är behovet som är slut.
    if (rep.hasFinal) return { ...s, materials: (s.materials ?? []).map((m) => ({ material: m.material, sacks: 0 })) };
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
  /**
   * Segmentets startdag, 'YYYY-MM-DD'. Bär INGEN vikt i saldot (som är tidlöst) men är hela grunden
   * för prognosen: det är den här dagen behovet bokförs på när depån vandras dag för dag.
   *
   * VALFRITT med flit: saldovägen (attributePlannedDemand -> computeDepotBalances) är tidlös och
   * bryr sig inte, så dess anropare och tester behöver inte känna till fältet alls. Utelämnat eller
   * null betyder att dagen inte gick att läsa — då räknas raden i saldot men kan inte dateras, och
   * prognosen redovisar den som utesluten i stället för att gissa ett datum.
   */
  start_day?: string | null;
};

/**
 * Ett jobb vars behov inte kunde räknas fullt ut.
 *
 * ⚠️ Finns för att prognosen ska kunna SÄGA vad den inte vet. Tidigare hoppades de här jobben tyst
 * över (`if (depotId && material)`), så ett underlag med hål såg exakt ut som ett komplett — och
 * skillnaden är ett beställningsförslag som är för lågt utan att någon kan se det.
 */
export type DemandExclusion = {
  work_order_id: string;
  /**
   * `no_depot`  — inget av jobbets segment ligger på en bil med depå. Behovet tillhör ingen depå.
   * `no_material` — artikelnamnen härledde inget material (se materialRenameEffect).
   * `no_date`   — segmentet saknar startdag: räknas i saldot, men går inte att placera på en dag.
   */
  reason: 'no_depot' | 'no_material' | 'no_date';
};

/** Ett arbetsordersegment som VANN attributionen, med behovet som återstår vid dess depå. */
export type PickedDemand = {
  work_order_id: string;
  depot_id: string;
  start_day: string | null;
  materials: MaterialDemand[];
};

/**
 * Ren: vilket segment som bär en arbetsorders materialbehov — EN källa för både saldot och prognosen.
 *
 * ⚠️ DEN HÄR FUNKTIONEN ÄR HELA POÄNGEN MED ATT DE INTE GLIDER ISÄR. Bristbanderollen frågar "hur
 * mycket fattas" och prognosen frågar "när tar det slut", men det är samma fråga om samma underlag.
 * Skrivs urvalet två gånger driver de isär tyst — banderollen larmar om en depå prognosen säger är
 * försörjd, eller tvärtom, och ingen av dem felar. Lägg aldrig en andra urvalsregel bredvid den här.
 *
 * REGELN, oförändrad från den attribution som gällt sedan lagervyn byggdes: en arbetsorder räknas
 * EN gång, mot det FÖRSTA segmentet (i inskickad ordning) som löser en depå.
 *
 * ⚠️ En arbetsorder räknas som sedd först när den faktiskt räknats. Markerades den sedd före
 * depåkontrollen — vilket den gjorde en gång — försvann ett jobb vars första segment satt på en bil
 * utan depå helt, och dedupen hoppade sedan över dess övriga segment också. Behovet försvann tyst
 * och banderollen teg. Att splitta ett jobb över två bilar är ett normalt drag ("Kopiera till bil"),
 * så det var nåbart.
 *
 * ⚠️ Genomfallningen gäller BARA depålösheten. Ett tomt materialbehov fick en gång samma behandling,
 * och då flyttades ett färdigblåst jobbs behov till NÄSTA depå — en rosa banderoll på en depå där
 * ingenting var planerat. Att sakna depå säger ingenting om jobbet; att ha noll kvar är ett svar.
 */
export function pickDemandSegments(segments: PlannedDemandSegment[]): {
  picked: PickedDemand[];
  excluded: DemandExclusion[];
} {
  const open = new Set(SCHEDULABLE_WORK_ORDER_STATUSES as unknown as string[]);
  const seen = new Set<string>();
  const candidates = new Set<string>();
  const picked: PickedDemand[] = [];

  for (const s of segments) {
    if (!s.work_order_id || !s.status || !open.has(s.status)) continue;
    candidates.add(s.work_order_id);
    if (seen.has(s.work_order_id)) continue;
    if (!s.depot_id) continue;
    seen.add(s.work_order_id);
    picked.push({
      work_order_id: s.work_order_id,
      depot_id: s.depot_id,
      start_day: s.start_day ?? null,
      materials: s.materials ?? [],
    });
  }

  // ⚠️ ETT FÖRSLAG FÅR ALDRIG SE KOMPLETT UT NÄR DET INTE ÄR DET. Bortfallet räknas EFTER loopen,
  // inte i den: att ett segment saknar depå säger ingenting så länge jobbet har ett annat segment
  // som har en. Ett jobb är uteslutet först när INGET av dess segment löste en depå.
  const excluded: DemandExclusion[] = [];
  for (const id of candidates) {
    if (!seen.has(id)) {
      excluded.push({ work_order_id: id, reason: 'no_depot' });
    }
  }
  for (const p of picked) {
    // ⚠️ FRÅGAN ÄR OM MATERIALET ÄR KÄNT, INTE OM DET FINNS BEHOV KVAR. Villkoret löd förut
    // `sacks > 0`, vilket gjorde varje FÄRDIGBLÅST jobb till ett no_material-fynd: kortet skrev
    // "kunde inte räknas — inget material gick att härleda ur artikelnamnen" och påstod att
    // siffrorna var för låga, för jobb vars behov korrekt var noll. En lista med falsklarm blir
    // inte läst, och då är den värdelös också för de riktiga fynden.
    if (!p.materials.some((m) => m.material)) {
      excluded.push({ work_order_id: p.work_order_id, reason: 'no_material' });
      continue;
    }
    // Ett jobb utan behov kvar behöver ingen dag — det är redovisat och färdigt, inte utelämnat.
    if (!p.start_day && p.materials.some((m) => m.material && m.sacks > 0)) {
      excluded.push({ work_order_id: p.work_order_id, reason: 'no_date' });
    }
  }

  return { picked, excluded };
}

/**
 * Pure: planned-demand rows per open work order, attributed to the first segment (in the given
 * order) that resolves to a depot. Det som återstår att blåsa vid DEN depån blir raderna — noll
 * rader är ett giltigt svar och betyder att jobbet är redovisat och färdigt.
 *
 * ⚠️ A work order counts as seen only once it has actually been counted. Marking it seen before the
 * depot check — which is what this did — meant a job whose first segment sat on a truck with no
 * depot was dropped entirely, and the dedup then skipped its remaining segments too. The demand
 * silently vanished and the shortfall banner stayed quiet. Splitting a job across two trucks is a
 * normal move on the board ("Kopiera till bil"), so this was reachable.
 *
 * ⚠️ Genomfallningen gäller BARA depålösheten. Ett tomt materialbehov fick en gång samma
 * behandling, och då flyttades ett färdigblåst jobbs behov till nästa depå — se kommentaren i
 * loopen.
 *
 * ⚠️ EN RAD PER MATERIAL, inte per arbetsorder. Dedupen gäller fortfarande jobbet — ett jobb över
 * flera segment räknas en gång — men det jobbet kan mycket väl behöva två material ur samma depå.
 * Att lägga hela säckantalet på orderns första material (vilket det här gjorde) lämnade det andra
 * materialet utan planerat behov, och i materialbeställningen är materialet dessutom det som väljer
 * fabrik.
 */
export function attributePlannedDemand(segments: PlannedDemandSegment[]): StockRow[] {
  // Urvalet bor i pickDemandSegments — samma rader som prognosen räknar på. Den här funktionen
  // gör bara om dem till tidlösa saldorader: den kastar datumet, vilket är precis skillnaden
  // mellan "hur mycket fattas" och "när tar det slut".
  return pickDemandSegments(segments).picked.flatMap((p) =>
    p.materials
      .filter((d) => d.material && d.sacks > 0)
      .map((d) => ({ depot_id: p.depot_id, material: d.material, sacks: d.sacks })),
  );
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
  truckDepot: Map<string, string | null>,
): Promise<{ segments: PlannedDemandSegment[]; error: ReadError }> {

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
  // Portionerna är oberoende och körs parallellt: rutten hämtas om av varje planerare vid varje
  // realtime-ping, så en serie väntetider staplade på varandra märks. Ordningen mellan portionerna
  // spelar ingen roll — sorteringen nedan återställer den ändå, och det är den som avgör vilken
  // depå ett splittat jobb bokas mot.
  const chunkResults = await Promise.all(
    chunkIds([...woById.keys()]).map((chunk) =>
      readAllPages<Record<string, any>>((from, to) =>
        supabase
          .from('ops_segments')
          .select('id, work_order_id, truck_id, start_day')
          .in('work_order_id', chunk)
          .order('start_day', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  );
  const failedChunk = chunkResults.find((r) => r.error);
  if (failedChunk?.error) return { segments: [], error: failedChunk.error };
  const segs = chunkResults.flatMap((r) => r.rows);

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
      // Redan hämtad — sorteringen som avgör vilket segment som vinner bygger på den. Nu bärs den
      // också vidare, för prognosen behöver veta VILKEN DAG behovet infaller.
      start_day: (s.start_day as string | null) ?? null,
    }];
  });
  return { segments, error: null };
}

/**
 * Saldot OCH den tidsfasade prognosen ur EN läsning.
 *
 * ⚠️ EN LÄSNING, INTE TVÅ. Att låta prognosen läsa om allt själv vore att öppna för att de två
 * beskriver olika ögonblick: en rapport skriven mellan läsningarna hade sänkt saldot i den ena och
 * inte i den andra, och då säger banderollen och prognoskortet olika saker om samma depå på samma
 * skärm. Samma regel som redan gäller mellan förbrukningen och avdraget.
 *
 * Prognosen tillför tre saker utöver saldot: datumet på behovet, de väntade leveranserna som
 * inflöde, och leverantörens LEDTID. Pallstorleken hämtas inte här — den hör till materialet
 * (sacksPerPalletFor) och läses av prognosmodulen själv.
 *
 * Failar stängt, som getDepotStock: "kunde inte räkna" är ett svar, "behöver 0 säck" är en lögn —
 * och den lögnen ska snart få fylla i en beställning till fabriken.
 */
export async function getDepotStockWithForecast(
  supabase: SupabaseClient,
  today: string,
): Promise<{ data: DepotBalance[]; forecast: DepotForecast | null; error: { message: string } | null }> {
  const { data: depotRows, error } = await supabase.from('ops_depots').select('id, name').order('name', { ascending: true });
  if (error) return { data: [], forecast: null, error };
  const depots = ((depotRows ?? []) as { id: string; name: string }[]);

  const { data: trucks, error: truckError } = await supabase.from('ops_trucks').select('id, depot_id');
  if (truckError) return { data: [], forecast: null, error: truckError };
  const truckDepot = new Map(
    ((trucks ?? []) as Array<Record<string, any>>).map((t) => [t.id as string, (t.depot_id as string | null) ?? null]),
  );

  const [delivered, consumption, demand, expected, suppliers, stockCounts] = await Promise.all([
    listDeliveryRows(supabase),
    deriveConsumptionRows(supabase, truckDepot),
    derivePlannedDemandSegments(supabase, truckDepot),
    listOpenExpected(supabase),
    listSupplyTerms(supabase),
    listStockCounts(supabase),
  ]);

  // ⚠️ Räkningarna failar stängt som resten. Faller den läsningen bort räknas varje avstämd depå om
  // över all tid — alltså tillbaka till fantomsaldot avstämningen fanns för att ersätta, och utan att
  // något syns. Ett fel är ett svar; ett tyst återfall till gamla siffror är det inte.
  const readError =
    delivered.error ?? consumption.error ?? demand.error ?? expected.error ?? suppliers.error ?? stockCounts.error;
  if (readError) return { data: [], forecast: null, error: readError };

  // Avstämningen: stryk rörelser som redan syns i en räkning, och lägg räkningen som baslinje. SAMMA
  // karta till båda stegen — se varningen vid computeDepotBalances om vad som händer annars.
  const counts = latestCounts(stockCounts.data);
  // Leveranser har ingen supersede-regel, så där räcker ett datumfilter.
  const deliveredAfter = movementsAfterCounts(delivered.rows, counts);
  // 🧨 Förbrukningen går INTE via samma datumfilter. En egenkontroll ersätter delrapporterna och bär
  // sitt EGET datum, så ett filter hade dragit av hela jobbet efter räkningen. Se consumptionAfterCounts.
  const consumedAfter = consumptionAfterCounts(consumption.raw, truckDepot, counts);

  const adjusted = applyReportedToDemand(demand.segments, consumption.reported);
  const { picked, excluded } = pickDemandSegments(adjusted);

  const balances = computeDepotBalances(
    depots,
    deliveredAfter,
    consumedAfter,
    // Det PLANERADE behovet påverkas INTE av räkningen, med flit. Säckar som blåsts före räkningen är
    // redan borta ur det räknade antalet OCH redan avdragna ur behovet (applyReportedToDemand) — de
    // finns alltså varken i saldot eller i det som återstår att blåsa. Invarianten från etapp 0
    // ("varje säck ur planned måste också ur balance") håller.
    picked.flatMap((p) =>
      p.materials.filter((m) => m.material && m.sacks > 0).map((m) => ({ depot_id: p.depot_id, material: m.material, sacks: m.sacks })),
    ),
    counts,
  );

  // Ingångssaldot är EXAKT samma tal som saldovyn visar — härlett, inte omräknat. Räknades det om
  // ur råa rader här skulle prognosen kunna säga något annat än tabellen bredvid den.
  const opening: StockRow[] = balances.flatMap((d) =>
    d.rows.map((r) => ({ depot_id: d.depot_id, material: r.material, sacks: r.balance })),
  );

  const forecastDemand: ForecastEvent[] = picked.flatMap((p) =>
    // Utan startdag kan raden inte placeras på en dag. Den räknas ändå i saldot ovan, och
    // pickDemandSegments har redan lagt jobbet i `excluded` — så bortfallet är redovisat, inte tyst.
    p.start_day
      ? p.materials
          .filter((m) => m.material && m.sacks > 0)
          .map((m) => ({ depot_id: p.depot_id, material: m.material, sacks: m.sacks, day: p.start_day as string }))
      : [],
  );

  // Väntade leveranser är inflödet. De rör ALDRIG saldot ovan — det är beställningsspårets
  // kärninvariant — men prognosen ska veta att materialet är på väg.
  const inflow: ForecastEvent[] = expected.data.map((e) => ({
    depot_id: e.depot_id,
    material: e.material,
    sacks: e.sacks,
    day: e.expected_on,
  }));

  // LEDTIDEN per depå+material, från den leverantör som skulle få ordern. Pallstorleken ligger
  // INTE här — den hör till materialet (sacksPerPalletFor), inte till fabriken.
  //
  // 🧨 LÄSS VIA planning_supply_terms, INTE UR TABELLEN. ops_material_suppliers SELECT kräver
  // planning.depot.manage medan den här rutten grindar på planning.schedule.read — och RLS NEKAR
  // INTE, den filtrerar. För sales och konsult kom noll rader tillbaka UTAN FEL, och prognosen föll
  // tyst tillbaka på ingen ledtid. Mätt: admin fick "beställ senast 23/9", sales fick 30/9 på samma
  // data. RPC:n bär bara de ofarliga fälten; adress och kontaktperson stannar bakom sin grind.
  //
  // ⚠️ Är valet TVETYDIGT (flera aktiva leverantörer av materialet) saknas posten med flit —
  // defaultSupplierForMaterial gissar aldrig mellan två fabriker. Följden är supply_known: false
  // och INGET föreslaget datum. Att i stället falla tillbaka på ledtid 0 gav run-out-dagen själv,
  // alltså ett SENARE datum som såg ut som ett svar.
  // ⚠️ ÖVER UNIONEN AV ALLA PAR PROGNOSEN KAN RETURNERA, inte bara saldoraderna. Prognosen skapar en
  // cell för varje depå+material som har NÅGON rörelse — och en väntad leverans av ett material som
  // depån aldrig haft är just ett sådant par. Byggdes kartan bara ur saldot saknade den posten,
  // supply_known blev false och raden tappade både ledtid och avrundning, tyst.
  // Paret bärs som DATA, inte som en kodad sträng att plocka isär igen: supplyKey är envägs med
  // flit, och att avkoda den hade lagt en andra tolkning av nyckeln bredvid den enda som ska finnas.
  const pairs = new Map<string, { depotId: string; material: string }>();
  const addPair = (depotId: string, material: string) => pairs.set(supplyKey(depotId, material), { depotId, material });
  for (const b of balances) for (const r of b.rows) addPair(b.depot_id, r.material);
  for (const e of forecastDemand) addPair(e.depot_id, e.material);
  for (const e of inflow) addPair(e.depot_id, e.material);

  const supply = new Map<string, { leadTimeDays: number }>();
  for (const [key, pair] of pairs) {
    const s = defaultSupplierForMaterial(suppliers.data, pair.material);
    if (s) supply.set(key, { leadTimeDays: s.lead_time_days });
  }

  return {
    data: balances,
    forecast: forecastDepotRunOut({ depots, opening, demand: forecastDemand, inflow, today, supply, excluded }),
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
