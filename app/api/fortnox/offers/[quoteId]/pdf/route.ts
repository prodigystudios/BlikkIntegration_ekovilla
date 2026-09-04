import { requireCrmUser, routeError } from '../../../_shared';
import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { getFortnoxOfferPdf } from '@/lib/domains/fortnox/offers';
import { buildDocumentFilename } from '@/lib/domains/crm/documentEmail';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
// Från offerPdfErrors, inte offerPdfAssembly: den senare drar in pdf-lib i routens modulgraf.
import { OfferAttachmentError } from '@/lib/domains/fortnox/offerPdfErrors';

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

    // `?mall=ny` renderar offerten med vår EGNA formgivning i stället för Fortnox utskriftsmall,
    // och fogar in försättsblad, informationsblad och allmänna villkor. Medvetet en uttrycklig
    // parameter medan formgivningen provas: den som inte skriver den får samma dokument som förut.
    const design = new URL(req.url).searchParams.get('mall') === 'ny';
    const { bytes, contentType, offerNumber, projectName } = await getFortnoxOfferPdf(params.quoteId, { design });
    const filename = buildDocumentFilename({ kind: 'offer', ref: offerNumber, projectName });

    // Svaret STRÖMMAS. Med bilagorna blir dokumentet några megabyte, och en serverlös funktion har
    // en gräns för hur stort ett buffrat svar får vara — en ström räknas inte mot den. Samma grepp
    // som app/api/pdf/offert-kalkylator använder.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(stream, {
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
    // Bilagorna gick inte att foga in — nästan alltid att avtalsvillkoren saknas eller inte är A4.
    // "Försök igen" vore fel råd: felet sitter i en fil och försvinner inte av ett omtag.
    if (e instanceof OfferAttachmentError) {
      console.error('[offert-pdf] bilaga:', e.message);
      return fail(500, 'offer_attachment_failed', `Offertens bilagor kunde inte fogas in. ${e.message}`);
    }
    // ROT-offerter renderas lokalt (lib/domains/fortnox/offerPdf.ts). Ett fel där är varken ett
    // Fortnox-fel eller loggat ovan, så det skulle annars bli ett tyst 500 på en ny kodväg.
    console.error('[offert-pdf] oväntat fel:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'fortnox_offer_pdf_unexpected', 'Kunde inte hämta PDF. Försök igen.');
  }
}
