import { isoDayNumber, isoFromDayNumber } from './timezone';

// Fördelning av ett jobbs värde över de dagar det faktiskt är planerat att utföras.
//
// ── PROBLEMET ───────────────────────────────────────────────────────────────
// Tavlan och insikterna svarade på frågan "vad omsätter bilen den här veckan" genom att lägga HELA
// arbetsorderns värde på varje vecka jobbet råkade vara öppet (WeekBoard, egen dedup per
// veckoinstans) respektive på den vecka det började (insights, dedup mot första segmentet). Ett
// jobb värt en miljon som pågår i fem veckor visade alltså fem miljoner på tavlan och en miljon på
// startveckan i insikterna — två vyer, två svar, båda fel.
//
// ── REGELN, EN MENING ───────────────────────────────────────────────────────
// Ett SCOPES värde delas över dess planerade dagar; täcker flera placeringar samma dag delas den
// dagens andel mellan dem.
//
// Ett "scope" är det som ska utföras: en arbetsorder, eller — när ordern delats upp — en etapp av
// den. Modulen känner inte till etapper; den tar emot ett värde och ett antal spann och bryr sig
// inte om var värdet kom ifrån. Det är därför steg 2 kan rätta veckosiffrorna innan etapper finns.
//
// 🧨 NÄMNAREN ÄR DISTINKTA DAGAR, INTE PLACERING-DAGAR. Alternativet — summera dagarna över alla
// placeringar, så att två bilar på samma dag ger nämnaren 2 — gör att en tillagd bil på EN dag
// ändrar värdet på jobbets ÖVRIGA dagar. Veckan före hade då rört sig av att någon la till en bil
// veckan efter. Med distinkta dagar beror dagens värde bara på jobbets spann, och delningen
// påverkar bara den dag den gäller.
//
// 🧨 FÖNSTERFÄLLAN. Anroparen måste skicka in scopets ALLA placeringar, inte bara de som råkar
// ligga i det fönster som ritas. listSegments och getPlanningInsights läser bara segment som
// överlappar det efterfrågade intervallet; används de som nämnare får ett jobb som sträcker sig
// utanför fönstret för hög andel i den synliga veckan — exakt den uppblåsning den här modulen
// finns för att döda, fast tyst och bara vid fönsterkanten. Se listScopeSpans i schedule.ts.

/** En placering: ett dagsspann på en bil. */
export type SpreadSpan = {
  segment_id: string;
  truck_id: string;
  start_day: string;
  end_day: string;
};

/** Ett scopes värde. Säckar och kronor fördelas med samma vikter men avrundas olika. */
export type SpreadValue = { revenue: number; sacks: number };

/** Vad en enskild placering bär en enskild dag. */
export type DailyShare = {
  segment_id: string;
  truck_id: string;
  day: string;
  revenue: number;
  sacks: number;
};

/**
 * Vilka dagar som räknas som planerade i ett spann.
 *
 * `working` — måndag till fredag. Besättningen blåser inte på helgen, så ett spann tors–tis är
 *   fyra arbetsdagar, inte sex kalenderdagar, och veckorna delar 2/2 i stället för 4/2.
 * `calendar` — varje dag i spannet.
 *
 * ⚠️ RÖDA DAGAR RÄKNAS SOM ARBETSDAGAR. holidays.ts vet vilka de är, men att väga in dem gör
 * nämnaren beroende av en kalender som sträcker sig olika långt fram olika år — och en julvecka
 * skulle då flytta kronor till veckorna omkring sig utan att någon planerat om. Egen fråga.
 */
export type PlannedDayMode = 'working' | 'calendar';

export const DEFAULT_PLANNED_DAY_MODE: PlannedDayMode = 'working';

function isWorkingDay(dayNumber: number): boolean {
  // Dygn 0 (1970-01-01) var en torsdag → mån = 4, ..., lör = 2, sön = 3 i mod 7.
  const dow = ((dayNumber % 7) + 7) % 7;
  return dow !== 2 && dow !== 3;
}

/**
 * De planerade dagarna i ett spann, som ISO-datum, kronologiskt.
 *
 * Tomt spann eller oläsbara datum ger en tom lista. Ligger spannet HELT på en helg faller den
 * tillbaka på kalenderdagar — annars hade nämnaren blivit noll och hela jobbets värde försvunnit
 * ur veckan. En lördagsplacering är ovanlig, men den ska omsätta något.
 */
