import type { SupabaseClient } from '@supabase/supabase-js';
import { UNKNOWN_SELLER_NAME, listCrmGoals, mapCrmGoalRows, weeklyFromMonthly, type CrmGoal, type CrmGoalRow } from './goals';
import {
  composeWeekActuals,
  fetchWeekActualRows,
  type CrmOverviewWeekActuals,
  type CrmOverviewWindow,
  type CrmWeekActuals,
} from './overviewSummary';

// ── Lagets veckotavla ──
//
// Veckans utfall per säljare mot veckomålen, för HELA laget och oavsett vem som läser.
//
// Översiktens egen summering läser med sessionsklienten, och crm_calls_select_visible ger en säljare
// bara de egna samtalen (plus samtal på prospekt hen äger). Målen kom däremot från /api/crm/goals,
// som läser med admin-klienten, så säljaren såg alla säljare i listan — med kollegornas samtal som
// 0. Tavlan läser därför utfallet med admin-klienten också, samma prejudikat som rapporteringen
// (/api/crm/reports): varje CRM-användare får se lagets siffror per säljare.
//
// ⚠️ Det som lämnar servern är summor per säljare och namnen, aldrig rader. Ingen offert, inget
// samtal och ingen kund syns här — bara antal och kronor per vecka.

export const SCOREBOARD_METRICS = ['calls', 'quotes', 'quoteValue', 'orderCount', 'orderValue', 'invoicedValue'] as const;
export type ScoreboardMetric = (typeof SCOREBOARD_METRICS)[number];

// Antal avrundas till hela (så att "17 / 15" läser rent), kronor lämnas exakta.
const COUNT_METRICS: ReadonlySet<ScoreboardMetric> = new Set(['calls', 'quotes', 'orderCount']);

export type MetricProgress = {
  done: number;
  /** Veckomålet: månadsbudgeten ÷ 4. Null = inget mål, och då finns ingen stjärna att nå. */
  target: number | null;
  reached: boolean;
};

export type ScoreboardMetrics = Record<ScoreboardMetric, MetricProgress>;

export type ScoreboardSeller = {
  userId: string;
  name: string;
  metrics: ScoreboardMetrics;
  /** Snittet av utfall ÷ mål över måtten som har ett mål. Rangordnar listan. */
  progressScore: number;
};

export type WeeklyScoreboard = {
  weekStart: string;
  weekEnd: string;
  /**
   * Hela lagets vecka — även rader utan ansvarig och säljare utan mål — mot summan av säljarnas
   * budgetar. Samma utfall som översiktens weekTeam för en admin, men nu för alla läsare.
   */
  team: ScoreboardMetrics;
  /** De som har en månadsbudget med något mål i, bäst först. */
  sellers: ScoreboardSeller[];
  /** Läsningar som slog i radtaket. Tom är det normala; annars är siffrorna för låga. */
  truncated: string[];
};

export type ScoreboardWindow = Pick<CrmOverviewWindow, 'today' | 'weekStart' | 'weekEnd'>;

type MonthlyBudget = Record<ScoreboardMetric, number>;

function budgetOf(goal: CrmGoal): MonthlyBudget {
  return {
    calls: Number(goal.calls_target) || 0,
    quotes: Number(goal.quotes_target) || 0,
    quoteValue: Number(goal.quote_value_target) || 0,
    orderCount: Number(goal.order_count_target) || 0,
    orderValue: Number(goal.order_value_target) || 0,
    invoicedValue: Number(goal.invoiced_value_target) || 0,
  };
}

function sumBudgets(budgets: MonthlyBudget[]): MonthlyBudget {
  const total = Object.fromEntries(SCOREBOARD_METRICS.map((metric) => [metric, 0])) as MonthlyBudget;
  for (const budget of budgets) {
    for (const metric of SCOREBOARD_METRICS) total[metric] += budget[metric];
  }
  return total;
}

function weeklyTarget(metric: ScoreboardMetric, monthly: number): number | null {
  const weekly = weeklyFromMonthly(monthly);
  const target = COUNT_METRICS.has(metric) ? Math.round(weekly) : weekly;
  return target > 0 ? target : null;
}

