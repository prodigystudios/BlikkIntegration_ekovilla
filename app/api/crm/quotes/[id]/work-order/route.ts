import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderFromQuote } from '@/lib/domains/crm/work-orders';
import { ok, requireCrmUser, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const result = await createCrmWorkOrderFromQuote(supabase, context.params.id, crmUser.currentUser.id);

    if (result.error || !result.data) {
      if (result.reason === 'not_found') {
        return routeError(404, 'crm_quote_not_found', result.error?.message || 'Offerten hittades inte');
      }

      if (result.reason === 'quote_not_won' || result.reason === 'already_created') {
        return routeError(409, result.reason, result.error?.message || 'Arbetsorder kunde inte skapas');
      }

      return routeError(500, 'crm_work_order_create_failed', result.error?.message || 'Kunde inte skapa arbetsorder');
    }

    return ok(result.data, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_unexpected', e?.message || 'Failed to create CRM work order');
  }
}