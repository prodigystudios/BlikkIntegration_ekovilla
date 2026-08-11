import { swedishHolidayKind, type SwedishHolidayKind } from '../planning/holidays';

// Klassificering av ett arbetspass till redovisningshinkar.
//
// ⚠️ DET HÄR RÄKNAR INTE LÖN. Det delar upp arbetade minuter på dag / kväll / natt / helg / röd dag
// så lönebyrån kan tillämpa avtalet. En felräknad OB-regel blir felaktig lön, och avtal ändras utan
// att koden gör det — därför redovisar vi timmarna och låter byrån äga reglerna. Gränserna nedan är
// REDOVISNINGSgränser, inte OB-intervall: ändras de ändras bara hur timmarna presenteras.
//
// Rent och utan sidoeffekter, ingen Date.now() — anroparen skickar in datumet — så funktionen är
// deterministisk och testbar. Samma mönster som lib/domains/crm/reports.ts och planningDates.ts.

export const REPORTING_BOUNDARIES = {
  dayStart: 6 * 60,      // 06:00
  eveningStart: 18 * 60, // 18:00
  nightStart: 23 * 60,   // 23:00
} as const;

export type TimeBucket = 'day' | 'evening' | 'night' | 'weekend' | 'holiday' | 'unclassified';

export const TIME_BUCKETS: TimeBucket[] = ['day', 'evening', 'night', 'weekend', 'holiday', 'unclassified'];

export type BucketMinutes = Record<TimeBucket, number>;

export type ShiftInput = {
  /** 'YYYY-MM-DD'. Äger raden: perioden och attesten följer det här datumet, inte klockan. */
  workDate: string;
  /** 'HH:MM'. Saknas den hamnar allt i `unclassified`. */
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  /** Används BARA när klockslag saknas (gamla kontorsrader som bara har timmar). */
  minutesWorked?: number | null;
};

export type ClassifiedDay = {
  date: string;
  minutes: number;
  buckets: BucketMinutes;
  holiday: SwedishHolidayKind | null;
};

export type ClassifiedShift = {
  /** Efter rastavdrag. Hinkarna summerar EXAKT till det här — det är en testad invariant. */
  totalMinutes: number;
  buckets: BucketMinutes;
  /** Informativ uppdelning för pass som passerar midnatt. Perioden styrs ändå av workDate. */
  perDay: ClassifiedDay[];
};

export function emptyBuckets(): BucketMinutes {
  return { day: 0, evening: 0, night: 0, weekend: 0, holiday: 0, unclassified: 0 };
}

export function addBuckets(a: BucketMinutes, b: BucketMinutes): BucketMinutes {
  const out = emptyBuckets();
  for (const bucket of TIME_BUCKETS) out[bucket] = a[bucket] + b[bucket];
  return out;
}

// 'HH:MM' (eller 'HH:MM:SS', som Postgres `time` serialiseras till) → minuter efter midnatt.
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Hinkarna är ÖMSESIDIGT UTESLUTANDE med fast företräde: holiday > weekend > night > evening > day.
// En lördag 20:00 är alltså `weekend`, inte `evening`. Det är vad som garanterar att hinkarna
// summerar till totalen och att ingen minut dubbelräknas. Behöver byrån "OB2 på lördagskväll" går
// det att härleda ur perDay + veckodag; en finare hink är additiv och rör inte lagringen.
//
// Både röd dag och de-facto-afton hamnar i `holiday` — att jobba på julafton får inte se ut som en
// vanlig tisdag. VILKEN sorts dag det var syns per dag i ClassifiedDay.holiday, så byrån kan skilja
// dem åt utan att vi tolkar avtalet åt dem.
export function bucketFor(iso: string, minuteOfDay: number): TimeBucket {
  if (swedishHolidayKind(iso) !== null) return 'holiday';
  if (isWeekend(iso)) return 'weekend';
  if (minuteOfDay < REPORTING_BOUNDARIES.dayStart || minuteOfDay >= REPORTING_BOUNDARIES.nightStart) return 'night';
  if (minuteOfDay >= REPORTING_BOUNDARIES.eveningStart) return 'evening';
  return 'day';
}

type Segment = { date: string; bucket: TimeBucket; gross: number };

