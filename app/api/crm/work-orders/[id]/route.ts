import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrder, listWorkOrderInvoiceRounds } from '@/lib/domains/crm/work-orders';
import { ok, pickProvidedFields, requireCrmUser, requirePermission, requireSignedInUser, routeError, updateCrmWorkOrderSchema, validationError } from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    // Read is open to any signed-in employee (installers/member read the field view);
    // editing (PATCH below) stays restricted to CRM roles.
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);

    if (error) return routeError(404, 'crm_work_order_not_found', error.message);

    // Delfakturering rounds (empty for orders never partially invoiced) so the detail page can
    // render the invoice history on load.
    const { data: rounds } = await listWorkOrderInvoiceRounds(supabase, context.params.id);

    return ok({ item: data, rounds: rounds ?? [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fetch_unexpected', e?.message || 'Failed to fetch work order');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const rawBody = await req.json().catch(() => null);
    const parsedBody = updateCrmWorkOrderSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    // Persist only fields the client actually sent, so a partial PATCH (e.g. a status-only
    // change) doesn't wipe untouched columns (internal_handoff, work_address) with defaults.
    const updateInput = pickProvidedFields(parsedBody.data, rawBody);
    const { data, error } = await updateCrmWorkOrder(supabase, context.params.id, updateInput);

    if (error) {
      return routeError(500, 'crm_work_order_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_update_unexpected', e?.message || 'Failed to update work order');
  }
}