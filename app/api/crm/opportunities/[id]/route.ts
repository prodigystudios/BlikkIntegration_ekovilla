import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmOpportunity, updateCrmOpportunity } from '@/lib/domains/crm/opportunities';
import {
  ok,
  requireCrmUser,
  requirePermission,
  routeError,
  updateCrmOpportunitySchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmOpportunity(supabase, context.params.id);

    if (error) {
      return routeError(404, 'crm_opportunity_not_found', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_opportunity_get_unexpected', e?.message || 'Failed to get opportunity');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.opportunity.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmOpportunitySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmOpportunity(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_opportunity_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_opportunity_update_unexpected', e?.message || 'Failed to update opportunity');
  }
}
