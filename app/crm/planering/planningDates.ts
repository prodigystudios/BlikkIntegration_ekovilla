// Pure date helpers for the planning board (week + month). The building functions take their
// reference date as an argument — no clock inside — so they stay deterministic and unit-testable.
//
// The one clock read the board needs is stockholmToday/stockholmTodayISO, which live in the domain
// (lib/domains/planning/timezone) because the insights route needs the same anchor. Re-exported
// here so the board keeps importing all its date helpers from one place.
export { stockholmToday, stockholmTodayISO } from '@/lib/domains/planning/timezone';

export const WEEKDAYS_SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

export function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDaysISO(iso: string, n: number): string {
  return fmtISO(addDays(parseISO(iso), n));
}

// Inclusive day span between two ISO dates (same day = 1).
export function daysBetweenInclusive(startISO: string, endISO: string): number {
  const ms = parseISO(endISO).getTime() - parseISO(startISO).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

// Monday of the week containing d.
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}

// The Monday that starts a month's stack in the "Hela månaden" view: the first Monday that falls
// INSIDE the month, not startOfWeek(the 1st).
//
// The board stacks weeks from its start Monday to the end of that Monday's month, so anchoring
// inside the month makes consecutive months tile exactly — the previous month's last week already
// carries the spill-over days. Anchoring on startOfWeek(the 1st) instead would double-show that
// straddling week, and can resolve back to the Monday you are already on (making a "next month"
// press do nothing).
//
// `monthDelta` steps whole months from `ref`'s month; the Date constructor normalises overflow, so
// December +1 rolls into January. Stepping by month rather than by the current stack's week count
// keeps forward and back exact inverses — stack widths differ between months (4 or 5 Mondays), and
// stepping back by the destination's width skips a week and makes it unreachable.
export function monthStackStart(ref: Date, monthDelta: number): Date {
  const first = new Date(ref.getFullYear(), ref.getMonth() + monthDelta, 1);
  const monday = startOfWeek(first);
  return monday.getMonth() === first.getMonth() ? monday : addDays(monday, 7);
}

// Whole weeks between two Mondays, signed. Counts days and rounds before dividing rather than
// dividing the raw millisecond span: Stockholm's DST weeks are 167 or 169 hours, so a straight
// ms division returns 0.994 or 1.006 instead of 1.
export function weeksBetweenMondays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) / 7;
}

// Where the board's bottom pager lands from `weekMonday`, stepping one section in `dir`.
//
// Forward is the next month's stack start. Sections tile, so that Monday is exactly the one after
// the current stack's last week — nothing skipped, nothing repeated.
//
// Backwards behaves like a track-skip button. The header's ‹ › step a single week, so you are
// often standing mid-stack — indeed the default landing state usually is, since today's Monday is
// rarely the month's first. The first press then returns to the start of the stack you are in;
// only from the stack start does it move to the previous month. Jumping a full month straight from
// mid-stack would skip every week between the stack's start and where you stood, and leave those
// weeks unreachable from the pager entirely.
export function sectionStart(weekMonday: Date, dir: -1 | 1): Date {
  if (dir === 1) return monthStackStart(weekMonday, 1);
  const currentStart = monthStackStart(weekMonday, 0);
  return weekMonday.getTime() > currentStart.getTime() ? currentStart : monthStackStart(weekMonday, -1);
}

// ISO-8601 week number.
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

export type WeekDay = { iso: string; date: Date; weekday: string; dayLabel: string; isWeekend: boolean };

export function buildWeekDays(monday: Date): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return {
      iso: fmtISO(date),
      date,
      weekday: WEEKDAYS_SHORT[i],
      dayLabel: `${date.getDate()}/${date.getMonth() + 1}`,
      isWeekend: i >= 5,
    };
  });
}

export type MonthDayCell = { iso: string; day: number; inMonth: boolean; isWeekend: boolean };
export type MonthWeek = { weekNo: number; days: MonthDayCell[] };

// Calendar weeks (Mon-start) covering the month that `ref` falls in, including spill-over days
// from the adjacent months to fill the grid.
export function buildMonthWeeks(ref: Date): MonthWeek[] {
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const lastOfMonth = new Date(year, month + 1, 0);
  let cur = startOfWeek(new Date(year, month, 1));
  const weeks: MonthWeek[] = [];

  while (true) {
    const weekStart = cur;
    const days: MonthDayCell[] = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return { iso: fmtISO(d), day: d.getDate(), inMonth: d.getMonth() === month, isWeekend: i >= 5 };
    });
    weeks.push({ weekNo: isoWeek(weekStart), days });
    cur = addDays(cur, 7);
    if (cur > lastOfMonth) break;
  }
  return weeks;
}

export function swedishMonthYear(d: Date): string {
  const s = d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
