import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createCrmWorkOrderFromQuote } from '@/lib/domains/crm/work-orders';
import { pushWorkOrderToFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const result = await createCrmWorkOrderFromQuote(supabase, context.params.id, crmUser.currentUser.id);

    if (result.error || !result.data) {
      if (result.reason === 'not_found') {
        return routeError(404, 'crm_quote_not_found', result.error?.message || 'Offerten hittades inte');
      }

      // Emit the same code the standalone route uses so the client's personnummer prompt
      // (which keys off crm_work_order_missing_personal_number) fires on both order paths.
      if (result.reason === 'missing_personal_number') {
        return routeError(409, 'crm_work_order_missing_personal_number', result.error?.message || 'Personnummer krävs för privatkund innan order kan skapas');
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
      await pushWorkOrderToFortnox(result.data.workOrder.id);
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