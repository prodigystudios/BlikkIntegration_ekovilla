import { addBuckets, classifyShift, emptyBuckets, type BucketMinutes, type ShiftInput } from './classify';
import { swedishHolidayKind } from '../planning/holidays';

// Sammanställning av tidrader per person och dag.
//
// ⚠️ ORDINARIE TID RÄKNAS PER PERSON OCH DAG, ALDRIG PER RAD. Två femtimmarsrader samma dag är tio
// timmar varav två utöver ordinarie; en beräkning per rad ger noll. Det är därför summarizeDay är
// enda vägen till "utöver ordinarie" — och därför det finns ett testfall som heter exakt det.
//
// Precis som classify.ts räknar det här INTE lön. `beyondOrdinary` är en redovisningssiffra som
// säger "så här mycket låg över åtta timmar den dagen", inte "så här mycket övertidsersättning".
// Byrån tillämpar avtalet.

// Beslut (William 2026-08-11): 8 h/dag måndag–fredag, lika för alla. Ingen sysselsättningsgrad per
// person finns i systemet, och ska inte uppfinnas här — tröskeln är en redovisningsgräns.
export const ORDINARY_MINUTES_PER_DAY = 480;

export type TimeEntryKind = 'work_order' | 'internal' | 'absence';

export type SummarizableEntry = ShiftInput & {
  kind: TimeEntryKind;
  userId: string;
  /** Lönesorten från referensraden (crm_time_codes / crm_internal_projects / crm_absence_types). */
  payrollCode?: string | null;
  travelKm?: number | null;
  travelToSalary?: boolean | null;
};

export type DaySummary = {
  date: string;
  /** Arbetad tid: arbetsorder + interntid. Frånvaro ingår ALDRIG. */
  workMinutes: number;
  absenceMinutes: number;
  ordinaryMinutes: number;
  beyondOrdinaryMinutes: number;
  buckets: BucketMinutes;
  travelKm: number;
  travelKmToSalary: number;
};

// Helg och röd dag har ingen ordinarie tid att överstiga — allt ligger redan i sin egen hink, och
// att dessutom kalla det "utöver ordinarie" vore att räkna samma timme två gånger i underlaget.
function hasOrdinaryThreshold(date: string): boolean {
  if (swedishHolidayKind(date) !== null) return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function summarizeDay(entries: SummarizableEntry[], date: string): DaySummary {
  const forDay = entries.filter((entry) => entry.workDate === date);

  let workMinutes = 0;
  let absenceMinutes = 0;
  let buckets = emptyBuckets();
  let travelKm = 0;
  let travelKmToSalary = 0;

  for (const entry of forDay) {
    const classified = classifyShift(entry);
    if (entry.kind === 'absence') {
      absenceMinutes += classified.totalMinutes;
    } else {
      workMinutes += classified.totalMinutes;
      // Frånvarons minuter hamnar inte i hinkarna: de är inte arbetad tid, och att lägga sjukdom i
      // "dagtid" hade gjort en sjukdag oskiljbar från en arbetsdag i underlaget.
      buckets = addBuckets(buckets, classified.buckets);
    }
    const km = Number(entry.travelKm ?? 0);
    if (Number.isFinite(km) && km > 0) {
      travelKm += km;
      if (entry.travelToSalary) travelKmToSalary += km;
    }
  }

  // Frånvaro räknas ALDRIG in i tröskeln — man blir inte övertidsberättigad av att vara sjuk.
  const threshold = hasOrdinaryThreshold(date) ? ORDINARY_MINUTES_PER_DAY : 0;
  const ordinaryMinutes = Math.min(workMinutes, threshold);
  const beyondOrdinaryMinutes = Math.max(0, workMinutes - threshold);

  return {
    date,
    workMinutes,
    absenceMinutes,
    ordinaryMinutes,
    beyondOrdinaryMinutes,
    buckets,
    travelKm: Math.round(travelKm * 10) / 10,
    travelKmToSalary: Math.round(travelKmToSalary * 10) / 10,
  };
}

export type PersonPeriodSummary = {
  userId: string;
  from: string;
  to: string;
  days: DaySummary[];
  workMinutes: number;
  absenceMinutes: number;
  ordinaryMinutes: number;
  beyondOrdinaryMinutes: number;
  buckets: BucketMinutes;
  travelKm: number;
  travelKmToSalary: number;
  /** Minuter utan klockslag. Är den > 0 vägrar löneexporten köra — se lib/domains/time/classify.ts. */
  unclassifiedMinutes: number;
};

export function summarizePerson(
  entries: SummarizableEntry[],
  range: { from: string; to: string },
  userId: string,
): PersonPeriodSummary {
  const mine = entries.filter(
    (entry) => entry.userId === userId && entry.workDate >= range.from && entry.workDate <= range.to,
  );

  // Bara dagar som faktiskt har rader. En tom dag är inte information i ett löneunderlag — den fyller
  // bara ut listan — och en person som var ledig hela veckan ska inte ge sju nollrader.
  const dates = [...new Set(mine.map((entry) => entry.workDate))].sort();
  const days = dates.map((date) => summarizeDay(mine, date));

  const total = days.reduce(
    (acc, day) => ({
      workMinutes: acc.workMinutes + day.workMinutes,
      absenceMinutes: acc.absenceMinutes + day.absenceMinutes,
      ordinaryMinutes: acc.ordinaryMinutes + day.ordinaryMinutes,
      beyondOrdinaryMinutes: acc.beyondOrdinaryMinutes + day.beyondOrdinaryMinutes,
      buckets: addBuckets(acc.buckets, day.buckets),
      travelKm: acc.travelKm + day.travelKm,
      travelKmToSalary: acc.travelKmToSalary + day.travelKmToSalary,
    }),
    {
      workMinutes: 0, absenceMinutes: 0, ordinaryMinutes: 0, beyondOrdinaryMinutes: 0,
      buckets: emptyBuckets(), travelKm: 0, travelKmToSalary: 0,
    },
  );

  return {
    userId,
    from: range.from,
    to: range.to,
    days,
    ...total,
    travelKm: Math.round(total.travelKm * 10) / 10,
    travelKmToSalary: Math.round(total.travelKmToSalary * 10) / 10,
    unclassifiedMinutes: total.buckets.unclassified,
  };
}
