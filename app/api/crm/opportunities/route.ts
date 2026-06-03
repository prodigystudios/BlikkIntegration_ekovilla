import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmOpportunity, listCrmOpportunities } from '@/lib/domains/crm/opportunities';
import {
  createCrmOpportunitySchema,
  listCrmOpportunitiesQuerySchema,
  ok,
  requireCrmUser,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmOpportunitiesQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      status: url.searchParams.get('status') || undefined,
      prospect_id: url.searchParams.get('prospect_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
    });
    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCrmOpportunities(supabase, {
      search: parsedQuery.data.q,
      status: parsedQuery.data.status,
      prospectId: parsedQuery.data.prospect_id,
      customerId: parsedQuery.data.customer_id,
    });

    if (error) {
      return routeError(500, 'crm_opportunities_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_opportunities_unexpected', e?.message || 'Failed to list opportunities');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmOpportunitySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createCrmOpportunity(supabase, {
      ...parsedBody.data,
      created_by: crmUser.currentUser.id,
      assigned_to: crmUser.currentUser.id,
    });

    if (error) {
      return routeError(500, 'crm_opportunity_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_opportunity_create_unexpected', e?.message || 'Failed to create opportunity');
  }
}
