import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmQuoteStatus, updateCrmQuote } from '@/lib/domains/crm/quotes';
import { convertProspectToCustomer } from '@/lib/domains/crm/customers';
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

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const parsedBody = updateCrmQuoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Konvertera prospekt till kund vid statusövergång till 'won'
    if (parsedBody.data.status === 'won') {
      const { data: current, error: fetchError } = await getCrmQuoteStatus(supabase, context.params.id);

      if (fetchError) {
        return routeError(500, 'crm_quote_fetch_failed', fetchError.message);
      }

      // Konvertera bara vid övergång, inte vid re-sparning av redan vunnen offert
      // Använd DB:ns prospect_id, inte det som klienten skickade
      if (current.status !== 'won' && current.prospect_id) {
        const { error: conversionError } = await convertProspectToCustomer(
          supabase,
          current.prospect_id,
          crmUser.currentUser.id,
          crmUser.currentUser.id
        );

        if (conversionError) {
          return routeError(500, 'crm_customer_conversion_failed', conversionError);
        }
      }
    }

    const { data, error } = await updateCrmQuote(supabase, context.params.id, {
      ...parsedBody.data,
      currency_code: parsedBody.data.currency_code || 'SEK',
    });

    if (error) {
      return routeError(500, 'crm_quote_update_failed', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_quote_update_unexpected', e?.message || 'Failed to update quote');
  }
}