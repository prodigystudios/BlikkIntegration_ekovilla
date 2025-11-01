// Shared date and ISO week helpers for planning UI

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// Local-time ISO date to avoid UTC shift issues
export function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoWeekNumber(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // Mon=0
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

export function isoWeekYear(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // Mon=0
  target.setDate(target.getDate() - dayNr + 3);
  return target.getFullYear();
}

export function isoWeekKey(dateStr: string) {
  const y = isoWeekYear(dateStr);
  const w = isoWeekNumber(dateStr);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export function startOfIsoWeek(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayNr = (d.getDay() + 6) % 7; // Mon=0
  const start = new Date(d);
  start.setDate(start.getDate() - dayNr);
  return start;
}

export function endOfIsoWeek(dateStr: string) {
  const start = startOfIsoWeek(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

export function mondayFromIsoWeekKey(key: string): Date | null {
  const m = key.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  const jan4 = new Date(year, 0, 4);
  const dayNr = (jan4.getDay() + 6) % 7; // Mon=0
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dayNr);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return monday;
}
