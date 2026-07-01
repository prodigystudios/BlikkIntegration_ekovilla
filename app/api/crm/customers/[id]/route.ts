import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmCustomer, updateCrmCustomer } from '@/lib/domains/crm/customers';
import { updateFortnoxCustomer, fortnoxCustomerFieldsChanged } from '@/lib/domains/fortnox/customers';
import { invalidUuidParam, ok, requireCrmUser, requirePermission, routeError, updateCrmCustomerSchema, validationError } from '../_lib';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

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
    const crmUser = await requirePermission('crm.customer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsedBody = updateCrmCustomerSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Snapshot the pre-update row so we can tell whether any Fortnox-relevant field
    // actually changed (avoids pushing to Fortnox on notes/status/owner-only edits).
    const { data: before } = await getCrmCustomer(supabase, context.params.id);

    // NOTE: a private customer may lack personal_number (sales sometimes get it only once the
    // job is booked). It is no longer required here — it is enforced when a work order is
    // created for the customer. This PATCH is also the path the "Ny order" / quote→order flows
    // use to save the personnummer the seller supplies at that point.

    const { data, error } = await updateCrmCustomer(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_customer_update_failed', error.message);
    }

    // Keep Fortnox in sync for already-linked customers so invoicing data stays
    // correct. Only push when a synced field changed. Failures are surfaced as a
    // warning – the DB update already succeeded.
    if (data?.fortnox_customer_id && fortnoxCustomerFieldsChanged(before, data)) {
      try {
        await updateFortnoxCustomer(context.params.id);
        const { data: synced } = await getCrmCustomer(supabase, context.params.id);
        return ok({ item: synced ?? data });
      } catch (fortnoxErr: any) {
        const { data: latest } = await getCrmCustomer(supabase, context.params.id);
        return ok({
          item: latest ?? data,
          fortnox_error: fortnoxErr?.message || 'Kunde inte uppdatera kund i Fortnox',
        });
      }
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_update_unexpected', e?.message || 'Failed to update customer');
  }
}
