import { effectiveSackReports, type SackLedgerRow } from './sackLedger';
import { swedishHoliday } from './holidays';

// Produktionsutfallet för en period: vad som FAKTISKT blåstes, per månad, material och bil, plus
// hur många av periodens arbetsdagar varje bil var bokad. Rent och sidoeffektfritt — all I/O ligger
// hos anroparen.
//
// Det här är första gången utfallet syns någonstans utanför den enskilda arbetsordern. Planeringens
// insikter (insights.ts) svarar på vad som SKA göras; den här modulen svarar på vad som BLEV gjort.
//
// ⚠️ SÄCKBOKENS REGEL GÄLLER HÄR OCKSÅ, och den är inte valfri. En naiv summering av
// ops_segment_reports gav 12 628 säckar där facit är 7 572 — 67 % för högt (mätt mot skarp data
// 2026-09-23). Se sackLedger.ts: finns en final är den jobbets sanning, annars summan av partial.

// ── Indata ───────────────────────────────────────────────────────────────────

export type ProductionReportRow = SackLedgerRow & {
  segment_id: string | null;
  /** Kalenderdag 'YYYY-MM-DD'. */
  report_day: string;
  material?: string | null;
};

export type ProductionSegmentRow = {
  id: string;
  truck_id: string;
  start_day: string;
  end_day: string;
};

export type ProductionTruckRow = { id: string; name: string };

export type ProductionRange = { from: string; to: string };

// ── Utdata ───────────────────────────────────────────────────────────────────

export type ProductionMonthPoint = { period: string; sacks: number };

/** `material: null` = raden saknar material. Gränssnittet skriver "Okänt" — aldrig ett materialnamn. */
export type ProductionMaterialRow = { material: string | null; sacks: number };

export type ProductionTruckStat = {
  truck_id: string;
  truck_name: string;
  sacks: number;
  /** Arbetsdagar i perioden då bilen hade minst ett segment. */
  bookedDays: number;
  /** Andel av periodens arbetsdagar, 0–100. null när perioden saknar arbetsdagar. */
  utilization: number | null;
};

export type Production = {
  totalSacks: number;
  /** Rapportrader som RÄKNAS, alltså efter supersede och inom perioden. */
  reportCount: number;
  /** Arbetsordrar med minst en räknad rad. */
  jobs: number;
  byMonth: ProductionMonthPoint[];
  byMaterial: ProductionMaterialRow[];
  byTruck: ProductionTruckStat[];
  /**
   * Säckar vars segment inte gick att slå upp, och som därför saknas i byTruck.
   *
   * ⚠️ MÅSTE REDOVISAS. Utan den kan totalen och bilstapeln skilja sig åt utan att något ser
   * trasigt ut, och den som summerar staplarna för hand får fel svar än rubriken.
   */
  sacksWithoutTruck: number;
  /** Periodens arbetsdagar — nämnaren i beläggningsgraden. */
  workingDays: number;
  /** Kalkylen kunde inte köras alls — skilt från "inget rapporterat". */
  unavailable: boolean;
};

// ── Kalender ─────────────────────────────────────────────────────────────────

function dayISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Periodens arbetsdagar: måndag–fredag minus svenska röda dagar.
 *
 * ⚠️ HELGER RÄKNAS INTE, och det är mätt snarare än antaget: av 303 segmentdagar i drift ligger
 * NOLL på en helg, och av 160 rapportdagar likaså (2026-09-23). Skulle helgarbete börja förekomma
 * blir beläggningsgraden för låg, inte för hög — den säkra riktningen, och den syns som att bokade
 * dagar aldrig når 100 %.
 *
 * UTC-förankrat: datumen är kalenderdagar utan klockslag, så ingen sommartidsväxling kan flytta en
 * dag. Taket skyddar mot att ett trasigt intervall snurrar.
 */
export function workingDaysInRange(range: ProductionRange): string[] {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  const out: string[] = [];
  for (let ms = from, guard = 0; ms <= to && guard < 4000; ms += 86_400_000, guard++) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const iso = dayISO(ms);
    if (swedishHoliday(iso)) continue;
    out.push(iso);
  }
  return out;
}

