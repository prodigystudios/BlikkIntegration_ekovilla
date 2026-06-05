import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmCustomer } from '@/lib/domains/crm/customers';
import { createFortnoxCustomer, updateFortnoxCustomer } from '@/lib/domains/fortnox/customers';
import { ok, requireCrmUser, routeError } from '../../_lib';

type RouteContext = { params: { id: string } };

// Push an existing CRM customer to Fortnox on demand. Creates the customer in
// Fortnox if it isn't linked yet, otherwise re-syncs the existing record.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: existing, error } = await getCrmCustomer(supabase, context.params.id);
    if (error || !existing) {
      return routeError(404, 'crm_customer_not_found', error?.message || 'Kund hittades inte');
    }

    try {
      if (existing.fortnox_customer_id) {
        await updateFortnoxCustomer(context.params.id);
      } else {
        await createFortnoxCustomer(context.params.id);
      }
      const { data: synced } = await getCrmCustomer(supabase, context.params.id);
      return ok({ item: synced ?? existing });
    } catch (fortnoxErr: any) {
      const { data: latest } = await getCrmCustomer(supabase, context.params.id);
      return ok({
        item: latest ?? existing,
        fortnox_error: fortnoxErr?.message || 'Kunde inte skapa kund i Fortnox',
      });
    }
  } catch (e: any) {
    return routeError(500, 'crm_customer_fortnox_push_unexpected', e?.message || 'Failed to push customer to Fortnox');
  }
}
