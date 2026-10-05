import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { countWorkOrderInvoiceRounds, getCrmWorkOrder, listWorkOrderInvoiceRounds, workOrderInvoicingStarted } from '@/lib/domains/crm/work-orders';
import { createInvoiceFromWorkOrder } from '@/lib/domains/fortnox/orders';
import { invoiceRemainingForWorkOrder, PartialInvoiceError } from '@/lib/domains/fortnox/partialInvoices';
import { FortnoxInvoiceNotRecordedError, FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, invalidUuidParam } from '../../_lib';

type RouteContext = { params: { id: string } };

// Create a draft invoice in Fortnox from a work order — "Fakturera allt" (invoice everything).
// Gated to status `completed` ("Fakturera"). On success the work order moves to `invoiced`
// ("Avslutad"); the actual invoicing happens inside Fortnox.
//
// Two paths share this endpoint:
//   • No partial round yet → the proven one-shot path (createInvoiceFromWorkOrder → the Fortnox
//     order's createinvoice), which keeps the order↔invoice link.
//   • Delfakturering already started → invoice the REMAINING per-article quantities as a final
//     round (invoiceRemainingForWorkOrder). We must NOT re-run the order createinvoice then — it
//     would re-bill the full order on top of the partial invoices already issued.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('fortnox.invoice.create');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createSessionClient();
    const { data: current, error: readError } = await getCrmWorkOrder(supabase, context.params.id);
    if (readError) return routeError(500, 'crm_work_order_fetch_failed', readError.message);
    if (!current) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    // 🧨 RUNDORNA RÄKNAS OCKSÅ, inte bara status och kolumn. createPartialInvoice skriver dem EFTER
    // rundan; fallerar den skrivningen står ordern kvar som "Fakturera" utan kolumn. Utan rundorna
    // här gick "Fakturera allt" då till orderns createinvoice — som fakturerar HELA ordern, också
    // det som redan delfakturerats. Samma fråga som avbrytandet ställer (workOrderCancel.ts), och med
    // admin-klienten av samma skäl som där: sessionens RLS får inte kunna dölja rundorna — noll
    // synliga rundor hade skickat ordern till createinvoice. Bara ett antal läses, och permissionen
    // är redan prövad ovan.
    // Fail closed: ett läsfel får aldrig se ut som "inga rundor".
    const { count: roundCount, error: roundsError } = await countWorkOrderInvoiceRounds(getSupabaseAdmin(), context.params.id);
    if (roundsError || roundCount == null) {
      return routeError(500, 'crm_work_order_rounds_fetch_failed', roundsError?.message || 'Kunde inte läsa fakturarundorna.');
    }
    const partialStarted = workOrderInvoicingStarted(current, roundCount);

    // Allow only when the order is set for invoicing or mid-delfakturering, unless it's already
    // invoiced (idempotent re-run after a transient failure).
    if (current.status !== 'completed' && !partialStarted && !current.fortnox_invoice_number) {
      return routeError(409, 'work_order_not_ready_for_invoice', 'Sätt arbetsordern till "Fakturera" innan du skapar faktura.');
    }

    // Don't create an empty draft invoice (a standalone order that never got articles would
    // otherwise produce a zero-row invoice in Fortnox). The idempotent re-run is exempt.
    if (!current.fortnox_invoice_number && !(Array.isArray(current.line_items) && current.line_items.length > 0)) {
      return routeError(409, 'work_order_has_no_articles', 'Arbetsordern saknar artiklar att fakturera.');
    }

    try {
      if (partialStarted) {
        await invoiceRemainingForWorkOrder(context.params.id, crmUser.currentUser.id);
      } else {
        await createInvoiceFromWorkOrder(context.params.id);
      }
    } catch (e) {
      if (e instanceof PartialInvoiceError) {
        return routeError(409, 'partial_invoice_invalid', e.message);
      }
      if (e instanceof FortnoxNotConnectedError) {
        return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
      }
      if (e instanceof FortnoxPushInProgressError) {
        return routeError(409, 'fortnox_push_in_progress', friendlyFortnoxMessage(e));
      }
      // Fakturan FINNS — egen kod, så att svaret aldrig läses som "ingenting skapades".
      if (e instanceof FortnoxInvoiceNotRecordedError) return routeError(500, 'fortnox_invoice_not_recorded', e.message);
      console.error('[Fortnox] create invoice:', (e as Error)?.message);
      return routeError(502, 'fortnox_invoice_failed', friendlyFortnoxMessage(e));
    }

    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_fetch_failed', error.message);
    const { data: rounds } = await listWorkOrderInvoiceRounds(supabase, context.params.id);

    return ok({ item: data, rounds: rounds ?? [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_invoice_unexpected', e?.message || 'Failed to create invoice');
  }
}
