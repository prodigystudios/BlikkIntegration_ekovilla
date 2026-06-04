import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmQuote, markCrmQuoteWon, updateCrmQuote } from '@/lib/domains/crm/quotes';
import {
  ok,
  requireCrmUser,
  routeError,
  updateCrmQuoteSchema,
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
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCrmQuote(supabase, context.params.id);

    if (error) return routeError(404, 'crm_quote_not_found', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_quote_fetch_unexpected', e?.message || 'Failed to fetch quote');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmQuoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const updateInput = { ...parsedBody.data, currency_code: parsedBody.data.currency_code || 'SEK' };

    if (parsedBody.data.status === 'won') {
      const { data, error } = await markCrmQuoteWon(
        supabase,
        context.params.id,
        crmUser.currentUser.id,
        crmUser.currentUser.id,
        updateInput
      );
      if (error) return routeError(500, error.code, error.message);
      return ok({ item: data });
    }

    const { data, error } = await updateCrmQuote(supabase, context.params.id, updateInput);
    if (error) return routeError(500, 'crm_quote_update_failed', error.message);
    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_quote_update_unexpected', e?.message || 'Failed to update quote');
  }
}