/** Arbetsdagarna ett segment täcker, begränsat till perioden. */
function bookedWorkingDays(segment: ProductionSegmentRow, workingDays: Set<string>): string[] {
  const start = Date.parse(`${segment.start_day}T00:00:00Z`);
  const end = Date.parse(`${segment.end_day}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const out: string[] = [];
  for (let ms = start, guard = 0; ms <= end && guard < 400; ms += 86_400_000, guard++) {
    const iso = dayISO(ms);
    if (workingDays.has(iso)) out.push(iso);
  }
  return out;
}

// ── Aggregeringen ────────────────────────────────────────────────────────────

/** Materialnyckeln, normaliserad. Tom sträng räknas som SAKNAT material, inte som ett namn. */
function materialKey(row: ProductionReportRow): string | null {
  const value = (row.material ?? '').trim();
  return value ? value.toUpperCase() : null;
}

export function buildProduction(input: {
  /**
   * ⚠️ ALLA rapportrader för de berörda arbetsordrarna — INTE bara de som ligger i perioden.
   *
   * Supersede-regeln gäller per arbetsorder över hela dess historik. Hämtas bara periodens rader
   * kan en delrapport i perioden se olevande ut fast en egenkontroll utanför perioden redan har
   * ersatt den, och då räknas den två gånger i praktiken: en gång här och en gång i den period där
   * egenkontrollen ligger. Funktionen filtrerar själv ner till perioden EFTER supersede.
   */
  reports: ProductionReportRow[];
  segments: ProductionSegmentRow[];
  trucks: ProductionTruckRow[];
  range: ProductionRange;
  /** Månadsaxeln, 'YYYY-MM'. Fixerad av anroparen så tomma månader ändå ritas. */
  months: string[];
}): Production {
  const workingDayList = workingDaysInRange(input.range);
  const workingDays = new Set(workingDayList);

  // 1) Supersede FÖRST, period SEDAN. Ordningen är hela poängen — se varningen ovan.
  const counted = effectiveSackReports(input.reports).filter(
    (row) => row.report_day >= input.range.from && row.report_day <= input.range.to,
  );

  const segmentById = new Map(input.segments.map((s) => [s.id, s]));
  const truckNames = new Map(input.trucks.map((t) => [t.id, t.name]));

  const monthMap = new Map<string, number>(input.months.map((m) => [m, 0]));
  const materialMap = new Map<string | null, number>();
  const truckSacks = new Map<string, number>();
  const jobIds = new Set<string>();

  let totalSacks = 0;
  let sacksWithoutTruck = 0;

  for (const row of counted) {
    const sacks = Number(row.sacks_blown ?? 0);
    if (!Number.isFinite(sacks)) continue;
    totalSacks += sacks;
    jobIds.add(row.work_order_id);

    const month = row.report_day.slice(0, 7);
    if (monthMap.has(month)) monthMap.set(month, (monthMap.get(month) ?? 0) + sacks);

    const material = materialKey(row);
    materialMap.set(material, (materialMap.get(material) ?? 0) + sacks);

    const segment = row.segment_id ? segmentById.get(row.segment_id) : undefined;
    if (segment) truckSacks.set(segment.truck_id, (truckSacks.get(segment.truck_id) ?? 0) + sacks);
    else sacksWithoutTruck += sacks;
  }

  // 2) Beläggningen räknas ur SEGMENTEN, inte ur rapporterna. En bil som var bokad hela veckan men
  //    vars jobb ännu inte rapporterats ska synas som bokad — beläggning och utfall är två olika
  //    frågor, och att låta den ena tysta den andra hade dolt just de bilar man vill titta på.
  const bookedByTruck = new Map<string, Set<string>>();
  for (const segment of input.segments) {
    let days = bookedByTruck.get(segment.truck_id);
    if (!days) {
      days = new Set<string>();
      bookedByTruck.set(segment.truck_id, days);
    }
    for (const day of bookedWorkingDays(segment, workingDays)) days.add(day);
  }

  const truckIds = new Set<string>([...truckSacks.keys(), ...bookedByTruck.keys()]);
  const byTruck: ProductionTruckStat[] = [...truckIds].map((truckId) => {
    const bookedDays = bookedByTruck.get(truckId)?.size ?? 0;
    return {
      truck_id: truckId,
      truck_name: truckNames.get(truckId) ?? '—',
      sacks: truckSacks.get(truckId) ?? 0,
      bookedDays,
      // Ingen arbetsdag i perioden → beläggningen går inte att räkna. null, aldrig 0 %.
      utilization: workingDayList.length > 0 ? (bookedDays / workingDayList.length) * 100 : null,
    };
  }).sort((a, b) => b.sacks - a.sacks || b.bookedDays - a.bookedDays || a.truck_name.localeCompare(b.truck_name, 'sv'));

  return {
    totalSacks,
    reportCount: counted.length,
    jobs: jobIds.size,
    byMonth: input.months.map((period) => ({ period, sacks: monthMap.get(period) ?? 0 })),
    // Känt material först och störst överst; okänt sist, oavsett storlek — det är en lucka i
    // underlaget, inte ett material som konkurrerar om toppen.
    byMaterial: [...materialMap.entries()]
      .map(([material, sacks]) => ({ material, sacks }))
      .sort((a, b) => {
        if ((a.material === null) !== (b.material === null)) return a.material === null ? 1 : -1;
        return b.sacks - a.sacks;
      }),
    byTruck,
    sacksWithoutTruck,
    workingDays: workingDayList.length,
    unavailable: false,
  };
}

/** Tom produktionsdel — när kalkylen inte gick att köra. Skilt från "inget rapporterat". */
export function unavailableProduction(months: string[], range: ProductionRange): Production {
  return {
    totalSacks: 0,
    reportCount: 0,
    jobs: 0,
    byMonth: months.map((period) => ({ period, sacks: 0 })),
    byMaterial: [],
    byTruck: [],
    sacksWithoutTruck: 0,
    workingDays: workingDaysInRange(range).length,
    unavailable: true,
  };
}
