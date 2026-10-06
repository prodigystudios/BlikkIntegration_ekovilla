import { addDaysISO } from '@/lib/domains/planning/timezone';

// Översiktens veckobyte: vilken vecka tavlan, topplistan och raderna per säljare visar. Rena
// funktioner på ÅÅÅÅ-MM-DD-strängar — ingen tidszon, så ingen sommartidsvecka kan bli 23 eller 25
// timmar (addDaysISO räknar på UTC-datum).

/** Tavlans fönster: veckans måndag, måndagen efter (exklusiv) och dagen som väljer månadsbudget. */
export type ScoreboardWeek = { today: string; weekStart: string; weekEnd: string };

/** URL-parametern, samma namn som startsidans arbetsschema. */
export const WEEK_PARAM = 'vecka';

/**
 * ?vecka=… tillbaka till en måndag — eller null för allt annat. Rundgången fäller datum som har
 * rätt form men inte finns (2026-02-30 blir 2 mars), och en annan veckodag än måndag är inte en
 * vecka. Null betyder "denna vecka".
 */
export function parseWeekParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== raw) return null;
  return date.getUTCDay() === 1 ? raw : null;
}

/** Måndagen `weeks` veckor från `weekStart` (negativt = bakåt). */
export function shiftWeek(weekStart: string, weeks: number): string {
  return addDaysISO(weekStart, weeks * 7);
}

/**
 * Tavlans fönster för en vald vecka. Denna vecka: läsarens eget fönster, oförändrat. En annan vecka:
 * veckans torsdag som dag — rutten kräver en dag INOM veckan. Dagen väljer inte längre budget;
 * servern mäter veckan mot månaden med flest av veckans dagar (scoreboardMonthStart), live och i
 * efterhand likadant.
 */
export function scoreboardWindowFor(weekStart: string, current: ScoreboardWeek): ScoreboardWeek {
  if (weekStart === current.weekStart) return current;
  return { weekStart, weekEnd: addDaysISO(weekStart, 7), today: addDaysISO(weekStart, 3) };
}

/** Ligger veckan före denna vecka? Strängjämförelse på ÅÅÅÅ-MM-DD-måndagar. */
export function isPastWeek(weekStart: string, currentWeekStart: string): boolean {
  return weekStart < currentWeekStart;
}
