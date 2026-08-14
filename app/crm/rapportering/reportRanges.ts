// Date ranges for the reporting filter. Pure and side-effect free — every function takes
// the instant as an argument, so the presets are unit-testable without freezing clocks.
//
// Everything is anchored to Europe/Stockholm rather than to the runtime's own clock.
// ReportsClient is server-rendered before it hydrates, and the server runs on UTC: a
// range derived from local calendar fields would be computed as one day on the server
// and another in the browser between midnight and 02:00 Swedish time — a hydration
// mismatch on the date inputs, and a `defaultFrom` a whole month off on the 1st.
// Pinning the zone makes both sides agree AND makes "today" mean today in Sweden.
//
// (lib/domains/crm/goals.ts has its own week/month helpers for the leaderboard. Those
// read browser-local fields, which is fine for client-only code but not here. The two
// only disagree between 00:00 and 02:00; unifying them is a separate change.)

const REPORT_TIME_ZONE = 'Europe/Stockholm';

const zoneParts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type ReportRangeKey = 'week' | 'month' | 'prevMonth' | 'year' | 'last12';

export type ReportRange = { from: string; to: string };

/**
 * The Swedish calendar date an instant falls on, as a UTC-anchored midnight. Anchoring
 * to UTC keeps the arithmetic below a pure calendar walk — no DST hour to trip over,
 * because these values are never treated as points in time.
 */
export function stockholmDay(now: Date): Date {
  const parts = zoneParts.formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

/** YYYY-MM-DD for a day produced by the helpers here. */
export function dayString(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function addDays(day: Date, days: number): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + days));
}

function startOfMonth(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

/** Monday of the week the day falls in — ISO-8601 / Swedish week start, so Sunday looks back six days. */
export function startOfWeek(day: Date): Date {
  const weekday = day.getUTCDay(); // 0 = Sunday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function today(now: Date = new Date()): string {
  return dayString(stockholmDay(now));
}

/**
 * The ranges behind the quick presets. The open-ended ones end today rather than at the
 * period's calendar end: the report has no future data, and a `to` in the future would
 * exceed the date picker's own max. A period that is already over keeps its real end.
 */
export function reportRange(key: ReportRangeKey, now: Date = new Date()): ReportRange {
  const day = stockholmDay(now);
  const to = dayString(day);
  switch (key) {
    case 'week':
      return { from: dayString(startOfWeek(day)), to };
    case 'month':
      return { from: dayString(startOfMonth(day)), to };
    case 'prevMonth': {
      // Day 0 of this month is the last day of the previous one, which also handles January.
      const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 0));
      return { from: dayString(startOfMonth(last)), to: dayString(last) };
    }
    case 'year':
      return { from: dayString(new Date(Date.UTC(day.getUTCFullYear(), 0, 1))), to };
    case 'last12':
      // Eleven months back to the 1st, so the current month is the twelfth and the
      // monthly chart fills exactly twelve buckets.
      return { from: dayString(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 11, 1))), to };
  }
}

export const REPORT_RANGE_LABELS: Array<[ReportRangeKey, string]> = [
  ['week', 'Denna vecka'],
  ['month', 'Denna månad'],
  ['prevMonth', 'Förra månaden'],
  ['year', 'I år'],
  ['last12', 'Senaste 12 mån'],
];
