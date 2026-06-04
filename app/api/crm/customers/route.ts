import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmCustomer, listCrmCustomers } from '@/lib/domains/crm/customers';
import {
  createCrmCustomerSchema,
  listCrmCustomersQuerySchema,
  ok,
  requireCrmUser,
  routeError,
  validationError,
} from './_lib';
import type { CrmCustomerStage } from '@/lib/domains/crm/customers';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmCustomersQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      stage: url.searchParams.get('stage') || undefined,
      assigned_to: url.searchParams.get('assigned_to') || undefined,
    });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCrmCustomers(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      stage: parsedQuery.data.stage as CrmCustomerStage | undefined,
      assignedTo: parsedQuery.data.assigned_to,
    });

    if (error) {
      return routeError(500, 'crm_customers_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_customers_unexpected', e?.message || 'Failed to list customers');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmCustomerSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmCustomer(supabase, {
      ...parsedBody.data,
      created_by: crmUser.currentUser.id,
      assigned_to: crmUser.currentUser.id,
    });

    if (error) {
      return routeError(500, 'crm_customer_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_customer_create_unexpected', e?.message || 'Failed to create customer');
  }
}
