import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listCrmWorkOrdersWithFilters, getCrmWorkOrderFilterCounts, createStandaloneCrmWorkOrder, CRM_WORK_ORDERS_PAGE_SIZE } from '@/lib/domains/crm/work-orders';
import { createStandaloneWorkOrderSchema, listCrmWorkOrdersQuerySchema, ok, requireCrmUser, requirePermission, routeError, validationError } from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmWorkOrdersQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      filter: url.searchParams.get('filter') || undefined,
      assignee: url.searchParams.get('assignee') || undefined,
      work_order_id: url.searchParams.get('work_order_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    // Assignee scope: a comma-separated list of user ids (the client resolves 'mine' to the
    // current user id before sending). Empty = everyone.
    const assignedToIn = (parsedQuery.data.assignee || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const search = parsedQuery.data.q;
    const filter = parsedQuery.data.filter;
    const offset = parsedQuery.data.offset ?? 0;
    const limit = parsedQuery.data.limit ?? CRM_WORK_ORDERS_PAGE_SIZE;

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmWorkOrdersWithFilters(supabase, {
      search,
      status: parsedQuery.data.status,
      filter,
      assignedToIn,
      workOrderId: parsedQuery.data.work_order_id,
      customerId: parsedQuery.data.customer_id,
      limit,
      offset,
    });
    const { data, error, count } = await query;

    if (error) {
      return routeError(500, 'crm_work_orders_list_failed', error.message);
    }

    // Per-filter chip counts (scoped to the same search + assignee filter). Only the board
    // requests them (counts=1, first page) — other consumers of this route (säljtavla, customer
    // detail, overview) skip the extra count queries.
    const wantCounts = url.searchParams.get('counts') === '1' && offset === 0;
    const counts = wantCounts ? await getCrmWorkOrderFilterCounts(supabase, { search, assignedToIn }) : undefined;

    return ok({ items: data || [], total: count ?? 0, offset, limit, counts });
  } catch (e: any) {
    return routeError(500, 'crm_work_orders_unexpected', e?.message || 'Failed to list work orders');
  }
}

// Create a standalone work order (no quote). Articles are added afterwards on the detail.
export async function POST(req: Request) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
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