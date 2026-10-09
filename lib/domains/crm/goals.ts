import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysISO, mondayOfISO, stockholmTodayISO } from '@/lib/domains/planning/timezone';

/**
 * Namnet på veckotavlan när målets användare saknar ett i profilen. Här och inte i
 * weeklyScoreboard.ts: översikten läser det i webbläsaren, och goals.ts finns redan i dess paket —
 * tavlans modul drar med sig summeringens läskod.
 */
export const UNKNOWN_SELLER_NAME = 'Okänd användare';

// Budgets are set monthly; the leaderboard derives the weekly target as budget ÷ this.
export const GOAL_WEEKS_PER_MONTH = 4;

export type CrmGoalPeriodType = 'week' | 'month';

export const crmGoalSelect =
  'id, user_id, period_type, period_start, calls_target, quotes_target, quote_value_target, order_count_target, order_value_target, invoiced_value_target, created_by, updated_by, created_at, updated_at, user:profiles!crm_goals_user_id_fkey(id, full_name, role)';

type GoalUserRow = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'member' | 'konsult';
};

export type CrmGoalRow = {
  id: string;
  user_id: string;
  period_type: CrmGoalPeriodType;
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
  order_count_target: number;
  order_value_target: number | string;
  invoiced_value_target: number | string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  user: GoalUserRow | GoalUserRow[] | null;
};

export type CrmGoal = Omit<CrmGoalRow, 'user'> & {
  user: GoalUserRow | null;
};

type ListCrmGoalsArgs = {
  periodType: CrmGoalPeriodType;
  periodStart: string;
};

type UpsertCrmGoalInput = {
  user_id: string;
  period_type: CrmGoalPeriodType;
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number;
  order_count_target: number;
  order_value_target: number;
  // Valfri: utelämnad lämnar upserten den sparade budgeten orörd (en flik från före kolumnen).
  invoiced_value_target?: number;
  created_by: string;
  updated_by: string;
};

function getUser(value: CrmGoalRow['user']) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export function mapCrmGoalRow(row: CrmGoalRow): CrmGoal {
  return {
    ...row,
    user: getUser(row.user),
  };
}

export function mapCrmGoalRows(rows: CrmGoalRow[] | null | undefined) {
  return (rows || []).map(mapCrmGoalRow);
}

// 🧨 Båda nycklarna är SVENSKA dagar. De läses på servern (app/crm/installningar/page.tsx och
// api/crm/goals), och servern kör UTC: strax efter midnatt den 1:a pekade månadsnyckeln på FÖRRA
// månaden, och ett sparat mål hade då skrivit över den månadens budget med den nyas siffror.
// `now` går att skicka in för att kunna prövas.
export function getCurrentWeekStartDate(now: Date = new Date()) {
  const [year, month, day] = stockholmTodayISO(now).split('-').map(Number);
  // UTC-förankrad aritmetik: veckan får inte tappa en dag över en sommartidsväxling.
  const start = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start.toISOString().slice(0, 10);
}

// First day of the current month (YYYY-MM-01) — the key for a monthly budget.
export function getCurrentMonthStartDate(now: Date = new Date()) {
  return `${stockholmTodayISO(now).slice(0, 7)}-01`;
}

/**
 * Fönstret CRM-översikten ber servern räkna inuti: idag, sju dagar bakåt och veckan (måndag–måndag,
 * exklusivt). SVENSKA dagar, oavsett vems klocka som räknar (William 2026-10-09: svensk tid överallt) —
 * tidigare tog fönstret läsarens webbläsarzon, så en säljare på resa såg en annan vecka än kollegorna.
 * Bor bredvid getCurrentWeekStartDate, som räknar veckobudgetens nyckel på samma svenska dag, så att
 * utfallet och veckomålet aldrig kan vara oense om vilken vecka det är.
 *
 * UTC-förankrad dagsaritmetik (addDaysISO, mondayOfISO): en vecka över en sommartidsväxling är sju
 * kalenderdagar, inte 167 eller 169 timmar. `now` går att skicka in för testerna.
 */
export function getCrmOverviewWindow(now: Date = new Date()) {
  const today = stockholmTodayISO(now);
  const weekStart = mondayOfISO(today) ?? today;
  return {
    today,
    /** Inclusive first day of the rolling 7-day window. */
    since: addDaysISO(today, -7),
    /** Inclusive Monday of the current week. */
    weekStart,
    /** Exclusive Monday after the current week. */
    weekEnd: addDaysISO(weekStart, 7),
  };
}

// Derive the displayed weekly target from a monthly budget (budget ÷ 4, fixed).
export function weeklyFromMonthly(monthly: number | string): number {
  const numeric = typeof monthly === 'number' ? monthly : Number(String(monthly));
  return Number.isFinite(numeric) ? numeric / GOAL_WEEKS_PER_MONTH : 0;
}

export function formatGoalCurrency(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(numeric);
}

export async function listCrmGoals(supabase: SupabaseClient, args: ListCrmGoalsArgs) {
  return supabase
    .from('crm_goals')
    .select(crmGoalSelect)
    .eq('period_type', args.periodType)
    .eq('period_start', args.periodStart)
    .order('user_id', { ascending: true });
}

export async function upsertCrmGoals(supabase: SupabaseClient, items: UpsertCrmGoalInput[]) {
  return supabase
    .from('crm_goals')
    .upsert(items, { onConflict: 'user_id,period_type,period_start' })
    .select(crmGoalSelect);
}