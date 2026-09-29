import { getSupabaseAdmin } from '@/lib/supabase/server';
import { pushStoreOrderToFortnox } from '@/lib/domains/portal/storeOrderActions';
import { ok, routeError } from '../../../../_shared';
import { requireStoreOrderManager } from '../../_manage';

type RouteContext = { params: { id: string } };

// "Skicka till Fortnox" på en bekräftad butiksbeställning som ännu saknar Fortnox-order (RESELLER_PORTAL_CRM_PLAN.md
// fas 8b): samma försök som bekräftelsen och cron gör, med samma claim, så att två samtidiga aldrig ger två ordrar.
//
//   200 { fortnox_order_number, fortnox_error, fortnox_outcome }
//                                                 skapad, eller fanns redan; fortnox_error när den inte kunde skapas
//   403 store_order_forbidden                     varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_confirmed                 inte bekräftad (eller makulerad)
//   409 store_order_push_in_progress              ett försök pågår redan

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const result = await pushStoreOrderToFortnox(getSupabaseAdmin(), context.params.id);
    if (result.outcome === 'skipped') {
      return routeError(409, 'store_order_not_confirmed', 'Bara en bekräftad beställning skickas till Fortnox.');
    }
    if (result.outcome === 'in_progress') {
      return routeError(409, 'store_order_push_in_progress', 'Fortnox-ordern skapas redan av ett annat försök. Ladda om sidan om en stund.');
    }
    return ok({ fortnox_order_number: result.fortnoxOrderNumber, fortnox_error: result.error, fortnox_outcome: result.outcome });
  } catch (e) {
    console.error('[portal-store-orders] Fortnox-ordern kunde inte skickas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return routeError(500, 'store_order_fortnox_failed', 'Fortnox-ordern kunde inte skickas.');
  }
}
