import type { SupabaseClient } from '@supabase/supabase-js';

export const crmGoalSelect =
  'id, user_id, period_type, period_start, calls_target, quotes_target, quote_value_target, created_by, updated_by, created_at, updated_at, user:profiles!crm_goals_user_id_fkey(id, full_name, role)';

type GoalUserRow = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'member' | 'konsult';
};

type CrmGoalRow = {
  id: string;
  user_id: string;
  period_type: 'week';
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
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
  periodType: 'week';
  periodStart: string;
};

type UpsertCrmGoalInput = {
  user_id: string;
  period_type: 'week';
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number;
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

export function formatLocalDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentWeekStartDate() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return formatLocalDateOnly(start);
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