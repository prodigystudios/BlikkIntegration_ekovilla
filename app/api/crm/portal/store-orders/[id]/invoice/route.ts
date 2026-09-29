import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invoiceStoreOrder } from '@/lib/domains/portal/storeOrderFulfilment';
import { ok, routeError } from '../../../../_shared';
import { requireStoreOrderManager, storeOrderFortnoxErrorResponse } from '../../_manage';

type RouteContext = { params: { id: string } };

// Fakturera en levererad butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b2): fakturan skapas i Fortnox ur
// Fortnox-ordern (createinvoice), som ett utkast som ekonomi bokför och skickar. En faktura som redan finns kopplas bara.
//
//   200 { fortnox_invoice_number, source }        source: created | adopted (fanns i Fortnox) | already (redan här)
//   403 store_order_forbidden                     varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_delivered                 inte levererad
//   409 store_order_invoice_in_progress           ett annat försök skapar fakturan just nu
//   409 store_order_fortnox_order_cancelled       Fortnox-ordern är makulerad i Fortnox
//   409 fortnox_not_connected
//   502 store_order_fortnox_failed                Fortnox nekade, med Fortnox text
//   500 store_order_invoice_unsaved               fakturan finns i Fortnox, men numret sparades inte här
//   500 store_order_invoice_failed

export const dynamic = 'force-dynamic';
// Läsningen av ordern, createinvoice och läsningen igen, var och en med upp till ~23 s väntan vid 429.
export const maxDuration = 120;

export async function POST(_req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const result = await invoiceStoreOrder(getSupabaseAdmin(), { id: context.params.id, actor: { id: gate.userId } });
    switch (result.kind) {
      case 'invoiced':
        return ok({ fortnox_invoice_number: result.invoiceNumber, source: result.source });
      case 'not_found':
        return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
      case 'not_delivered':
        return routeError(409, 'store_order_not_delivered', 'Bara en levererad beställning kan faktureras.');
      case 'busy':
        return routeError(409, 'store_order_invoice_in_progress', 'Fakturan skapas redan av ett annat försök. Ladda om sidan om en stund.');
      case 'fortnox_order_cancelled':
        return routeError(
          409,
          'store_order_fortnox_order_cancelled',
          `Fortnox-order ${result.orderNumber} är makulerad i Fortnox, så ingen faktura kan skapas ur den.`,
        );
      case 'unsaved':
        return routeError(
          500,
          'store_order_invoice_unsaved',
          `Faktura ${result.invoiceNumber} skapades i Fortnox, men numret kunde inte sparas här. Tryck Fakturera igen om en stund, så kopplas den; ingen ny faktura skapas.`,
        );
    }
  } catch (e) {
    const fortnox = storeOrderFortnoxErrorResponse(e);
    console.error('[portal-store-orders] fakturan kunde inte skapas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return fortnox ?? routeError(500, 'store_order_invoice_failed', 'Fakturan kunde inte skapas.');
  }
}
