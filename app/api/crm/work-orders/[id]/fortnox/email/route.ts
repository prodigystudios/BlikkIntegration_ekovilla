import { emailFortnoxOrder } from '@/lib/domains/fortnox/orders';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requireCrmUser, routeError } from '../../../_lib';

type RouteContext = { params: { id: string } };

// Asks Fortnox to e-mail the order confirmation to the customer.
export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const result = await emailFortnoxOrder(params.id);
    return ok(result);
  } catch (e: unknown) {
    if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
      console.error('[Fortnox] order email:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return routeError(e.status === 409 ? 409 : 502, 'fortnox_order_email_failed', friendlyFortnoxMessage(e));
    return routeError(500, 'fortnox_order_email_unexpected', 'Kunde inte mejla orderbekräftelsen. Försök igen.');
  }
}
