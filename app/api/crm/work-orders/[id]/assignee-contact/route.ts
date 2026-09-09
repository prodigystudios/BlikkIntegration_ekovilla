// getSupabaseAdmin: the field view (installers/member) needs to know WHO SOLD THE JOB — the person
// to call when something on the order doesn't add up — but `profiles` is self-read-only
// (profiles_select_self, auth_roles_setup.sql:71), so the `assignee:profiles!assigned_to` embed on
// the work order comes back null for everyone but yourself. This endpoint resolves only the
// assignee's name + phone. Nothing else of the profile: it also carries private_email, home address
// and next-of-kin (20260517_employee_profile_details.sql), and RLS is row level and cannot narrow
// columns — the column line is drawn in getWorkOrderAssigneeContact.
//
// ACCESS MODEL: identical to ../customer-contact, deliberately. The installer page
// (app/arbetsorder/[id]/page.tsx) is reachable by ANY signed-in user holding the work order's link —
// installers are not the order's `assigned_to` and have no CRM role, so crm_work_orders SELECT RLS
// would exclude them. The random UUIDv4 id is the capability (enumeration is infeasible), and the
// payload is limited to two fields. Do NOT tighten this to assigned_to/CRM-role without also
// rebuilding how installers are granted a work order — that would break the field flow.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getWorkOrderAssigneeContact } from '@/lib/domains/crm/work-orders';
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
    const { data, error } = await getWorkOrderAssigneeContact(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_assignee_failed', error.message);

    return ok({ contact: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_assignee_unexpected', e?.message || 'Failed to load assignee contact');
  }
}
