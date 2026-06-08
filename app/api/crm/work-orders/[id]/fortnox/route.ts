import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, invalidUuidParam } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Manual (re)push of a work order to Fortnox. Uses updateWorkOrderInFortnox so it does a
// REAL re-sync when an order already exists (PUT the current rows) — "Synka om" / "Försök
// igen" must actually re-send, not short-circuit. If no order exists yet it creates one.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('fortnox.workorder.push');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    let fortnoxError: string | null = null;
    try {
      await updateWorkOrderInFortnox(context.params.id);
    } catch (e) {
      if (e instanceof FortnoxNotConnectedError) {
        return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
      }
      if (e instanceof FortnoxPushInProgressError) {
        return routeError(409, 'fortnox_push_in_progress', friendlyFortnoxMessage(e));
      }
      console.error('[Fortnox] work order push:', (e as Error)?.message);
      fortnoxError = friendlyFortnoxMessage(e);
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_fetch_failed', error.message);

    return ok({ item: data, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fortnox_unexpected', e?.message || 'Failed to push work order');
  }
}
