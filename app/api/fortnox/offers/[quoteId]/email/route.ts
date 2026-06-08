import { requirePermission, ok, routeError } from '../../../_shared';
import { emailFortnoxOffer } from '@/lib/domains/fortnox/offers';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';

type RouteContext = { params: { quoteId: string } };

// Asks Fortnox to e-mail the offer to the customer (uses the offer's EmailInformation).
export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const crmUser = await requirePermission('fortnox.offer.push');
    if (crmUser.response) return crmUser.response;

    const result = await emailFortnoxOffer(params.quoteId);
    return ok(result);
  } catch (e: unknown) {
    if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
      console.error('[Fortnox] offer email:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return routeError(e.status === 409 ? 409 : 502, 'fortnox_offer_email_failed', friendlyFortnoxMessage(e));
    return routeError(500, 'fortnox_offer_email_unexpected', 'Kunde inte mejla offerten. Försök igen.');
  }
}
