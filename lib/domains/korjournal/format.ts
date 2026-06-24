// Pure date/number formatting helpers for the körjournal feature (sv-SE).

export function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

// Local YYYY-MM-DD for a given date (defaults to today).
export function todayISO(date: Date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "2026-04" -> "april 2026" (falls back to the raw key on bad input).
export function formatMonthLabel(ym: string) {
  const [yearRaw, monthRaw] = ym.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return ym;
  return new Date(year, month - 1, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
}

// "2026-04-07" -> "tors 7 apr. 2026" (falls back to the raw string on bad input).
export function formatTripDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
