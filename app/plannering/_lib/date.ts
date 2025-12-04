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

// Weekend helper
export function isWeekend(isoDate: string): boolean {
  const d = new Date(isoDate + 'T00:00:00');
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

// Compute Swedish public holidays (red days) and common "afton" days for a given year.
// Returns a Set of ISO dates (YYYY-MM-DD).
export function getSwedishPublicHolidays(year: number): Set<string> {
  const out = new Set<string>();
  const add = (d: Date) => out.add(fmtDate(d));

  // Fixed-date red days
  add(new Date(year, 0, 1));  // Nyårsdagen (Jan 1)
  add(new Date(year, 0, 6));  // Trettondedag jul (Jan 6)
  add(new Date(year, 4, 1));  // Första maj (May 1)
  add(new Date(year, 5, 6));  // Nationaldagen (June 6)
  add(new Date(year, 11, 25)); // Juldagen (Dec 25)
  add(new Date(year, 11, 26)); // Annandag jul (Dec 26)

  // Afton (commonly off): Julafton (Dec 24), Nyårsafton (Dec 31), Midsommarafton (Friday between 19–25 June)
  add(new Date(year, 11, 24)); // Julafton
  add(new Date(year, 11, 31)); // Nyårsafton

  // Easter calculation (Anonymous Gregorian algorithm)
  const easter = computeEasterSunday(year);
  const goodFriday = new Date(easter); goodFriday.setDate(goodFriday.getDate() - 2); // Långfredagen (red day)
  const easterMonday = new Date(easter); easterMonday.setDate(easterMonday.getDate() + 1); // Annandag påsk (red day)
  const ascension = new Date(easter); ascension.setDate(ascension.getDate() + 39); // Kristi himmelsfärd (red day)
  const pentecostSunday = new Date(easter); pentecostSunday.setDate(pentecostSunday.getDate() + 49); // Pingstdagen (Sunday)
  add(goodFriday);
  add(easter); // Påskdagen (Sunday, often treated as holiday)
  add(easterMonday);
  add(ascension);
  add(pentecostSunday);

  // Midsommardagen (Saturday between 20–26 June): find first Saturday >= June 20
  const midsummerDay = firstWeekdayOnOrAfter(new Date(year, 5, 20), 6);
  add(midsummerDay);
  // Midsommarafton: Friday before Midsommardagen
  const midsummerEve = new Date(midsummerDay); midsummerEve.setDate(midsummerEve.getDate() - 1);
  add(midsummerEve);

  // Alla helgons dag (Saturday between Oct 31–Nov 6): first Saturday >= Oct 31
  const allSaintsDay = firstWeekdayOnOrAfter(new Date(year, 9, 31), 6);
  add(allSaintsDay);

  return out;
}

export function isSwedishHoliday(isoDate: string, holidaySet: Set<string>): boolean {
  return holidaySet.has(isoDate);
}

function firstWeekdayOnOrAfter(base: Date, weekday: number): Date {
  const d = new Date(base);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return d;
}

function computeEasterSunday(year: number): Date {
  // Anonymous Gregorian algorithm
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
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0=Jan
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}