// Ett kronmål nås på hela kronor — samma avrundning som tavlan visar beloppen med. Annars kunde
// 24 999,60 mot 25 000 stå som "25 000 kr / 25 000 kr" utan stjärna, och stjärnan säga emot
// siffran bredvid den. Antalen är redan heltal.
function isReached(metric: ScoreboardMetric, done: number, target: number | null): boolean {
  if (target == null) return false;
  return COUNT_METRICS.has(metric) ? done >= target : Math.round(done) >= Math.round(target);
}

function metricsOf(actuals: CrmOverviewWeekActuals | undefined, budget: MonthlyBudget): ScoreboardMetrics {
  return Object.fromEntries(SCOREBOARD_METRICS.map((metric) => {
    const done = actuals?.[metric] ?? 0;
    const target = weeklyTarget(metric, budget[metric]);
    return [metric, { done, target, reached: isReached(metric, done, target) }];
  })) as ScoreboardMetrics;
}

function progressScore(metrics: ScoreboardMetrics): number {
  const ratios = SCOREBOARD_METRICS
    .map((metric) => metrics[metric])
    .filter((progress): progress is MetricProgress & { target: number } => progress.target != null)
    .map((progress) => progress.done / progress.target);
  return ratios.length > 0 ? ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length : 0;
}

// En budget med nollor i alla fält är ingen budget — den säljaren hör inte hemma på tavlan.
function hasAnyBudget(budget: MonthlyBudget): boolean {
  return SCOREBOARD_METRICS.some((metric) => budget[metric] > 0);
}

/**
 * Pure: veckans utfall och månadens budgetar in, tavlan ut. Frågorna är den orena halvan
 * (fetchWeeklyScoreboard).
 */
export function composeWeeklyScoreboard(
  input: { actuals: CrmWeekActuals; goals: CrmGoal[]; truncated: string[] },
  window: Pick<ScoreboardWindow, 'weekStart' | 'weekEnd'>,
): WeeklyScoreboard {
  const budgets = input.goals.map((goal) => ({ goal, budget: budgetOf(goal) }));

  const sellers = budgets
    .filter(({ budget }) => hasAnyBudget(budget))
    .map(({ goal, budget }) => {
      const metrics = metricsOf(input.actuals.weekByUser[goal.user_id], budget);
      return {
        userId: goal.user_id,
        name: goal.user?.full_name || UNKNOWN_SELLER_NAME,
        metrics,
        progressScore: progressScore(metrics),
      };
    })
    .sort((left, right) => {
      if (right.progressScore !== left.progressScore) return right.progressScore - left.progressScore;
      if (right.metrics.calls.done !== left.metrics.calls.done) return right.metrics.calls.done - left.metrics.calls.done;
      return left.name.localeCompare(right.name, 'sv');
    });

  return {
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    // Lagets mål är budgetarna summerade FÖRE omräkningen till vecka och avrundningen — samma regel
    // som översikten hade när den räknade målen i webbläsaren.
    team: metricsOf(input.actuals.weekTeam, sumBudgets(budgets.map(({ budget }) => budget))),
    sellers,
    truncated: input.truncated,
  };
}

/** Månadsbudgetens nyckel för läsarens dag: en vecka som korsar ett månadsskifte mäts mot dagens månad. */
export function scoreboardMonthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Läser tavlan. `admin` ska vara admin-klienten — se kommentaren överst om varför sessionen inte
 * räcker. Samtalen läses bara från veckans måndag; tavlan har inget rullande sjudagarsfönster.
 */
export async function fetchWeeklyScoreboard(admin: SupabaseClient, window: ScoreboardWindow): Promise<WeeklyScoreboard> {
  const truncated: string[] = [];
  const [rows, goals] = await Promise.all([
    fetchWeekActualRows(admin, window, window.weekStart, truncated),
    listCrmGoals(admin, { periodType: 'month', periodStart: scoreboardMonthStart(window.today) }).then(({ data, error }) => {
      if (error) throw new Error(`goals: ${error.message}`);
      return mapCrmGoalRows(data as CrmGoalRow[] | null);
    }),
  ]);

  return composeWeeklyScoreboard({ actuals: composeWeekActuals(rows, window), goals, truncated }, window);
}
