import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderFromQuote, getWorkOrderReadinessForQuote } from '@/lib/domains/crm/work-orders';
import { workOrderReadinessErrorCode } from '@/lib/domains/crm/workOrderReadiness';
import { pushWorkOrderToFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { invalidUuidParam, ok, requirePermission, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

/**
 * Vad som saknas innan offerten kan bli en arbetsorder.
 *
 * Läses av offertformuläret och den delade offertpanelen så att listan syns INNAN säljaren
 * trycker. Samma funktion som skapandet använder — checklistan och spärren kan därför inte säga
 * emot varandra.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const result = await getWorkOrderReadinessForQuote(supabase, context.params.id);

    if (result.error || !result.data) {
      if (result.reason === 'not_found') {
        return routeError(404, 'crm_quote_not_found', 'Offerten hittades inte');
      }
      return routeError(500, 'crm_work_order_readiness_failed', result.error?.message || 'Kunde inte läsa offerten');
    }

    return ok(result.data);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_unexpected', e?.message || 'Failed to read work-order readiness');
  }
}

export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const result = await createCrmWorkOrderFromQuote(supabase, context.params.id, crmUser.currentUser.id);

    if (result.error || !result.data) {
      if (result.reason === 'not_found') {
        return routeError(404, 'crm_quote_not_found', result.error?.message || 'Offerten hittades inte');
      }

      // Ofullständig offert. Hela listan hämtas om och skickas med, så klienten kan visa allt som
      // saknas i stället för ett fynd i taget.
      //
      // Koden är fortfarande den specifika (`…missing_personal_number` / `…missing_rot_property`)
      // när fyndet är ENSAMT — offertformuläret öppnar en prompt på dem och rättar dem på plats.
      // Är det fler blir det `crm_work_order_incomplete` och listan visas i stället, eftersom en
      // prompt då bara hade lagat en av sakerna innan nästa fel dök upp.
      if (result.reason === 'incomplete') {
        const readiness = 'readiness' in result ? result.readiness : null;
        const blockers = readiness?.blockers ?? [];
        return routeError(
          409,
          blockers.length > 0 ? workOrderReadinessErrorCode(blockers) : 'crm_work_order_incomplete',
          result.error?.message || 'Uppgifter saknas innan arbetsorder kan skapas',
          { blockers, warnings: readiness?.warnings ?? [] },
        );
      }

      if (result.reason === 'quote_not_won' || result.reason === 'already_created') {
        return routeError(409, result.reason, result.error?.message || 'Arbetsorder kunde inte skapas');
      }

      return routeError(500, 'crm_work_order_create_failed', result.error?.message || 'Kunde inte skapa arbetsorder');
    }

    // Auto-push work order to Fortnox. Non-fatal: creation succeeds regardless, but we
    // surface the reason so the UI can show why a sync failed instead of failing silently.
    let fortnoxError: string | null = null;
    try {
      // ⚠️ `mirrorFailed` = ordern SKAPADES, men en sparning som landade mitt i pushen gick inte att
      // spegla om. Synkstatusen är redan nerstämplad; utan det här beskedet svarade routen 201 med
      // en grön toast medan brickan läste Misslyckad och faktureringen var spärrad.
      const pushed = await pushWorkOrderToFortnox(result.data.workOrder.id);
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
      if (!(e instanceof FortnoxNotConnectedError)) {
        console.error('[fortnox] Auto-push arbetsorder misslyckades:', (e as Error)?.message);
        fortnoxError = friendlyFortnoxMessage(e);
      }
    }

    return ok({ ...result.data, fortnox_error: fortnoxError }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_unexpected', e?.message || 'Failed to create CRM work order');
  }
}