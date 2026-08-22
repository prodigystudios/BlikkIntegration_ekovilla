// Arbetad tid ur ett pass: klockslag in, minuter ut. Ren, utan sidoeffekter, ingen Date.now().
//
// ⚠️ DET HÄR RÄKNAR INTE LÖN, och gör inte längre någon uppdelning heller. Lönebyrån har (2026-08-11)
// bett om klockslagen råa — "starttid och sluttid för dagen för att jag ska veta vilken
// övertidsersättning de ska få" — och härleder övertid och OB själv ur dem. En tidigare version
// delade upp passet i dag/kväll/natt/helg/röd dag med gränserna 06/18/23; de gränserna var ett
// antagande utan avtal bakom sig och efterfrågades aldrig. Den koden är borttagen och finns i
// git-historiken (commit c837acc) om behovet dyker upp.
//
// Kvar är det byrån faktiskt bad om: summan ska vara arbetad tid EFTER rastavdrag. Hennes exempel,
// som är testfallet: 08:00–18:00 med en timmes rast är 9 timmar, inte 10.

export type ShiftInput = {
  /** 'YYYY-MM-DD'. Äger raden: perioden och attesten följer det här datumet, inte klockan. */
  workDate: string;
  /** 'HH:MM'. Saknas den används minutesWorked. */
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  /** Används när klockslag saknas: frånvarorader anges i timmar, och gamla kontorsrader har inga. */
  minutesWorked?: number | null;
};

/**
 * Rasten som fylls i när inget annat är känt.
 *
 * Byråns eget exempel (08–18 med en timmes rast är nio timmar) och det värde arbetsorderns tidflik
 * redan hade. Konstanten finns för att de två formulären skriver till SAMMA tabell: när defaulten
 * stod som en literal på var sitt ställe gav samma pass olika betald tid beroende på vilken väg in
 * man tog, och ingenting failade när de gled isär. Ett utgångsvärde man SER och kan ändra — till
 * skillnad från ett tomt fält, som tyst blir noll.
 */
export const DEFAULT_BREAK_MINUTES = 60;

/**
 * Rast i minuter ur ett inmatningsfält, eller null när fältet inte går att tolka.
 *
 * ⚠️ ALDRIG `Number(x) || 0`. "30 min", "0,5" och ett klistrat blanksteg blir alla NaN, och `|| 0`
 * gör då rastavdraget till noll — 07:00–16:00 skrivs som 540 minuter i stället för 510, alltså
 * trettio minuter tillagda på någons lön. Fällan har slagit till två gånger: en gång på dagradens
 * sida, en gång via inmatningen. Den bor här nu så att båda formulären delar samma tolkning.
 *
 * Tomt fält är noll och inte ett fel: det är så man skriver "ingen rast".
 */
export function parseBreakMinutes(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed) ? parsed : null;
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

// Bruttominuter mellan två klockslag. end <= start betyder att passet passerade midnatt — inget
// extra fält behövs för det, och passet ligger ändå helt på workDate.
export function grossMinutes(startTime: string | null, endTime: string | null): number | null {
  const start = parseClock(startTime);
  const end = parseClock(endTime);
  if (start === null || end === null) return null;
  return end > start ? end - start : 1440 - start + end;
}

// Arbetad tid i minuter, efter rastavdrag. Heltal hela vägen: 0,01 h avrundningsfel × 25 rader ×
// 12 personer × 12 månader blir timmar per år, och det är någons lön.
export function workedMinutes(input: ShiftInput): number {
  const gross = grossMinutes(input.startTime, input.endTime);
  if (gross === null) return Math.max(0, Math.round(input.minutesWorked ?? 0));
  const breakMinutes = Math.max(0, Math.round(input.breakMinutes || 0));
  return Math.max(0, gross - breakMinutes);
}

// För presentation. Underlaget visar timmar, databasen räknar minuter.
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
