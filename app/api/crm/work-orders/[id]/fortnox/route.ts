import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { pushWorkOrderToFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { ok, requireCrmUser, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Manual (re)push of a work order to Fortnox as an order. Used to retry a failed
// auto-push or to push an order that was never synced. pushWorkOrderToFortnox sets
// fortnox_order_sync_status itself; we re-fetch so the client gets the new state.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    let fortnoxError: string | null = null;
    try {
      await pushWorkOrderToFortnox(context.params.id);
    } catch (e) {
      if (e instanceof FortnoxNotConnectedError) {
        return routeError(409, 'fortnox_not_connected', 'Fortnox är inte anslutet');
      }
      fortnoxError = (e as any)?.message || 'Fortnox-push misslyckades';
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_fetch_failed', error.message);

    return ok({ item: data, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fortnox_unexpected', e?.message || 'Failed to push work order');
  }
}
