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