export function plannedDays(span: { start_day: string; end_day: string }, mode: PlannedDayMode = DEFAULT_PLANNED_DAY_MODE): string[] {
  const start = isoDayNumber(span.start_day);
  const end = isoDayNumber(span.end_day);
  if (start === null || end === null || end < start) return [];

  const all: number[] = [];
  for (let d = start; d <= end; d++) all.push(d);

  if (mode === 'calendar') return all.map(isoFromDayNumber);
  const working = all.filter(isWorkingDay);
  return (working.length > 0 ? working : all).map(isoFromDayNumber);
}

/** Antal planerade dagar i ett spann. */
export function plannedDayCount(span: { start_day: string; end_day: string }, mode: PlannedDayMode = DEFAULT_PLANNED_DAY_MODE): number {
  return plannedDays(span, mode).length;
}

/**
 * Dela ett belopp på vikter så att summan av delarna är EXAKT det avrundade beloppet.
 *
 * 🧨 KUMULATIV DIFFERENS, INTE AVRUNDNING PER DEL. Avrundas varje del för sig blir 1 000 000 kr
 * över tre lika veckor 3 × 333 333,33 = 999 999,99, och en miljon har tappat ett öre någonstans
 * mellan tavlan och Insikter. Här avrundas i stället den LÖPANDE SUMMAN, och varje del är
 * skillnaden mot föregående löpande summa. Sista delen bär resten per konstruktion.
 */
function distribute(value: number, weights: number[], round: (n: number) => number): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return weights.map(() => 0);

  let carriedWeight = 0;
  let carried = 0;
  return weights.map((w) => {
    carriedWeight += w;
    const upTo = round((value * carriedWeight) / total);
    const part = upTo - carried;
    carried = upTo;
    return part;
  });
}

const roundOre = (n: number) => Math.round(n * 100) / 100;
const roundWhole = (n: number) => Math.round(n);

/**
 * Fördela ett scopes värde över dess placeringars planerade dagar.
 *
 * Returnerar en rad per (placering, dag) med kronor och säckar. Summan av alla rader är exakt
 * `value.revenue` (till öret) respektive `Math.round(value.sacks)`.
 *
 * ⚠️ `spans` måste vara scopets ALLA placeringar — se fönsterfällan i modulhuvudet.
 */
export function spreadScopeAcrossSpans(
  value: SpreadValue,
  spans: SpreadSpan[],
  mode: PlannedDayMode = DEFAULT_PLANNED_DAY_MODE,
): DailyShare[] {
  // Dag → placeringarna som täcker den. Sorterad ordning gör utfallet deterministiskt: samma
  // indata ger samma öre på samma bil, oavsett i vilken ordning läsningen råkade returnera dem.
  const byDay = new Map<string, string[]>();
  const spanById = new Map<string, SpreadSpan>();
  for (const span of [...spans].sort((a, b) => a.segment_id.localeCompare(b.segment_id))) {
    if (spanById.has(span.segment_id)) continue; // samma placering två gånger är inte två placeringar
    spanById.set(span.segment_id, span);
    for (const day of plannedDays(span, mode)) {
      const list = byDay.get(day);
      if (list) list.push(span.segment_id);
      else byDay.set(day, [span.segment_id]);
    }
  }
  if (byDay.size === 0) return [];

  // En plats per (dag, placering). Vikten är 1/antal placeringar som täcker dagen, så varje DAG
  // väger 1 oavsett hur många bilar som delar på den.
  const slots: Array<{ day: string; segment_id: string; weight: number }> = [];
  for (const day of [...byDay.keys()].sort()) {
    const segmentIds = byDay.get(day) as string[];
    for (const segment_id of segmentIds) {
      slots.push({ day, segment_id, weight: 1 / segmentIds.length });
    }
  }

  const weights = slots.map((s) => s.weight);
  const revenues = distribute(value.revenue, weights, roundOre);
  const sacks = distribute(value.sacks, weights, roundWhole);

  return slots.map((slot, i) => ({
    segment_id: slot.segment_id,
    truck_id: (spanById.get(slot.segment_id) as SpreadSpan).truck_id,
    day: slot.day,
    revenue: revenues[i],
    sacks: sacks[i],
  }));
}
