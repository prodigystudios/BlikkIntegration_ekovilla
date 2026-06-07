// getSupabaseAdmin: the field view (installers/member) needs the customer contact for a
// work order but has no CRM read access to crm_customers. This endpoint resolves only the
// name/phone/email for the work order's linked customer — nothing else of the customer.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getWorkOrderCustomerContact } from '@/lib/domains/crm/work-orders';
import { ok, requireSignedInUser, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await getWorkOrderCustomerContact(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_contact_failed', error.message);

    return ok({ contact: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_contact_unexpected', e?.message || 'Failed to load customer contact');
  }
}
