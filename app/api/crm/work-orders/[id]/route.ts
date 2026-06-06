import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { ok, requireCrmUser, routeError, updateCrmWorkOrderSchema, validationError } from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);

    if (error) return routeError(404, 'crm_work_order_not_found', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fetch_unexpected', e?.message || 'Failed to fetch work order');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmWorkOrderSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmWorkOrder(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_work_order_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_update_unexpected', e?.message || 'Failed to update work order');
  }
}