import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateCrmCall } from '@/lib/domains/crm/calls';
import {
  ok,
  requirePermission,
  routeError,
  updateCrmCallSchema,
  validationError,
} from '../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.call.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmCallSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateCrmCall(supabase, context.params.id, parsedBody.data);

    if (error) {
      return routeError(500, 'crm_call_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_call_update_unexpected', e?.message || 'Failed to update call');
  }
}