import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { portalStoreOrderSchema } from '@/lib/domains/portal/storeOrderIntake';
import { notifyStoreOrder, receiveStoreOrder } from '@/lib/domains/portal/storeOrdersStore';
import { parsePortalBody, runIdempotentPortalRequest, verifyPortalRequest } from '../_shared';

// Butiken skickar en butiksbeställning till Ekovilla (RESELLER_PORTAL_CRM_PLAN.md fas 8, kontraktets "Flöde 3").
// Idempotency-Key: store-order-<orderId>. Svarar 201 { crmStoreOrderId } när beställningen är sparad. Notisen till den
// ansvarige skickas efter svaret.
//
//   400 invalid_json, invalid_text, validation_error   kroppen följer inte kontraktet
//   409 store_order_conflict  beställningen är redan mottagen, med en annan första kropp (under en annan nyckel; samma
//                             nyckel med en annan kropp stoppas redan av svarscachen, 422 idempotency_key_reused)
//   503 no_assignee           ingen kan ta beställningen än (ingen reserv vald): portalen försöker igen
//
// Service-rollen: anropet har ingen användare bakom sig. Grinden är signaturen och svarscachen, och affärsnyckeln är
// orderId. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;

  const admin = getSupabaseAdmin();
  return runIdempotentPortalRequest(req, verified.rawBody, admin, async () => {
    const body = parsePortalBody(verified.rawBody, portalStoreOrderSchema);
    if (!body.ok) return { response: body.response };

    const result = await receiveStoreOrder(admin, body.data, body.payload);
    switch (result.kind) {
      case 'created':
      case 'existing':
        return {
          response: ok({ crmStoreOrderId: result.id }, 201),
          // Också för 'existing': dog processen före notisen gör ett omförsök den. Den skickas ändå bara en gång.
          after: async () => {
            const outcome = await notifyStoreOrder(admin, result.id);
            console.info('[portal-store-orders] efter svaret', { orderId: body.data.orderId, outcome });
          },
        };
      case 'conflict':
        return { response: routeError(409, 'store_order_conflict', 'Beställningen är redan mottagen, med ett annat innehåll.') };
      case 'no_assignee': {
        console.warn('[portal-store-orders] ingen kan ta beställningen', { orderId: body.data.orderId, skipped: result.assignment.skipped });
        const response = routeError(503, 'no_assignee', 'Ingen hos Ekovilla kan ta emot beställningen än. Försök igen senare.');
        response.headers.set('Retry-After', '300');
        return { response };
      }
    }
  });
}
