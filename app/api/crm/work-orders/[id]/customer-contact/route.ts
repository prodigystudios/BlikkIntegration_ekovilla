// getSupabaseAdmin: the field view (installers/member) needs the customer contact for a
// work order but has no CRM read access to crm_customers. This endpoint resolves only the
// name/phone/email for the work order's linked customer — nothing else of the customer.
//
// ACCESS MODEL (deliberate): this mirrors the installer page (app/arbetsorder/[id]/page.tsx),
// which is intentionally reachable by ANY signed-in user holding the work order's link —
// installers are not the order's `assigned_to` and have no CRM role, so the crm_work_orders
// SELECT RLS would exclude them. The random UUIDv4 id is the capability (enumeration is
// infeasible), and the payload is deliberately limited to contact fields. Do NOT tighten
// this to assigned_to/CRM-role without also rebuilding how installers are granted a work
// order — that would break the field flow. Auth here is therefore "signed-in + holds the id".
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
