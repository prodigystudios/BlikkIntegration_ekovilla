import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, invalidUuidParam, isNoRowsError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Manual (re)push of a work order to Fortnox. Uses updateWorkOrderInFortnox so it does a
// REAL re-sync when an order already exists (PUT the current rows) — "Synka om" / "Försök
// igen" must actually re-send, not short-circuit. If no order exists yet it creates one.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('fortnox.workorder.push');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });

    // 🧨 EN FAKTURERAD ORDER FÅR INTE SYNKAS OM — försöket kan bara göra skada.
    //
    // Fortnox avvisar varje skrivning mot ett fakturerat dokument, så `updateWorkOrderInFortnox`
    // kastar och dess catch stämplar `fortnox_order_sync_status: 'failed'`. En order som stod
    // 'synced' degraderas alltså av ett anrop som aldrig kunde lyckas — och en kvarstående
    // 'failed' spärrar i sin tur faktureringen via `assertOrderRowsSynced`.
    //
    // ⚠️ SPÄRREN MÅSTE STÅ HÄR, inte bara i ordervyn. Knappen är dold (WorkOrderDetailClient,
    // `fortnoxClosed`), men en flik som stod öppen när ordern fakturerades någon annanstans har
    // den kvar — och routen är dessutom nåbar direkt för var och en med `fortnox.workorder.push`.
    // Mätt i drift på order 131: en omsynk på den redan fakturerade ordern flyttade den från
    // 'synced' till 'failed'.
    // 🧨 FAIL-CLOSED PÅ LÄSFELET, som PATCH-vägen. Sväljs felet går omsynken vidare mot en order vi
    // inte vet något om — och är den fakturerad stämplas den 'failed' av ett anrop som aldrig kunde
    // lyckas, med knappen nu dold så ingenting förklarar var statusen kom ifrån.
    const { data: currentRow, error: readError } = await getCrmWorkOrder(supabase, context.params.id);
    if (readError) {
      if (isNoRowsError(readError)) {
        return routeError(404, 'crm_work_order_not_found', 'Arbetsorder hittades inte.');
      }
      console.error('[fortnox] Läsning före omsynk misslyckades:', readError.message);
      return routeError(503, 'crm_work_order_read_failed',
        'Kunde inte läsa arbetsordern just nu. Försök igen — ingenting har ändrats.');
    }
    const current = currentRow as { status?: string | null; fortnox_invoice_number?: string | null } | null;
    if (current && (current.status === 'invoiced' || current.fortnox_invoice_number)) {
      return routeError(409, 'crm_work_order_invoiced_locked',
        'Ordern är fakturerad i Fortnox och kan inte synkas om. Rättningar går att göra i CRM, '
        + 'men når inte kundens orderbekräftelse eller faktura.');
    }

    let fortnoxError: string | null = null;
    try {
      await updateWorkOrderInFortnox(context.params.id);
    } catch (e) {
      if (e instanceof FortnoxNotConnectedError) {
        return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
      }
      if (e instanceof FortnoxPushInProgressError) {
        return routeError(409, 'fortnox_push_in_progress', friendlyFortnoxMessage(e));
      }
      console.error('[Fortnox] work order push:', (e as Error)?.message);
      fortnoxError = friendlyFortnoxMessage(e);
    }

    const { data, error } = await getCrmWorkOrder(supabase, context.params.id);
    if (error) return routeError(500, 'crm_work_order_fetch_failed', error.message);

    return ok({ item: data, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_fortnox_unexpected', e?.message || 'Failed to push work order');
  }
}
