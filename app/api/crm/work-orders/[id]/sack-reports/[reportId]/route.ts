import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteSackReport, getSackReport, type SackReportRow } from '@/lib/domains/planning/reports';
import { sackReportKind } from '@/lib/domains/planning/sackLedger';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../../_lib';

// Ta bort EN delrapport ur huvudboken.
//
// ── VARFÖR RUTTEN FINNS ──────────────────────────────────────────────────────
// Boken var append-only från fältet, och en ny rad kan bara ADDERA (`check (sacks_blown >= 0)`).
// När två installatörer med dålig mottagning tryckte Spara två gånger 2026-08-24 fanns alltså
// ingen rättning alls — varken för dem eller för kontoret. Det är den återvändsgränden som stängs
// här, inte en generell redigeringsyta för historiken.
//
// ── VEM SOM FÅR, OCH VAR DEN REGELN BOR ──────────────────────────────────────
// Kontoret (planning.schedule.write, ops_segment_reports_delete sedan 20260611) och den som SKREV
// raden (ops_segment_reports_delete_own_partial, 20260825). Routen gatar därför INTE på en
// behörighet av eget: den läser raden med sessionsklienten och låter DELETE:n mötas av RLS, precis
// som skrivvägen gör. Skrev routen om regeln i TypeScript hade den blivit en andra kopia som
// glider isär från policyn — och den kopian är alltid den som svarar 200 där databasen svarar nej.
//
// ⚠️ EN DELETE SOM INTE TRÄFFAR NÅGON RAD ÄR INTE ETT FEL. PostgREST svarar `error: null` och noll
// rader, exakt som en lyckad borttagning av något som redan var borta. Därför läses raden tillbaka
// med `.select()` — utan det hade en RLS-nekad borttagning rapporterats som lyckad och kortet
// tagit bort en rad ur listan som ligger kvar i databasen.
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
    reportId: string;
  };
};

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.reportId);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });

    // Läses först för att kunna skilja de tre nejen åt. Utan den här läsningen blir "finns inte",
    // "är en egenkontroll" och "inte din" samma noll rader, och användaren får ett besked som inte
    // säger vad hen ska göra i stället.
    const { data: existing, error: readError } = await getSackReport(
      supabase,
      context.params.reportId,
      context.params.id,
    );
    if (readError) {
      return routeError(500, 'crm_work_order_sack_report_read_failed', readError.message);
    }
    if (!existing) {
      return routeError(404, 'crm_work_order_sack_report_not_found', 'Rapporten hittades inte.');
    }

    // ── Spärr: egenkontrollens rader tas inte bort här ───────────────────────
    // Regeln är "finns en final är den jobbets sanning; annars summan av partial". Försvinner
    // orderns sista final släpps delrapporterna fram som total igen — en borttagning som ser ut
    // att sänka siffran hade alltså HÖJT den (30 + 25 där svaret var 91). Egenkontrollen rättas
    // genom att lämnas in på nytt; den vägen ersätter hela mängden och finns redan.
    //
    // Policyn nekar detta oavsett (`kind = 'partial'` står i båda DELETE-vägarna), men ett 409 med
    // skäl är ett bättre svar än noll rader.
    if (sackReportKind(existing as unknown as SackReportRow) === 'final') {
      return routeError(
        409,
        'crm_work_order_sack_report_final_immutable',
        'Raden kommer från egenkontrollen och tas inte bort här. Behöver slutsumman ändras lämnas egenkontrollen in på nytt — då ersätter den jobbets tidigare siffra.',
      );
    }

    const { data, error } = await deleteSackReport(supabase, context.params.reportId, context.params.id);
    if (error) {
      return routeError(500, 'crm_work_order_sack_report_delete_failed', error.message);
    }
    if (!data) {
      // Raden fanns när vi läste den, men DELETE:n träffade ingenting: RLS nekade (en kollega i
      // besättningen som inte skrev raden), eller så hann någon annan ta bort den emellan.
      return routeError(
        403,
        'crm_work_order_sack_report_delete_blocked',
        'Rapporten kunde inte tas bort. Det är den som skrev rapporten, eller kontoret, som kan ta bort den.',
      );
    }

    return ok({ id: context.params.reportId });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_sack_report_delete_unexpected', e?.message || 'Failed to delete sack report');
  }
}
