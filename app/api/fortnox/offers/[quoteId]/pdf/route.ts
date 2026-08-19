import { requireCrmUser, routeError } from '../../../_shared';
import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { getFortnoxOfferPdf } from '@/lib/domains/fortnox/offers';
import { buildDocumentFilename } from '@/lib/domains/crm/documentEmail';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';

type RouteContext = { params: { quoteId: string } };

// Returns the quote's Fortnox offer rendered as a PDF (Fortnox print template).
//
// Öppnas som en fliknavigering (se `openFortnoxPdf`), så svaret måste tåla att LANDA i en
// flik: filnamnet sätts i Content-Disposition — det är det namn webbläsaren föreslår när
// säljaren sparar från förhandsgranskningen — och fel svaras ut som HTML i stället för JSON.
export async function GET(req: Request, { params }: RouteContext) {
  const fail = (status: number, code: string, message: string) => (
    isDocumentNavigation(req) ? documentErrorPage(status, message) : routeError(status, code, message)
  );

  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) {
      return isDocumentNavigation(req)
        ? documentErrorPage(crmUser.response.status, crmUser.response.status === 401
          ? 'Du är inte inloggad. Logga in och försök igen.'
          : 'Du har inte behörighet till offerten.')
        : crmUser.response;
    }

    const { bytes, contentType, offerNumber, projectName } = await getFortnoxOfferPdf(params.quoteId);
    const filename = buildDocumentFilename({ kind: 'offer', ref: offerNumber, projectName });

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    if (e instanceof FortnoxApiError || e instanceof FortnoxNotConnectedError) {
      console.error('[Fortnox] offer pdf:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return fail(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return fail(e.status === 409 ? 409 : 502, 'fortnox_offer_pdf_failed', friendlyFortnoxMessage(e));
    // ROT-offerter renderas lokalt (lib/domains/fortnox/offerPdf.ts). Ett fel där är varken ett
    // Fortnox-fel eller loggat ovan, så det skulle annars bli ett tyst 500 på en ny kodväg.
    console.error('[offert-pdf] oväntat fel:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'fortnox_offer_pdf_unexpected', 'Kunde inte hämta PDF. Försök igen.');
  }
}
