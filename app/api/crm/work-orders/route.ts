import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listCrmWorkOrdersWithFilters } from '@/lib/domains/crm/work-orders';
import { listCrmWorkOrdersQuerySchema, ok, requireCrmUser, routeError, validationError } from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmWorkOrdersQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      work_order_id: url.searchParams.get('work_order_id') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmWorkOrdersWithFilters(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      workOrderId: parsedQuery.data.work_order_id,
    });
    const { data, error } = await query;

    if (error) {
      return routeError(500, 'crm_work_orders_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_orders_unexpected', e?.message || 'Failed to list work orders');
  }
}