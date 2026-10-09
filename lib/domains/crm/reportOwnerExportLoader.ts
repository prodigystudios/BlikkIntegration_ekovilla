import type { SupabaseClient } from '@supabase/supabase-js';
import { readEveryRow } from './reports';
import type { OwnerGoalRow } from './reportOwnerExport';

/**
 * Säljarnas månadsmål för de givna månaderna (ÅÅÅÅ-MM), per säljare — budgetfliken i ägarnas rapport.
 *
 * Rapportsidan läser målen utan user_id (laget summeras); här behövs varje säljares rad. Läses med
 * admin-klienten av samma skäl som rapporten: en lagsammanställning, och målen är ingen hemlighet för
 * den som får se rapporten (crm.access).
 */
export function fetchSellerGoals(admin: SupabaseClient, months: string[]): Promise<OwnerGoalRow[]> {
  if (months.length === 0) return Promise.resolve([]);
  return readEveryRow('crm_goals', (from, to) =>
    admin.from('crm_goals')
      .select('user_id, period_start, quote_value_target, order_value_target, invoiced_value_target')
      .eq('period_type', 'month')
      .in('period_start', months.map((month) => `${month}-01`))
      .order('id', { ascending: true })
      .range(from, to),
  );
}
