import { requireCrmUser, routeError } from '../../../_shared';
import { getFortnoxOfferPdf } from '@/lib/domains/fortnox/offers';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';

type RouteContext = { params: { quoteId: string } };

// Returns the quote's Fortnox offer rendered as a PDF (Fortnox print template).
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const { bytes, contentType, offerNumber } = await getFortnoxOfferPdf(params.quoteId);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/pdf',
        'Content-Disposition': `inline; filename="offert-${offerNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
      console.error('[Fortnox] offer pdf:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return routeError(e.status === 409 ? 409 : 502, 'fortnox_offer_pdf_failed', friendlyFortnoxMessage(e));
    return routeError(500, 'fortnox_offer_pdf_unexpected', 'Kunde inte hämta PDF. Försök igen.');
  }
}
