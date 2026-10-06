import { UNKNOWN_SELLER_NAME } from '@/lib/domains/crm/goals';
import type { MetricProgress, ScoreboardMetric, ScoreboardMetrics, ScoreboardSeller } from '@/lib/domains/crm/weeklyScoreboard';
// planningDates och inte lib/domains/planning/insights: insights drar med sig serverns läskod (och
// node:assert) in i webbläsarens paket. planningDates har inga importer alls.
import { isoWeek } from '@/app/crm/planering/planningDates';

// Ren visningslogik för veckotavlan: ordning, ord och etiketter. Inga React-beroenden, så att den
// går att pröva utan att rendera — siffrorna själva räknas i lib/domains/crm/weeklyScoreboard.ts.

// Tavlans ordning, samma som flödet: aktivitet → offert → order → faktura.
export const BOARD_METRICS: ScoreboardMetric[] = ['calls', 'quotes', 'quoteValue', 'orderCount', 'orderValue', 'invoicedValue'];

// Topplistans flikar. Antalen (offerter, ordrar) är med flit inte flikar: en topplista över antal
// belönar många små affärer, och värdet är det som syns i kassan.
export const LEADERBOARD_METRICS: ScoreboardMetric[] = ['calls', 'quoteValue', 'orderValue', 'invoicedValue'];

export const METRIC_LABEL: Record<ScoreboardMetric, string> = {
  calls: 'Samtal',
  quotes: 'Offerter',
  quoteValue: 'Offertvärde',
  orderCount: 'Ordrar',
  orderValue: 'Ordervärde',
  invoicedValue: 'Fakturerat',
};

const GOAL_NAME: Record<ScoreboardMetric, string> = {
  calls: 'samtalsmålet',
  quotes: 'offertmålet',
  quoteValue: 'offertvärdesmålet',
  orderCount: 'ordermålet',
  orderValue: 'ordervärdesmålet',
  invoicedValue: 'faktureringsmålet',
};

const MONEY_METRICS: ReadonlySet<ScoreboardMetric> = new Set(['quoteValue', 'orderValue', 'invoicedValue']);

export function isMoneyMetric(metric: ScoreboardMetric): boolean {
  return MONEY_METRICS.has(metric);
}

const kronor = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
const count = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });

export function formatMetricValue(metric: ScoreboardMetric, value: number): string {
  return isMoneyMetric(metric) ? kronor.format(value) : count.format(value);
}

/** "5 / 20", "0 kr / 400 000 kr" — eller bara utfallet när måttet saknar mål. */
export function formatProgress(metric: ScoreboardMetric, progress: MetricProgress): string {
  const done = formatMetricValue(metric, progress.done);
  return progress.target == null ? done : `${done} / ${formatMetricValue(metric, progress.target)}`;
}

/** Andelen av målet för en stapel, 0–100. Null när det inte finns något mål — då ritas ingen stapel. */
export function progressPercent(progress: MetricProgress): number | null {
  if (progress.target == null) return null;
  if (progress.done <= 0) return 0;
  return Math.min(100, (progress.done / progress.target) * 100);
}

/** Lagets mål: hur många som har ett mål, och hur många av dem som är nådda. */
export function countGoals(metrics: ScoreboardMetrics): { reached: number; set: number } {
  const withTarget = BOARD_METRICS.filter((metric) => metrics[metric].target != null);
  return { reached: withTarget.filter((metric) => metrics[metric].reached).length, set: withTarget.length };
}

/**
 * Raden under ringen. Saklig: hur långt det är kvar, inte ett omdöme om laget. För en avslutad
 * vecka finns inget "kvar" — då säger den hur veckan slutade.
 */
export function goalsCaption({ reached, set }: { reached: number; set: number }, past = false): string {
  if (set === 0) return 'Inga veckomål satta';
  const left = set - reached;
  if (past) {
    if (left === 0) return 'Alla veckomål nåddes';
    return left === 1 ? 'Ett mål nåddes inte' : `${left} mål nåddes inte`;
  }
  if (left === 0) return 'Alla veckomål nådda';
  return left === 1 ? 'Ett mål kvar' : `${left} mål kvar`;
}

