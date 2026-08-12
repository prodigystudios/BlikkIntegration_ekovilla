import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, updateCrmWorkOrderLineItems } from '@/lib/domains/crm/work-orders';
import { computePricing, type PricingLineItem } from '@/lib/domains/crm/pricing';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { activeLineItems, validateLineItemEdit } from '@/lib/domains/fortnox/partialInvoices';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
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

    // En FÄRDIGfakturerad order är avslutad — där finns inget kvar att rätta, och att ändra
    // summan efter sista fakturan skulle bara få CRM och bokföringen att säga olika saker.
    if (wo.status === 'invoiced' || wo.fortnox_invoice_number) {
      return routeError(409, 'work_order_locked', 'Arbetsordern är färdigfakturerad och kan inte ändras.');
    }

    // Delfakturerad order: raderna är INTE längre låsta som helhet. Rundorna nycklas på radens id
    // (20260812_invoice_rounds_line_ids.sql), så positionen är betydelselös och ett projekt kan
    // ändras medan det pågår — artiklar tillkommer och utgår. Kvar att skydda är bara det som redan
    // står på en utställd faktura; validateLineItemEdit äger den regeln.
    if (wo.partial_invoicing_started_at) {
      const { data: rounds } = await supabase
        .from('crm_work_order_invoices')
        .select('line_quantities')
        .eq('work_order_id', context.params.id);
      const verdict = validateLineItemEdit(wo.line_items, parsedBody.data.line_items as any, (rounds ?? []) as any);
      if (!verdict.ok) return routeError(409, 'work_order_line_invoiced', verdict.message);
    }

    const pricing = computePricing(activeLineItems(parsedBody.data.line_items) as PricingLineItem[], wo.vat_percent, {
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
        // friendlyFortnoxMessage, inte e.message: FortnoxApiError.message ÄR den tekniska
        // loggsträngen ("Fortnox POST /orders (400): {…}") och den hamnade rakt i säljarens toast.
        // Samma översättning som manuella "Synka om"-knappen redan gör.
        fortnoxError = friendlyFortnoxMessage(e);
        console.error('[fortnox] Arbetsorder-raduppdatering misslyckades:', (e as Error)?.message);
      }
    }

    // Re-fetch so the returned item reflects the post-sync Fortnox status.
    const fresh = await getCrmWorkOrder(supabase, context.params.id);
    return ok({ item: fresh.data ?? null, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_line_items_unexpected', e?.message || 'Failed to update work order line items');
  }
}
