import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmCall, listCrmCallsWithFilters } from '@/lib/domains/crm/calls';
import {
  createCrmCallSchema,
  listCrmCallsQuerySchema,
  ok,
  requireCrmUser,
  requirePermission,
  routeError,
  validationError,
} from './_lib';

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsedQuery = listCrmCallsQuerySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      prospect_id: url.searchParams.get('prospect_id') || undefined,
      customer_id: url.searchParams.get('customer_id') || undefined,
    });

    if (!parsedQuery.success) return validationError(parsedQuery.error);

    const supabase = createRouteHandlerClient({ cookies });
    const query = await listCrmCallsWithFilters(supabase, {
      search: parsedQuery.data.q,
      prospectId: parsedQuery.data.prospect_id,
      customerId: parsedQuery.data.customer_id,
    });
    const { data, error } = await query;

    if (error) {
      return routeError(500, 'crm_calls_list_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_calls_unexpected', e?.message || 'Failed to list calls');
  }
}

export async function POST(req: Request) {
  try {
    const crmUser = await requirePermission('crm.call.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = createCrmCallSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const payload = {
      ...parsedBody.data,
      user_id: crmUser.currentUser.id,
    };

    const { data, error } = await createCrmCall(supabase, payload);

    if (error) {
      return routeError(500, 'crm_call_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_call_unexpected', e?.message || 'Failed to create call');
  }
}