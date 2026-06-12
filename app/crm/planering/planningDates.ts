// Pure date helpers for the planning board (week + month). No Date.now() inside — callers pass
// the reference date — so the building functions are deterministic and unit-testable.

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
