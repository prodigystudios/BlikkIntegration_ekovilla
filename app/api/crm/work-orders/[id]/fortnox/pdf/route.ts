import { getFortnoxOrderPdf } from '@/lib/domains/fortnox/orders';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { requireCrmUser, routeError } from '../../../_lib';

type RouteContext = { params: { id: string } };

// Returns the work order's Fortnox order confirmation as a PDF (Fortnox preview layout).
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const { bytes, contentType, orderNumber } = await getFortnoxOrderPdf(params.id);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/pdf',
        'Content-Disposition': `inline; filename="orderbekraftelse-${orderNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
      console.error('[Fortnox] order pdf:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return routeError(e.status === 409 ? 409 : 502, 'fortnox_order_pdf_failed', friendlyFortnoxMessage(e));
    return routeError(500, 'fortnox_order_pdf_unexpected', 'Kunde inte hämta orderbekräftelsen. Försök igen.');
  }
}
