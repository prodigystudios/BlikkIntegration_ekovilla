import { createSessionClient } from '@/lib/supabase/session';
import { documentErrorPage, invalidUuidParam, isDocumentNavigation, routeError } from '@/lib/api/responses';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { buildSafetyRoundDocument } from '@/lib/domains/safetyRounds/document';
import { renderSafetyRoundPdf, safetyRoundFilename } from '@/lib/domains/safetyRounds/pdf';
import { downloadPhotos } from '@/lib/domains/safetyRounds/photoStorage';
import { getSafetyRoundBundle } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireSafetyRoundReader } from '../../_lib';

// Skyddsrondens protokoll som PDF, byggt ur tabellerna vid varje utskrift (se document.ts: en
// slutförd rond är låst, bara handlingsplanens uppföljning rör sig, och utskriftsdagen står i foten).
//
// Öppnas som en fliknavigering, så svaret måste tåla att LANDA i en flik: filnamnet sätts i
// Content-Disposition och fel svaras ut som en HTML-sida i stället för JSON.
//
// ⚠️ Typsnitten och båda loggorna läses från public/ VID KÖRNING. Routen står därför i
// outputFileTracingIncludes (next.config.js) — listan är PER ROUTE, och en saknad post gav en
// produktionsincident 2026-09-04 (ENOENT på typsnitten). Lokalt märks ingenting.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(req: Request, { params }: RouteContext) {
  const fail = (status: number, code: string, message: string) =>
    isDocumentNavigation(req) ? documentErrorPage(status, message) : routeError(status, code, message);

  try {
    const guard = await requireSafetyRoundReader();
    if (guard.response) {
      return isDocumentNavigation(req)
        ? documentErrorPage(
            guard.response.status,
            guard.response.status === 401
              ? 'Du är inte inloggad. Logga in och försök igen.'
              : 'Du har inte behörighet till skyddsronder.',
          )
        : guard.response;
    }

    if (invalidUuidParam(params.id)) return fail(400, 'invalid_id', 'Ogiltig länk till skyddsronden.');

    const supabase = createSessionClient();
    const { data, error } = await getSafetyRoundBundle(supabase, params.id);
    if (error) return fail(500, 'safety_round_read_failed', 'Kunde inte hämta skyddsronden.');
    if (!data) return fail(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');

    const document = buildSafetyRoundDocument(data, { printedOn: stockholmTodayISO() });

    // Fotonas lilla variant hämtas med service-rollen — EFTER att RLS släppt igenom läsningen av
    // raderna ovan (bucketen har inga egna policyer). Bara de som ryms i budgeten (document.ts).
    const downloaded = document.photoDownloads.length > 0
      ? await downloadPhotos(getSupabaseAdmin(), document.photoDownloads.map((p) => p.path))
      : new Map<string, Uint8Array>();
    const images = new Map<string, Uint8Array>();
    for (const { ref, path } of document.photoDownloads) {
      const photo = downloaded.get(path);
      if (photo) images.set(ref, photo);
    }

    const bytes = await renderSafetyRoundPdf({ ...document, images });
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safetyRoundFilename(data.round)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    // Renderingen sker helt lokalt, så ett fel här är vårt eget — oftast en fil under public/ som
    // inte följde med in i serverfunktionen. Utan loggningen blir det ett tyst 500.
    console.error('[safety-rounds] pdf:', e instanceof Error ? e.stack ?? e.message : e);
    return fail(500, 'safety_round_pdf_unexpected', 'Kunde inte skapa skyddsrondens PDF. Försök igen.');
  }
}
