// Veckofönstret för arbetsschemat på startsidan.
//
// Bor här och inte i komponenten av två skäl. Det ena är att det går att testa: värdena styr vilka
// rader `get_my_jobs` / `get_my_crm_jobs` hämtar, alltså vilka jobb en installatör faktiskt ser, och
// det förtjänar ett regressionsskydd snarare än ögon. Det andra är att zonankaret redan bor i den
// här domänen (./timezone) och användes av allt UTOM den här ytan.
//
// ⚠️ ALLA DATUMHJÄLPARE HÄR LÄSER LOKALA FÄLT (getDay/getDate/getFullYear). Det är därför ankaret
// måste vara `stockholmToday()`, som ger LOKAL midnatt med Sveriges kalenderdatum i fälten — inte
// `stockholmDay` i app/crm/rapportering/reportRanges.ts, som är UTC-förankrad för att dess egen
// aritmetik läser UTC-getters. Fel ankare av de två flyttar hela veckan ett dygn.

import { stockholmToday } from './timezone';

// Det gamla objektet i komponenten bar också `year` och `weekStartISO`. Båda är borta med flit:
// `weekStartISO` var en ordagrann kopia av `startISO`, och `year` var MÅNDAGENS kalenderår, vilket
// motsäger `weekNumber` bredvid — veckan som börjar måndag 2025-12-29 är ISO-vecka 1 av 2026, men
// fältet sa 2025. Sju sådana veckor mellan 2020 och 2035. Ingen läste något av dem, och ett
// exporterat fält som är subtilt fel är värre än inget fält.
export type ScheduleWeekRange = {
  /** Måndagen, YYYY-MM-DD. Skickas som `start_date` till RPC:erna. */
  startISO: string;
  /** Söndagen, YYYY-MM-DD. Skickas som `end_date` till RPC:erna. */
  endISO: string;
  /** ISO-veckonummer. Behöver du året till det måste det vara ISO-VECKOÅRET, inte måndagens. */
  weekNumber: number;
  /** Måndag..söndag som YYYY-MM-DD. Dagväljaren indexerar 0=mån..4=fre i den här. */
  days: string[];
};

function startOfISOWeek(d: Date) {
  const day = d.getDay(); // 0..6, 1=Mon
  const mondayDelta = (day + 6) % 7; // days since Monday
  const res = new Date(d);
  res.setHours(0, 0, 0, 0);
  res.setDate(res.getDate() - mondayDelta);
  return res;
}

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function toISODateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getISOWeekNumber(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/**
 * Veckan `weekOffset` steg från den vecka Sverige befinner sig i just nu.
 *
 * `now` är en parameter enbart för testerna; produktionskoden läser klockan här.
 */
export function scheduleWeekRange(weekOffset: number, now: Date = new Date()): ScheduleWeekRange {
  const base = addDays(startOfISOWeek(stockholmToday(now)), weekOffset * 7);
  return {
    startISO: toISODateLocal(base),
    endISO: toISODateLocal(addDays(base, 6)),
    weekNumber: getISOWeekNumber(base),
    days: Array.from({ length: 7 }, (_, i) => toISODateLocal(addDays(base, i))),
  };
}

/**
 * Dagen som ska vara förvald i dagväljaren: 0=mån..4=fre, eller null på helgen ("Alla").
 *
 * Måste läsa svensk veckodag av samma skäl som veckan. Söndag 23:30 UTC är måndag i Sverige — en
 * server som läser sin egen kalender väljer "Alla" medan webbläsaren väljer "Mån", och då byter
 * både den intryckta knappen och den filtrerade listan utseende vid hydreringen.
 */
export function defaultScheduleDayIndex(now: Date = new Date()): number | null {
  const dow = stockholmToday(now).getDay(); // Sun=0 .. Sat=6
  return dow >= 1 && dow <= 5 ? dow - 1 : null;
}
