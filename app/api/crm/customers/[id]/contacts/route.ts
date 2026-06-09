import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmCustomerContact } from '@/lib/domains/crm/customers';
import { createCrmCustomerContactSchema, ok, requirePermission, routeError, validationError } from '../../_lib';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.customer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmCustomerContactSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmCustomerContact(supabase, {
      ...parsedBody.data,
      customer_id: context.params.id,
    });

    if (error) {
      return routeError(500, 'crm_customer_contact_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_customer_contact_create_unexpected', e?.message || 'Failed to create contact');
  }
}
