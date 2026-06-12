// Swedish public holidays (röda dagar) — pure, no deps. Used to shade holiday columns/cells on the
// board. Fixed-date holidays + Easter-derived moving ones (Computus) + the big de-facto eves
// (Julafton / Midsommarafton / Nyårsafton) which are non-working in practice.

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Anonymous Gregorian algorithm — Easter Sunday for a (Gregorian) year.
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// Shift an ISO date by whole days (UTC-safe).
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The first date with the given weekday (0=Sun…6=Sat) within [startISO, endISO].
function weekdayInRange(startISO: string, endISO: string, weekday: number): string {
  let cur = startISO;
  while (cur <= endISO) {
    if (new Date(`${cur}T00:00:00Z`).getUTCDay() === weekday) return cur;
    cur = addDays(cur, 1);
  }
  return startISO;
}

const cache = new Map<number, Map<string, string>>();

function buildYear(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const md = (m: number, day: number) => `${year}-${pad(m)}-${pad(day)}`;
  const set = (iso: string, name: string) => map.set(iso, name);

  // Fixed-date red days (+ de-facto eves).
  set(md(1, 1), 'Nyårsdagen');
  set(md(1, 6), 'Trettondedag jul');
  set(md(5, 1), 'Första maj');
  set(md(6, 6), 'Sveriges nationaldag');
  set(md(12, 24), 'Julafton');
  set(md(12, 25), 'Juldagen');
  set(md(12, 26), 'Annandag jul');
  set(md(12, 31), 'Nyårsafton');

  // Easter-derived.
  const e = easterSunday(year);
  const easter = md(e.month, e.day);
  set(addDays(easter, -2), 'Långfredagen');
  set(easter, 'Påskdagen');
  set(addDays(easter, 1), 'Annandag påsk');
  set(addDays(easter, 39), 'Kristi himmelsfärds dag');
  set(addDays(easter, 49), 'Pingstdagen');

  // Midsummer (Sat 20–26 Jun, eve the Fri before) + All Saints' (Sat 31 Oct–6 Nov).
  const midsummer = weekdayInRange(md(6, 20), md(6, 26), 6);
  set(midsummer, 'Midsommardagen');
  set(addDays(midsummer, -1), 'Midsommarafton');
  set(weekdayInRange(md(10, 31), md(11, 6), 6), 'Alla helgons dag');

  return map;
}

// The Swedish holiday name for an ISO date ('YYYY-MM-DD'), or null on an ordinary day.
export function swedishHoliday(iso: string): string | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  let y = cache.get(year);
  if (!y) {
    y = buildYear(year);
    cache.set(year, y);
  }
  return y.get(iso) ?? null;
}
