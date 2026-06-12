import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getDepotStock } from '@/lib/domains/planning/depotStock';
import { ok, routeError, requirePermission } from '../_lib';

// Per-depot, per-material balances (deliveries − derived consumption).
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getDepotStock(supabase);
    if (error) return routeError(500, 'planning_depot_stock_failed', error.message);

    return ok({ depots: data });
  } catch (e: any) {
    return routeError(500, 'planning_depot_stock_unexpected', e?.message || 'Failed to load depot stock');
  }
}
