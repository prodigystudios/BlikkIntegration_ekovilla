import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionClient } from '@/lib/supabase/session';
import { invalidUuidParam, requirePermission, routeError } from '../../_shared';

/**
 * Grinden för Ekovillas steg på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b): crm.workorder.write, en
 * beställning som sessionen ser (RLS, crm.access), och regeln crm_store_order_can_manage (den ansvarige eller en admin).
 * Samma regel som sidan frågar om knapparna ska visas. Stegen skrivs sedan med service-rollen (se "Reviewed elevations"
 * i SUPABASE_CONVENTIONS.md).
 *
 *   401/403 från nyckeln, 400 ogiltigt id, 404 store_order_not_found, 403 store_order_forbidden
 */
export async function requireStoreOrderManager(
  id: string,
): Promise<{ response: Response; userId?: undefined; session?: undefined } | { response: null; userId: string; session: SupabaseClient }> {
  const gate = await requirePermission('crm.workorder.write');
  if (gate.response || !gate.currentUser) return { response: gate.response ?? routeError(401, 'unauthorized', 'Unauthorized') };

  const badId = invalidUuidParam(id);
  if (badId) return { response: badId };

  const session = createSessionClient();
  // Parallellt: läsningen skiljer 404 från 403, regeln avgör.
  const [seen, allowed] = await Promise.all([
    session.from('crm_store_orders').select('id').eq('id', id).maybeSingle(),
    session.rpc('crm_store_order_can_manage', { p_id: id }),
  ]);
  if (seen.error) throw new Error(`Beställningen gick inte att läsa: ${seen.error.message}`);
  if (!seen.data) return { response: routeError(404, 'store_order_not_found', 'Beställningen hittades inte.') };
  if (allowed.error) throw new Error(`Behörigheten gick inte att pröva: ${allowed.error.message}`);
  if (allowed.data !== true) {
    return { response: routeError(403, 'store_order_forbidden', 'Bara den ansvarige för beställningen, eller en admin, kan göra det.') };
  }
  return { response: null, userId: gate.currentUser.id, session };
}
