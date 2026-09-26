import { createSessionClient } from '@/lib/supabase/session';
import { getCrmWorkOrder, isFortnoxOrderClosed } from '@/lib/domains/crm/work-orders';
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

    const supabase = createSessionClient();

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
    // ⚠️ HELFAKTURERAD, inte "har ett fakturanummer". Delfaktureringens slutrunda sätter också
    // `fortnox_invoice_number`, men de fakturorna är FRISTÅENDE och Fortnox-ordern är fortfarande
    // öppen — och eftersom delfaktureringen inte gatar på synkstatusen kan en sådan order stå på
    // 'failed' med "Synka om" som enda väg tillbaka. Se isFortnoxOrderClosed.
    if (isFortnoxOrderClosed(currentRow as Parameters<typeof isFortnoxOrderClosed>[0])) {
      return routeError(409, 'crm_work_order_invoiced_locked',
        'Ordern är fakturerad i Fortnox och kan inte synkas om. Rättningar går att göra i CRM, '
        + 'men når inte kundens orderbekräftelse eller faktura.');
    }

    let fortnoxError: string | null = null;
    try {
      // ⚠️ `mirrorFailed` når hit via create-fallbacken (updateWorkOrderInFortnox →
      // pushWorkOrderToFortnox på en order som aldrig pushats). Kastades resultatet bort svarade
      // routen `fortnox_error: null` — grön "Arbetsorder synkad" — medan raden den returnerar
      // läser Misslyckad. Samma tysta framgång som offertvägen redan rättat.
      const pushed = await updateWorkOrderInFortnox(context.params.id);
      if (pushed.mirrorFailed) {
        // ⚠️ TVÅ OLIKA RÅD. En rensning (tömd Er/Vår referens eller arbetsadress) går inte att
        // skicka alls — buildOrderHeader utelämnar tomma värden — så "synka om" hade skickat
        // säljaren i en cirkel där andra försöket rapporterar framgång medan Fortnox behåller sitt
        // gamla värde. Allt annat lagas av en omsynk.
        fortnoxError = pushed.mirrorNeedsManualFix
          ? 'Ändringen är sparad, men en tömd referens eller arbetsadress kan inte nollas via '
            + 'synken — rätta fältet direkt i Fortnox.'
          : 'Arbetsordern skapades i Fortnox, men en ändring som sparades under tiden kunde inte '
            + 'speglas dit. Synka om arbetsordern och kontrollera uppgifterna.';
      }
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
