import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmQuote, markCrmQuoteWon, updateCrmQuote, type UpdateCrmQuoteInput } from '@/lib/domains/crm/quotes';
import { pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import {
  ok,
  pickProvidedQuoteFields,
  requireCrmUser,
  requirePermission,
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
    const crmUser = await requirePermission('crm.offer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const rawBody = await req.json().catch(() => null);
    const parsedBody = updateCrmQuoteSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Persist only the fields the client actually sent, so a partial PATCH such as a
    // status change or a "clear articles" save doesn't overwrite untouched columns.
    const updateInput = pickProvidedQuoteFields(parsedBody.data, rawBody) as unknown as Partial<UpdateCrmQuoteInput>;
    if (updateInput.currency_code !== undefined) {
      updateInput.currency_code = updateInput.currency_code || 'SEK';
    }

    // markCrmQuoteWon / updateCrmQuote return loosely-typed mapped rows; treat as any.
    let data: any;
    if (parsedBody.data.status === 'won') {
      const result = await markCrmQuoteWon(
        supabase,
        context.params.id,
        crmUser.currentUser.id,
        crmUser.currentUser.id,
        updateInput
      );
      if (result.error) return routeError(500, result.error.code, result.error.message);
      data = result.data;
    } else {
      const result = await updateCrmQuote(supabase, context.params.id, updateInput);
      if (result.error) return routeError(500, 'crm_quote_update_failed', result.error.message);
      data = result.data;
    }

    // Auto-sync content edits to Fortnox so a saved quote stays in sync without the
    // salesperson having to press "Skicka igen" (mirrors the auto-push on create).
    // Only on real content edits (line_items sent) — not quick status flips — and only
    // while the offer is unlocked (no work order has converted it to an order yet).
    // Best-effort: the save always succeeds; a failed sync is surfaced as fortnox_error.
    let fortnoxError: string | null = null;
    const isContentEdit = !!rawBody && typeof rawBody === 'object' && 'line_items' in rawBody;
    if (data && isContentEdit && !data.work_order_id) {
      try {
        await pushQuoteToFortnox(context.params.id);
        // Re-read so the response reflects the fresh fortnox_offer_number / sync status.
        const refreshed = await getCrmQuote(supabase, context.params.id);
        if (refreshed.data) data = refreshed.data;
      } catch (e) {
        if (!(e instanceof FortnoxNotConnectedError)) {
          console.error('[fortnox] Auto-sync offert-uppdatering misslyckades:', (e as Error)?.message);
          fortnoxError = friendlyFortnoxMessage(e);
        }
      }
    }

    return ok({ item: data, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_quote_update_unexpected', e?.message || 'Failed to update quote');
  }
}