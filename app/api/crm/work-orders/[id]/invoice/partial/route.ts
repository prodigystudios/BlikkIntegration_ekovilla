import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, listWorkOrderInvoiceRounds } from '@/lib/domains/crm/work-orders';
import { createPartialInvoice, PartialInvoiceError } from '@/lib/domains/fortnox/partialInvoices';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, invalidUuidParam, partialInvoiceSchema, validationError } from '../../../_lib';

type RouteContext = { params: { id: string } };

// Create ONE delfakturering (partial invoice) round in Fortnox from a work order: invoice the
// requested per-article quantities now, the rest later. Gated to status `completed` /
// `partially_invoiced`. On success the order becomes `partially_invoiced` ("Delfakturerad"), or
// `invoiced` ("Avslutad") when the last of every line is billed. The app owns the per-article
// state — see lib/domains/fortnox/partialInvoices.ts.
export async function POST(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('fortnox.invoice.create');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = partialInvoiceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: current, error: readError } = await getCrmWorkOrder(supabase, context.params.id);
    if (readError) return routeError(500, 'crm_work_order_fetch_failed', readError.message);
    if (!current) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    if (current.status !== 'completed' && current.status !== 'partially_invoiced') {
      return routeError(409, 'work_order_not_ready_for_invoice', 'Sätt arbetsordern till "Fakturera" innan du delfakturerar.');
    }
    if (!(Array.isArray(current.line_items) && current.line_items.length > 0)) {
      return routeError(409, 'work_order_has_no_articles', 'Arbetsordern saknar artiklar att fakturera.');
    }

    try {
      await createPartialInvoice(context.params.id, parsed.data.lines, crmUser.currentUser.id);
    } catch (e) {
      if (e instanceof PartialInvoiceError) return routeError(409, 'partial_invoice_invalid', e.message);
      if (e instanceof FortnoxNotConnectedError) return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
      if (e instanceof FortnoxPushInProgressError) return routeError(409, 'fortnox_push_in_progress', friendlyFortnoxMessage(e));
      console.error('[Fortnox] partial invoice:', (e as Error)?.message);
      return routeError(502, 'fortnox_invoice_failed', friendlyFortnoxMessage(e));
    }

    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_fetch_failed', error.message);
    const { data: rounds } = await listWorkOrderInvoiceRounds(supabase, context.params.id);

    return ok({ item: data, rounds: rounds ?? [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_partial_invoice_unexpected', e?.message || 'Failed to create partial invoice');
  }
}
