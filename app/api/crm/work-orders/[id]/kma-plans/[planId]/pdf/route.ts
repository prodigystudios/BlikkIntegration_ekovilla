import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { kmaPlanFilename, renderKmaPdf } from '@/lib/domains/crm/kmaPlans/pdf';
import { parseStoredKmaDocument } from '@/lib/domains/crm/kmaPlans/schemas';
import { getKmaPlanDocument } from '@/lib/domains/crm/kmaPlans/store';
import { invalidUuidParam, requirePermission, routeError } from '../../../../_lib';

// En sparad KMA-plan som PDF — renderad ur revisionens EGET dokument, aldrig ur dagens mall.
//
// Öppnas som en fliknavigering (openFortnoxPdf), så svaret måste tåla att LANDA i en flik:
// filnamnet sätts i Content-Disposition och fel svaras ut som en HTML-sida i stället för JSON.
//
// ⚠️ Typsnitten och båda loggorna läses från public/ VID KÖRNING. Routen står därför i
// outputFileTracingIncludes (next.config.js) — listan är PER ROUTE, och en saknad post gav en
// produktionsincident 2026-09-04 (ENOENT på typsnitten). Lokalt märks ingenting.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; planId: string } };

export async function GET(req: Request, { params }: RouteContext) {
  const fail = (status: number, code: string, message: string) =>
    isDocumentNavigation(req) ? documentErrorPage(status, message) : routeError(status, code, message);

  try {
    const guard = await requirePermission('crm.workorder.read');
    if (guard.response) {
      return isDocumentNavigation(req)
        ? documentErrorPage(
            guard.response.status,
            guard.response.status === 401
              ? 'Du är inte inloggad. Logga in och försök igen.'
              : 'Du har inte behörighet till arbetsordern.',
          )
        : guard.response;
    }

    if (invalidUuidParam(params.id) || invalidUuidParam(params.planId)) {
      return fail(400, 'invalid_id', 'Ogiltig länk till KMA-planen.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getKmaPlanDocument(supabase, params.id, params.planId);
    if (error) return fail(500, 'crm_work_order_kma_read_failed', 'Kunde inte hämta KMA-planen.');
    if (!data) return fail(404, 'crm_work_order_kma_not_found', 'KMA-planen hittades inte.');

    // Ett dokument i en form renderaren inte känner ritas inte "så gott det går" — en halv plan som
    // ser komplett ut är värre än ett felmeddelande.
    const document = parseStoredKmaDocument(data.document);
    if (!document) {
      console.error('[kma] sparat dokument gick inte att tolka:', params.planId);
      return fail(500, 'crm_work_order_kma_invalid_document', 'KMA-planens dokument kunde inte läsas.');
    }

    const bytes = await renderKmaPdf(document);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${kmaPlanFilename(document.meta)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    // Renderingen sker helt lokalt, så ett fel här är vårt eget — oftast en fil under public/ som
    // inte följde med in i serverfunktionen. Utan loggningen blir det ett tyst 500.
    console.error('[kma] pdf:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'crm_work_order_kma_pdf_unexpected', 'Kunde inte skapa KMA-planens PDF. Försök igen.');
  }
}