/** Topplistan för ett mått: störst först, lika värden i svensk namnordning. */
export function rankSellers(sellers: ScoreboardSeller[], metric: ScoreboardMetric): ScoreboardSeller[] {
  return [...sellers].sort((left, right) => {
    const diff = right.metrics[metric].done - left.metrics[metric].done;
    return diff !== 0 ? diff : left.name.localeCompare(right.name, 'sv');
  });
}

/**
 * Placeringen per rad i en rankSellers-lista: lika värden delar placering (1, 1, 3). Utan det hade
 * namnordningen avgjort vem av två lika säljare som står som etta.
 */
export function competitionRanks(ranked: ScoreboardSeller[], metric: ScoreboardMetric): number[] {
  return ranked.map((row) => 1 + ranked.filter((other) => other.metrics[metric].done > row.metrics[metric].done).length);
}

/** Pokalen till ettan — men bara när ettan har gjort något. Annars delar alla på noll och ingen leder. */
export function leads(rank: number, progress: MetricProgress): boolean {
  return rank === 1 && progress.done > 0;
}

export type Achievement = { userId: string; name: string; metric: ScoreboardMetric };

/**
 * Veckans nådda mål per säljare. Läsarens egna först — det är dem hen bryr sig mest om — sedan
 * tavlans ordning, och inom en säljare måttens ordning.
 */
export function listAchievements(sellers: ScoreboardSeller[], viewerId: string | null): Achievement[] {
  const own = sellers.filter((seller) => seller.userId === viewerId);
  const others = sellers.filter((seller) => seller.userId !== viewerId);
  return [...own, ...others].flatMap((seller) => BOARD_METRICS
    .filter((metric) => seller.metrics[metric].reached)
    .map((metric) => ({ userId: seller.userId, name: seller.name, metric })));
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function achievementSentence(achievement: Achievement, viewerId: string | null): string {
  const who = achievement.userId === viewerId ? 'Du' : firstName(achievement.name);
  return `${who} nådde ${GOAL_NAME[achievement.metric]}`;
}

/** "Ytterligare ett veckomål är nått." — det som inte får plats i bannerns rubrik. */
export function moreAchievementsSentence(more: number): string | null {
  if (more <= 0) return null;
  return more === 1 ? 'Ytterligare ett veckomål är nått.' : `Ytterligare ${more} veckomål är nådda.`;
}

/** Ett nått mål som nyckel: vem och vilket mått. */
export function achievementKey(achievement: Achievement): string {
  return `${achievement.userId}:${achievement.metric}`;
}

/** Vad läsaren har stängt bannern för: veckan och de mål som stod i den. */
export type DismissedAchievements = { weekStart: string; keys: string[] };

/**
 * De nådda mål läsaren INTE redan stängt — bannern visas bara när det finns något här, och dess
 * rubrik är det första av dem, så att en återkommande banner berättar om det som är nytt.
 *
 * Det räcker inte att jämföra med en signatur: när ett mål faller bort — en order avbryts och
 * ordervärdet sjunker under målet — ändras signaturen, och bannern kom tillbaka och berättade om mål
 * läsaren redan stängt. Ett mål som faller bort och sedan nås igen är inte heller nytt. Ny vecka =
 * inget stängt.
 */
export function newAchievements(weekStart: string, achievements: Achievement[], dismissed: DismissedAchievements | null): Achievement[] {
  if (!dismissed || dismissed.weekStart !== weekStart) return achievements;
  const closed = new Set(dismissed.keys);
  return achievements.filter((achievement) => !closed.has(achievementKey(achievement)));
}

/** Det som sparas när läsaren stänger: allt som är stängt den här veckan, gammalt och nytt. */
export function dismissAchievements(weekStart: string, achievements: Achievement[], dismissed: DismissedAchievements | null): DismissedAchievements {
  const earlier = dismissed?.weekStart === weekStart ? dismissed.keys : [];
  return { weekStart, keys: Array.from(new Set([...earlier, ...achievements.map(achievementKey)])).sort() };
}

/** Läser det sparade tillbaka. Allt som inte har rätt form räknas som "inget stängt". */
export function parseDismissedAchievements(raw: string | null): DismissedAchievements | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.weekStart !== 'string' || !Array.isArray(value?.keys)) return null;
    return { weekStart: value.weekStart, keys: value.keys.filter((key: unknown): key is string => typeof key === 'string') };
  } catch {
    return null;
  }
}

