import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listCrmWorkOrdersWithFilters, createStandaloneCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { createStandaloneWorkOrderSchema, listCrmWorkOrdersQuerySchema, ok, requireCrmUser, routeError, validationError } from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmWorkOrdersQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      work_order_id: url.searchParams.get('work_order_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmWorkOrdersWithFilters(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      workOrderId: parsedQuery.data.work_order_id,
      customerId: parsedQuery.data.customer_id,
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

// Create a standalone work order (no quote). Articles are added afterwards on the detail.
export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsed = createStandaloneWorkOrderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const result = await createStandaloneCrmWorkOrder(supabase, {
      customerId: parsed.data.customer_id,
      projectName: parsed.data.project_name,
      desiredInstallationDate: parsed.data.desired_installation_date,
      actorUserId: crmUser.currentUser.id,
    });

    if (result.error) {
      const status = result.reason === 'customer_not_found' ? 404 : 500;
      return routeError(status, `crm_work_order_${result.reason}`, result.error.message || 'Kunde inte skapa order');
    }

    return ok({ item: result.data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_create_unexpected', e?.message || 'Failed to create work order');
  }
}