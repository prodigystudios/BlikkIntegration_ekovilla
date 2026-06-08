import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmCustomer, getCrmCustomer, listCrmCustomers } from '@/lib/domains/crm/customers';
import { createFortnoxCustomer } from '@/lib/domains/fortnox/customers';
import {
  createCrmCustomerSchema,
  listCrmCustomersQuerySchema,
  ok,
  requireCrmUser,
  requireCrmWriter,
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
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmCustomerSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const { create_in_fortnox, ...customerData } = parsedBody.data;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmCustomer(supabase, {
      ...customerData,
      created_by: crmUser.currentUser.id,
      assigned_to: crmUser.currentUser.id,
    });

    if (error) {
      return routeError(500, 'crm_customer_create_failed', error.message);
    }

    if (!data) {
      return routeError(500, 'crm_customer_create_failed', 'Kund skapades inte');
    }

    if (create_in_fortnox) {
      try {
        await createFortnoxCustomer(data.id);
        // Re-fetch to get the updated fortnox_customer_id and customer_stage
        const { data: updated } = await getCrmCustomer(supabase, data.id);
        return ok({ item: updated ?? data }, 201);
      } catch (fortnoxErr: any) {
        // Fortnox push failed – customer exists in our DB, return with warning
        return ok({ item: data, fortnox_error: fortnoxErr?.message || 'Kunde inte skapa kund i Fortnox' }, 201);
      }
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_customer_create_unexpected', e?.message || 'Failed to create customer');
  }
}