/** Läsarens väg till samtalsstjärnan: förnamnet (null utan namn) och hur många samtal som återstår. */
export type CallsToStar = { name: string | null; remaining: number };

/**
 * Hur många samtal läsaren har kvar till veckans samtalsmål — "Andreas, du är 1 samtal från
 * stjärnan" i VD:ns mockup. Null när läsaren inte står på tavlan, saknar samtalsmål eller redan nått
 * det: då finns ingen stjärna att peka mot, och ett nått mål firas redan av bannern.
 *
 * Bara samtalen, med flit: det är det enda målet en säljare kan flytta själv samma dag. Ett
 * kronmål "12 000 kr från stjärnan" säger inget om vad man ska göra härnäst.
 *
 * Samtalsmålet är redan ett heltal (weeklyTarget avrundar antalsmålen). Uppåtavrundningen är
 * bara ett skydd: blir målet någon gång ett bråktal ska raden ändå säga ett helt samtal, inte en halv.
 */
export function callsToStar(sellers: ScoreboardSeller[], viewerId: string | null): CallsToStar | null {
  const seller = sellers.find((row) => row.userId === viewerId);
  const calls = seller?.metrics.calls;
  // Ingen reached-kontroll: för ett antalsmått är "nått" detsamma som att inget återstår.
  if (!seller || !calls || calls.target == null) return null;
  const remaining = Math.ceil(calls.target - calls.done);
  if (remaining <= 0) return null;
  // Utan namn i profilen står tavlans reservnamn där — "Okänd, du är 3 samtal …" vore fel tilltal.
  return { name: seller.name === UNKNOWN_SELLER_NAME ? null : firstName(seller.name), remaining };
}

/** "Ett samtal till och du når veckans samtalsmål." */
export function callsToStarSentence(remaining: number): string {
  return remaining === 1
    ? 'Ett samtal till och du når veckans samtalsmål.'
    : `${remaining} samtal till och du når veckans samtalsmål.`;
}

/** Två bokstäver till avataren: för- och efternamnets första. Ett ensamt namn ger en. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0][0] : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toLocaleUpperCase('sv-SE');
}

const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "vecka 40" — för meningar som "Sorterat på samtal vecka 40". */
export function weekName(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map(Number);
  // Lokal dag, som i weekLabel nedan: isoWeek läser lokala fält.
  return `vecka ${isoWeek(new Date(year, month - 1, day))}`;
}

/** "Vecka 41, 5–11 okt" — eller "Vecka 40, 28 sep–4 okt" över ett månadsskifte. Slutet är exklusivt. */
export function weekLabel(weekStart: string, weekEnd: string): string {
  const last = addDays(weekEnd, -1);
  const [, startMonth, startDay] = weekStart.split('-').map(Number);
  const [, lastMonth, lastDay] = last.split('-').map(Number);
  const range = startMonth === lastMonth
    ? `${startDay}–${lastDay} ${MONTHS[lastMonth - 1]}`
    : `${startDay} ${MONTHS[startMonth - 1]}–${lastDay} ${MONTHS[lastMonth - 1]}`;
  // Datumet byggs ur strängens delar som LOKAL dag — isoWeek läser lokala fält, och en UTC-midnatt
  // hade blivit söndagen innan väster om Greenwich.
  const [startYear] = weekStart.split('-').map(Number);
  return `Vecka ${isoWeek(new Date(startYear, startMonth - 1, startDay))}, ${range}`;
}
