import { getDeliveryNotePdf } from '@/lib/domains/fortnox/orders';
import { buildDocumentFilename } from '@/lib/domains/crm/documentEmail';
import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { FortnoxApiError, FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { requireCrmUser, routeError } from '../../_lib';

type RouteContext = { params: { id: string } };

// Returns the work order's delivery note (följesedel) as a PDF — Ekovillas egen formgivning.
//
// ⛔ **Ingen `?mall=fortnox` här.** Följesedeln finns inte som Fortnox-dokument för våra ordrar, så
// det finns ingenting att falla tillbaka på. Orderbekräftelsens nödutgång gäller bara den.
//
// Öppnas som en fliknavigering (se `openFortnoxPdf`), så svaret måste tåla att LANDA i en flik:
// filnamnet sätts i Content-Disposition — det är det namn webbläsaren föreslår när användaren
// sparar från förhandsgranskningen — och fel svaras ut som HTML i stället för JSON.
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
          : 'Du har inte behörighet till arbetsordern.')
        : crmUser.response;
    }

    const { bytes, contentType, orderNumber, projectName } = await getDeliveryNotePdf(params.id);
    const filename = buildDocumentFilename({ kind: 'delivery', ref: orderNumber, projectName });

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
      console.error('[Fortnox] följesedel:', (e as Error).message);
    }
    if (e instanceof FortnoxNotConnectedError) return fail(409, 'fortnox_not_connected', friendlyFortnoxMessage(e));
    if (e instanceof FortnoxApiError) return fail(e.status === 409 ? 409 : 502, 'delivery_note_failed', friendlyFortnoxMessage(e));
    // Följesedeln renderas alltid lokalt, så ett fel här är vårt eget — oftast en fil under public/
    // som inte följde med in i serverfunktionen. Utan loggningen blir det ett tyst 500.
    console.error('[följesedel] oväntat fel:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'delivery_note_unexpected', 'Kunde inte hämta följesedeln. Försök igen.');
  }
}
