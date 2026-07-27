import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { searchCrmCustomers, getCrmCustomerDisplayName } from '@/lib/domains/crm/customers';
import { resolveCrmContact, type CrmContactSource } from '@/lib/domains/crm/contacts';
import { ok, requireCrmUser, routeError, validationError, searchCrmCustomersQuerySchema } from '../_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = searchCrmCustomersQuerySchema.safeParse({ q: url.searchParams.get('q') || '' });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await searchCrmCustomers(supabase, parsed.data.q);

    if (error) return routeError(500, 'crm_customers_search_failed', error.message);

    const results = (data ?? []).map((c) => {
      // Shared rule (resolveCrmContact) — reading the contact rows alone showed no phone at
      // all for the many customers whose number sits on the card.
      const contact = resolveCrmContact(c as CrmContactSource);
      const addr = c.visit_address as Record<string, string | null> | null;
      return {
        id: c.id,
        customer_stage: c.customer_stage,
        customer_type: c.customer_type,
        display_name: getCrmCustomerDisplayName(c as Parameters<typeof getCrmCustomerDisplayName>[0]),
        organization_number: c.organization_number ?? null,
        primary_contact_name: contact.name || null,
        primary_contact_phone: contact.phone || null,
        city: addr?.city ?? null,
      };
    });

    return ok({ items: results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to search customers';
    return routeError(500, 'crm_customers_search_unexpected', msg);
  }
}
