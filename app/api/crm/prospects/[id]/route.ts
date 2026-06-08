import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateCrmProspect } from '@/lib/domains/crm/prospects';
import {
  ok,
  requireCrmWriter,
  routeError,
  updateCrmProspectSchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmProspectSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmProspect(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_prospect_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_prospect_update_unexpected', e?.message || 'Failed to update prospect');
  }
}