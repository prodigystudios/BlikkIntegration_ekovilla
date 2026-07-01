import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteCrmCustomerContact, updateCrmCustomerContact } from '@/lib/domains/crm/customers';
import { invalidUuidParam, ok, requirePermission, routeError, updateCrmCustomerContactSchema, validationError } from '../../../_lib';

type RouteContext = { params: { id: string; contactId: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.customer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.contactId);
    if (badId) return badId;

    const parsedBody = updateCrmCustomerContactSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmCustomerContact(supabase, context.params.contactId, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_customer_contact_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_contact_update_unexpected', e?.message || 'Failed to update contact');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.customer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.contactId);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await deleteCrmCustomerContact(supabase, context.params.contactId);

    if (error) {
      return routeError(500, 'crm_customer_contact_delete_failed', error.message);
    }

    return ok({ deleted: true });
  } catch (e: any) {
    return routeError(500, 'crm_customer_contact_delete_unexpected', e?.message || 'Failed to delete contact');
  }
}
