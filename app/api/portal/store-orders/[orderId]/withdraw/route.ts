import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { portalStoreOrderWithdrawSchema } from '@/lib/domains/portal/storeOrderIntake';
import { notifyStoreOrder, withdrawStoreOrder } from '@/lib/domains/portal/storeOrdersStore';
import { parsePortalBody, runIdempotentPortalRequest, verifyPortalRequest } from '../../../_shared';

type RouteContext = { params: { orderId: string } };

// Butiken drar tillbaka en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8, kontraktets "Flöde 3"). Kroppen är
// { orderId }. Idempotency-Key: store-order-<orderId>-withdraw.
//
//   200 { status: "withdrawn" }  tillbakadragen, nu eller redan; den ansvarige får en notis efter svaret
//   200 { status: "ignored" }    Ekovilla har redan makulerat den: makuleringen kommer som store_order.cancelled
//   400 invalid_json, invalid_text, validation_error   kroppen följer inte kontraktet, eller orderId är inte sökvägens
//   404 unknown_order            ingen beställning med det id:t
//   409 store_order_confirmed    redan bekräftad av Ekovilla: det enda ett 409 betyder (kontraktet)
//
// Service-rollen: anropet har ingen användare bakom sig. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: RouteContext) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;

  const admin = getSupabaseAdmin();
  return runIdempotentPortalRequest(req, verified.rawBody, admin, async () => {
    const body = parsePortalBody(verified.rawBody, portalStoreOrderWithdrawSchema);
    if (!body.ok) return { response: body.response };
    if (body.data.orderId !== context.params.orderId) {
      return {
        response: routeError(400, 'validation_error', 'orderId: samma id som i sökvägen.', {
          issues: [{ path: 'orderId', message: 'Samma id som i sökvägen.' }],
        }),
      };
    }

    const result = await withdrawStoreOrder(admin, body.data.orderId);
    switch (result.kind) {
      case 'withdrawn':
        return {
          response: ok({ status: 'withdrawn' }),
          after: async () => {
            const outcome = await notifyStoreOrder(admin, result.id);
            console.info('[portal-store-orders] efter tillbakadragningen', { orderId: body.data.orderId, outcome });
          },
        };
      case 'ignored':
        return { response: ok({ status: 'ignored' }) };
      case 'confirmed':
        return { response: routeError(409, 'store_order_confirmed', 'Beställningen är redan bekräftad av Ekovilla.') };
      case 'unknown_order':
        return { response: routeError(404, 'unknown_order', 'Ingen beställning med det id:t.') };
    }
  });
}
