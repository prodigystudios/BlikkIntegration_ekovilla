import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrderLineItems } from '@/lib/domains/crm/work-orders';
import { computePricing, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, updateWorkOrderLineItemsSchema, validationError, invalidUuidParam } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Edit/add/remove article rows on a work order. Recomputes totals server-side (shared
// pricing), persists, then pushes the corrected rows to the Fortnox order. The Fortnox
// sync is non-fatal — the save succeeds and the reason is returned so the UI can show it.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsedBody = updateWorkOrderLineItemsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    const current = await getCrmWorkOrder(supabase, context.params.id);
    if (current.error || !current.data) return routeError(404, 'crm_work_order_not_found', current.error?.message || 'Arbetsordern hittades inte');

    const wo = current.data as any;

    // Lock: once a work order is invoiced — fully OR in part (delfakturering) — its articles must
    // not change. The rows would silently diverge from the already-issued invoice(s) and, for
    // partial invoicing, shifting line_items would break the array-index match used to track
    // invoiced-vs-remaining per article. The UI hides the editor in these states; this is the
    // server-side guarantee.
    if (
      wo.status === 'invoiced' ||
      wo.status === 'partially_invoiced' ||
      wo.fortnox_invoice_number ||
      wo.partial_invoicing_started_at
    ) {
      return routeError(409, 'work_order_locked', 'Arbetsordern är fakturerad och kan inte ändras.');
    }

    const pricing = computePricing(parsedBody.data.line_items as PricingLineItem[], wo.vat_percent, {
      isPrivate: wo.quote_type === 'private',
      rot: wo.rot_details ?? null,
    });

    const { error } = await updateCrmWorkOrderLineItems(supabase, context.params.id, parsedBody.data.line_items, pricing);
    if (error) return routeError(500, 'crm_work_order_line_items_update_failed', error.message);

    // Push corrected rows to the Fortnox order (non-fatal).
    let fortnoxError: string | null = null;
    try {
      await updateWorkOrderInFortnox(context.params.id);
    } catch (e) {
      if (!(e instanceof FortnoxNotConnectedError)) {
        fortnoxError = (e as any)?.message || 'Fortnox-synk misslyckades';
        console.error('[fortnox] Arbetsorder-raduppdatering misslyckades:', fortnoxError);
      }
    }

    // Re-fetch so the returned item reflects the post-sync Fortnox status.
    const fresh = await getCrmWorkOrder(supabase, context.params.id);
    return ok({ item: fresh.data ?? null, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_line_items_unexpected', e?.message || 'Failed to update work order line items');
  }
}