// Delar bruttopasset i sammanhängande bitar med samma dag och samma hink. Passet delas FÖRST vid
// midnatt, sedan klassificeras varje dygnsbit för sig — annars skulle en natt över ett veckoslut
// hamna fel.
function splitIntoSegments(workDate: string, startMin: number, endMin: number): Segment[] {
  const segments: Segment[] = [];
  // end <= start betyder att passet passerade midnatt. Ingen extra kolumn behövs för det.
  const grossMinutes = endMin > startMin ? endMin - startMin : 1440 - startMin + endMin;

  let cursor = startMin;
  let dayOffset = 0;
  let remaining = grossMinutes;

  while (remaining > 0) {
    const date = shiftDate(workDate, dayOffset);
    const bucket = bucketFor(date, cursor);
    const minutesLeftToday = 1440 - cursor;

    // Hur länge håller den här hinken? Gå framåt minut för minut bara vid gränserna — vi vet var de
    // ligger, så det räcker att kolla nästa gränsövergång.
    let runLength = 1;
    while (
      runLength < minutesLeftToday
      && runLength < remaining
      && bucketFor(date, cursor + runLength) === bucket
    ) {
      runLength += 1;
    }

    const take = Math.min(runLength, remaining, minutesLeftToday);
    const last = segments[segments.length - 1];
    if (last && last.date === date && last.bucket === bucket) last.gross += take;
    else segments.push({ date, bucket, gross: take });

    remaining -= take;
    cursor += take;
    if (cursor >= 1440) {
      cursor = 0;
      dayOffset += 1;
    }
  }

  return segments;
}

// Fördelar nettotiden (efter rast) proportionellt över segmenten med största-rest-metoden, så
// summan blir EXAKT netto — aldrig en minut för mycket eller för lite av avrundning.
//
// Rasten dras proportionellt för att vi inte samlar in NÄR den togs. Varje "smart" regel (dra den
// från dagtid, från den längsta hinken, från mitten) vore en gissning som ändrar lön. Proportionellt
// är det enda försvarbara utan mer data; behöver byrån bättre får vi börja fråga efter rastens
// klockslag.
function allocateNet(segments: Segment[], netMinutes: number): number[] {
  const gross = segments.reduce((sum, segment) => sum + segment.gross, 0);
  if (gross <= 0 || netMinutes <= 0) return segments.map(() => 0);

  const exact = segments.map((segment) => (netMinutes * segment.gross) / gross);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = netMinutes - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value), gross: segments[index].gross }))
    // Störst rest först; vid lika rest vinner det största segmentet, så resultatet är deterministiskt.
    .sort((a, b) => b.fraction - a.fraction || b.gross - a.gross || a.index - b.index);

  const allocated = [...floors];
  for (const item of order) {
    if (remainder <= 0) break;
    allocated[item.index] += 1;
    remainder -= 1;
  }
  return allocated;
}

export function classifyShift(input: ShiftInput): ClassifiedShift {
  const startMin = parseClock(input.startTime);
  const endMin = parseClock(input.endTime);
  const holiday = swedishHolidayKind(input.workDate);

  // Utan klockslag går passet inte att placera på dygnet. Det blir `unclassified` — synligt, inte
  // gissat — och löneexporten vägrar köra så länge hinken har minuter i sig. Fail loud.
  if (startMin === null || endMin === null) {
    const minutes = Math.max(0, Math.round(input.minutesWorked ?? 0));
    const buckets = emptyBuckets();
    buckets.unclassified = minutes;
    return {
      totalMinutes: minutes,
      buckets,
      perDay: [{ date: input.workDate, minutes, buckets, holiday }],
    };
  }

  const segments = splitIntoSegments(input.workDate, startMin, endMin);
  const gross = segments.reduce((sum, segment) => sum + segment.gross, 0);
  const breakMinutes = Math.max(0, Math.round(input.breakMinutes || 0));
  const net = Math.max(0, gross - breakMinutes);
  const allocated = allocateNet(segments, net);

  const buckets = emptyBuckets();
  const perDayMap = new Map<string, ClassifiedDay>();

  segments.forEach((segment, index) => {
    const minutes = allocated[index];
    buckets[segment.bucket] += minutes;

    let day = perDayMap.get(segment.date);
    if (!day) {
      day = { date: segment.date, minutes: 0, buckets: emptyBuckets(), holiday: swedishHolidayKind(segment.date) };
      perDayMap.set(segment.date, day);
    }
    day.minutes += minutes;
    day.buckets[segment.bucket] += minutes;
  });

  return {
    totalMinutes: net,
    buckets,
    perDay: [...perDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
