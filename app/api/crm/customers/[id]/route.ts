import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmCustomer, updateCrmCustomer } from '@/lib/domains/crm/customers';
import { ok, requireCrmUser, routeError, updateCrmCustomerSchema, validationError } from '../_lib';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmCustomer(supabase, context.params.id);

    if (error) {
      return routeError(404, 'crm_customer_not_found', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_get_unexpected', e?.message || 'Failed to get customer');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmCustomerSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmCustomer(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_customer_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_update_unexpected', e?.message || 'Failed to update customer');
  }
}
