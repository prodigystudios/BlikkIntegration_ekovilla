import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, saveWorkOrderLineItems } from '@/lib/domains/crm/work-orders';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, updateWorkOrderLineItemsSchema, validationError, invalidUuidParam } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Redigera artikelraderna på en arbetsorder: ändra, lägga till, ta bort och skriva av
// (`written_off`) går alla samma väg. Reglerna för vad som är tillåtet när fakturor redan gått ut
// bor i domänen (saveWorkOrderLineItems → validateLineItemEdit); routen resolvar auth, validerar
// formen, och speglar resultatet till Fortnox. Synken är icke-fatal — sparningen har redan lyckats.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsedBody = updateWorkOrderLineItemsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });
    const result = await saveWorkOrderLineItems(supabase, context.params.id, parsedBody.data.line_items);

    if (result.error) {
      const status = result.reason === 'not_found' ? 404
        : result.reason === 'order_closed' || result.reason === 'line_invoiced' ? 409
        : 500;
      const code = result.reason === 'order_closed' ? 'work_order_locked'
        : result.reason === 'line_invoiced' ? 'work_order_line_invoiced'
        : `crm_work_order_line_items_${result.reason}`;
      return routeError(status, code, result.error.message);
    }

    let fortnoxError: string | null = null;
    try {
      await updateWorkOrderInFortnox(context.params.id);
    } catch (e) {
      if (!(e instanceof FortnoxNotConnectedError)) {
        // friendlyFortnoxMessage, inte e.message: FortnoxApiError.message ÄR den tekniska
        // loggsträngen ("Fortnox POST /orders (400): {…}") och den hamnade rakt i säljarens toast.
        fortnoxError = friendlyFortnoxMessage(e);
        console.error('[fortnox] Arbetsorder-raduppdatering misslyckades:', (e as Error)?.message);
      }
    }

    // Läs om så svaret bär Fortnox-status efter synken.
    const fresh = await getCrmWorkOrder(supabase, context.params.id);
    return ok({ item: fresh.data ?? result.data, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_line_items_unexpected', e?.message || 'Failed to update work order line items');
  }
}
