// Planeringens vy och period över ett sidbyte: går man från tavlan in på en order och tillbaka står
// tavlan kvar på samma vecka (eller månad) i stället för att börja om på denna vecka (William,
// 2026-10-20 — samma ändring som order- och offertlistans filter). Valet bor i fliken
// (sessionStorage), som listornas: en ny flik börjar på denna vecka.
//
// Ren modul: vad som sparas och hur det läses tillbaka. Lagringen och ordningen mot tavlans första
// hämtning sköts av PlanningClient, i samma effekt som de andra vyinställningarna (prefsLoaded).
//
// 🧨 PERIODEN SPARAS SOM ETT ABSOLUT DATUM, ALDRIG SOM FÖRSKJUTNINGEN. Tavlan räknar veckor och månader
// som förskjutningar från i dag, och en sparad förskjutning hade pekat på en annan vecka när den lästes
// tillbaka en annan dag. Samma regel som startsidans arbetsschema (DashboardSchedule, #97).
//
// Och den som står på förvalet sparas INTE: denna vecka ska räknas om, inte låsas fast.
//
// 🧨 BARA SAMMA DAG (Williams val 2026-10-20). Perioden bär dagen den sparades och gäller inte en annan
// dag — en flik som stått öppen över helgen öppnar då på denna vecka, inte på fredagens. Annars hade en
// planerare kunnat lägga jobb i fel vecka för att tavlan öppnade på en gammal.
//
// Insikter sparas inte som vy: tavlan hämtar sin period även bakom den, och en återkomst dit hade
// kostat sju hämtningar för en tavla som inte visas. Vecka och månad är det som bläddras.

import { addDays, fmtISO, monthOffsetFor, parseISO, startOfWeek, weekOffsetFor } from './planningDates';

export const PLANNING_VIEWS = ['week', 'month', 'insights'] as const;
export type PlanningView = (typeof PLANNING_VIEWS)[number];

export type PlanningPeriod = { view: PlanningView; weekOffset: number; monthOffset: number };

export const DEFAULT_PLANNING_PERIOD: PlanningPeriod = { view: 'week', weekOffset: 0, monthOffset: 0 };

/** Vyerna som minns. Se huvudet om Insikter. */
const REMEMBERED_VIEWS: readonly PlanningView[] = ['week', 'month'];

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Det som ska sparas, som JSON: vyn, veckans måndag och månaden — bara de som avviker från förvalet.
 * `null` när allt står på förvalet: då ska nyckeln tas bort.
 */
export function serializePlanningPeriod(period: PlanningPeriod, today: Date): string | null {
  const stored: { view?: PlanningView; week?: string; month?: string } = {};
  if (period.view !== DEFAULT_PLANNING_PERIOD.view && REMEMBERED_VIEWS.includes(period.view)) stored.view = period.view;
  if (period.weekOffset !== 0) stored.week = fmtISO(addDays(startOfWeek(today), period.weekOffset * 7));
  if (period.monthOffset !== 0) stored.month = monthKey(new Date(today.getFullYear(), today.getMonth() + period.monthOffset, 1));
  return Object.keys(stored).length > 0 ? JSON.stringify({ ...stored, savedOn: fmtISO(today) }) : null;
}

/** Ett ISO-datum som faktiskt finns (parseISO rullar annars '2026-02-31' till mars). */
function validDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseISO(value);
  return fmtISO(date) === value ? date : null;
}

/**
 * Läs tillbaka mot dagens datum. Sparad en annan dag → förvalet (huvudet). Allt annat som inte går att
 * läsa ger förvalet för just det fältet.
 *
 * Veckan räknas om till en förskjutning med weekOffsetFor (weeksBetweenMondays, som räknar dygn och
 * avrundar) — en ren millisekunddivision hade blivit 0,994 eller 1,006 över en sommartidsväxling. En
 * sparad dag som inte är en måndag läses som sin veckas måndag.
 */
export function restorePlanningPeriod(raw: string | null, today: Date): PlanningPeriod {
  const period: PlanningPeriod = { ...DEFAULT_PLANNING_PERIOD };
  if (!raw) return period;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return period;
  }
  if (typeof stored !== 'object' || stored === null) return period;
  const value = stored as Record<string, unknown>;
  if (value.savedOn !== fmtISO(today)) return period;

  if ((REMEMBERED_VIEWS as readonly unknown[]).includes(value.view)) period.view = value.view as PlanningView;

  const week = validDay(value.week);
  if (week) period.weekOffset = weekOffsetFor(today, week);

  // Samma rundgång som veckan: Date läser år 0–99 som 1900-tal, så ett trasigt '0050-01' hade gett en
  // rubrik och ett intervall som pekar på olika år.
  if (typeof value.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) {
    const [year, month] = value.month.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    if (first.getFullYear() === year) period.monthOffset = monthOffsetFor(today, first);
  }
  return period;
}
