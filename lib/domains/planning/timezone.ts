// "Today" in Sweden, for planning surfaces that must not read the runtime's own calendar.
//
// Two different places get this wrong in two different ways, which is why it lives in the domain
// rather than next to one of them:
//
//   • The board (app/crm/planering/PlanningClient.tsx) is a client component rendered by a server
//     component, so it is server-rendered before it hydrates. The server runs on UTC. Between 00:00
//     and 02:00 Swedish time the two clocks sit on different calendar days — a hydration mismatch
//     and a visible flash of the wrong week.
//   • The insights route runs only on the server, so there is no mismatch to see; it just quietly
//     computes the wrong week. mondayOf() turns a one-day error into a whole-week shift of the
//     chart axis whenever that day is a Monday.
//
// (app/crm/rapportering/reportRanges.ts solves the same problem with a UTC-anchored `stockholmDay`,
// because its own arithmetic is UTC-based. Unifying the two is a separate change — see its header.)

const PLANNING_TIME_ZONE = 'Europe/Stockholm';

const zoneParts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: PLANNING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parts(now: Date): { year: number; month: number; day: number } {
  const p = zoneParts.formatToParts(now);
  const get = (type: string) => Number(p.find((x) => x.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The Swedish calendar date `now` falls on, as a LOCAL-midnight Date.
 *
 * Local-midnight rather than UTC-anchored on purpose: the board's date helpers all read local Date
 * fields (getFullYear/getMonth/getDate), so a local anchor leaves their arithmetic untouched. In the
 * browser this is simply today; on the UTC server it is the Swedish day expressed in the server's
 * own local (= UTC) fields, which is exactly what fmtISO then reads back.
 */
export function stockholmToday(now: Date = new Date()): Date {
  const { year, month, day } = parts(now);
  return new Date(year, month - 1, day);
}

/** The Swedish calendar date `now` falls on, as YYYY-MM-DD. Independent of the runtime zone. */
export function stockholmTodayISO(now: Date = new Date()): string {
  const { year, month, day } = parts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Flytta ett ISO-datum n kalenderdagar, som ISO-sträng. Oberoende av runtimens zon.
 *
 * ⚠️ UTC-FÖRANKRAD, OCH DET ÄR HELA POÄNGEN. Den naiva varianten — lägg n * 86 400 000 ms på en
 * LOKAL midnatt och läs tillbaka lokala fält — ger samma datum tillbaka över höstens
 * sommartidsväxling: `2026-10-25 00:00 +24 h` blir `2026-10-25 23:00`, eftersom det dygnet är 25
 * timmar långt. En dag-för-dag-vandring besöker då samma datum två gånger, och en beräkning som
 * backar ledtiden hoppar en dag fel. I UTC finns ingen växling, så aritmetiken är exakt.
 *
 * 🕰️ TESTET SOM VAKTAR DET HÄR BITER BARA I EN DST-ZON. Under `TZ=UTC` (CI och Vercel) beter sig
 * den naiva varianten identiskt, så ett grönt test bevisar ingenting där. Se
 * tests/planning/depotForecast.test.ts, som är mutationstestat under `TZ=Europe/Stockholm`.
 *
 * (Två privata tvillingar finns redan: `addDaysISO` i insights.ts och `addDays` i holidays.ts, båda
 * UTC-förankrade och båda korrekta. Att slå ihop dem är en egen ändring — den här bor här för att
 * det är hit datumankringen hör, inte i en fjärde kopia hos den som råkade behöva den.)
 */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Dygnsnummer sedan epok för ett ISO-datum (YYYY-MM-DD). `null` när strängen inte är ett ISO-datum.
 *
 * Den kanoniska kopian. Idiomet stod skrivet tre gånger — `sackLedger.isoToDayNumber`,
 * `deliveryStrip.isoToDayNumber` och `planningDates.daysBetweenInclusive` — och alla tre delegerar
 * nu hit. Skälet att samla dem är inte snygghet: så fort två ytor jämför dagnummer som räknats på
 * var sitt håll måste ankringen vara densamma, och tre kopior är tre tillfällen att glida isär.
 *
 * ⚠️ `Math.round` är lastbärande, inte kosmetik. Under en sommartidsväxling är dygnet 23 eller 25
 * timmar; utan avrundningen ger differensen mellan två dagnummer 14,0417 i stället för 14, och en
 * fördelning som dividerar med det talet tappar kronor. Avrunda FÖRE varje division.
 *
 * 🕰️ Ett test som PÅSTÅR att det vaktar UTC-ankringen blir tomt: `Math.round` sväljer både
 * sommartidens timme och en hel zonförskjutning, så en lokalt förankrad variant ger identiskt
 * resultat i varje zon (det prövades — se kommentaren i deliveryStrip.ts). UTC står kvar för att
 * det förblir rätt den dag någon jämför mot ett dagnummer räknat någon annanstans. Det som DÄREMOT
 * går att vakta är avrundningen, och det testet måste köras under `TZ=Europe/Stockholm`.
 */
export function isoDayNumber(iso: string | null | undefined): number | null {
  const m = ISO_DATE_RE.exec((iso ?? '').trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * Antal kalenderdagar i [start, end], inklusive båda ändarna. Samma dag ger 1.
 *
 * `NaN` när något av datumen inte går att läsa — samma utfall som den tidigare implementationen i
 * planningDates, så inget anropsställe behöver ändras.
 */
export function daysBetweenInclusiveISO(startISO: string, endISO: string): number {
  const start = isoDayNumber(startISO);
  const end = isoDayNumber(endISO);
  if (start === null || end === null) return NaN;
  return end - start + 1;
}
