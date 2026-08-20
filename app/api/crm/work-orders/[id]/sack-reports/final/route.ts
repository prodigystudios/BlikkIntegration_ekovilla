import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createSackReports,
  deleteSackReportsByIds,
  listSackReports,
  listWorkOrderSegments,
  type NewSackReport,
  type SackReportRow,
} from '@/lib/domains/planning/reports';
import { resolveSegmentForDay, sackReportKind } from '@/lib/domains/planning/sackLedger';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  createFinalSackReportSchema,
  invalidUuidParam,
  ok,
  requireSignedInUser,
  routeError,
  validationError,
} from '../../../_lib';

// Dörr 1 — egenkontrollens säckar in i huvudboken som `final`-rader.
//
// Egenkontrollen är jobbets FULLA sanning ("projektet klart, detta gick totalt åt"), inte ett
// tillägg. Supersede-regeln låter därför finalerna släcka jobbets delrapporter i stället för att
// adderas ovanpå dem: 30 + 25 delrapporterat och 91 på egenkontrollen blir 91, inte 146.
//
// ── ERSÄTTNINGEN ÄR MÄNGDVIS OCH NYCKLAS PÅ ARBETSORDERN ─────────────────────
// En ny egenkontroll ERSÄTTER orderns tidigare finaler i stället för att stapla på dem, så en
// omarkering rättar boken. Delrapporterna ligger kvar (de ska synas som ersatta i spåret, inte
// försvinna).
//
// ⚠️ Fyller någon i en egenkontroll PER ETAPP raderar den andra den förstas rader. Därför svarar
// routen med `replaced` — hur många rader som ersattes — så dokumentet kan visa det vid sparning.
// Synligt, inte tyst.
//
// ── ORDNINGEN INSERT → DELETE ÄR AVSIKTLIG ───────────────────────────────────
// PostgREST kan inte hålla båda i en transaktion. Av de två möjliga felutfallen är ett strikt
// mildare:
//   * delete först, insert misslyckas → egenkontrollens siffra är BORTA ur boken, tyst.
//   * insert först, delete misslyckas → två uppsättningar finaler, alltså en för hög total — men
//     SYNLIG i spåret som två set med olika tidsstämpel, och lagningsbar.
// Vi tar det senare, loggar högt och flaggar det i svaret.
//
// nodejs: raderingen använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const parsedBody = createFinalSackReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Vilka finaler ersätter vi? Fångas FÖRE insert:en så raderingen efteråt kan gå på id och
    // omöjligt kan råka ta med det vi just skrev.
    const { data: existing, error: existingError } = await listSackReports(supabase, workOrderId);
    if (existingError) {
      return routeError(500, 'crm_work_order_sack_reports_list_failed', existingError.message);
    }
    const supersededIds = ((existing || []) as unknown as SackReportRow[])
      .filter((row) => sackReportKind(row) === 'final')
      .map((row) => row.id);

    const segments = await listWorkOrderSegments(getSupabaseAdmin(), workOrderId);
    const resolved = resolveSegmentForDay(segments, parsedBody.data.report_day);
    if (!resolved) {
      // ⛔ INTE ETT FEL. Egenkontrollen kan öppnas på en OPLANERAD order — uppslaget sker på
      // ordernummer och är avsiktligt ospärrat. Finns inget segment finns det ingen rad att skriva,
      // och egenkontrollen är ändå arkiverad och kommenterad på ordern. Installatören ska aldrig se
      // ett fel för det, så svaret är 200 med ett skäl klienten kan svälja.
      console.warn(
        `[Säckrapport] Egenkontroll på arbetsorder ${workOrderId} (${parsedBody.data.report_day}) ` +
          'kunde inte bokföras: ordern har inga planerade segment. Kommentaren är kvar.',
      );
      return ok({ recorded: false, reason: 'not_scheduled', replaced: 0, items: [] });
    }
    if (resolved.match === 'nearest') {
      console.warn(
        `[Säckrapport] Ingen täckning för ${parsedBody.data.report_day} på arbetsorder ${workOrderId} — ` +
          `föll tillbaka på närmaste segment ${resolved.segmentId} (${resolved.daysOff} dagar ifrån).`,
      );
    }

    const rows: NewSackReport[] = parsedBody.data.entries.map((entry) => ({
      segment_id: resolved.segmentId,
      work_order_id: workOrderId,
      report_day: parsedBody.data.report_day,
      sacks_blown: entry.sacks_blown,
      kind: 'final',
      material: entry.material,
      // ⚠️ null, aldrig ''. Databasens CHECK avvisar tomma strängen, och den insert:en sitter mitt i
      // installatörens egenkontrollsparning. Schemat ger null redan, det här är bara explicit.
      construction: entry.construction ?? null,
      note: null,
      created_by: currentUser.currentUser.id,
      created_by_name: currentUser.currentUser.name || 'Okänd',
    }));

    const { data, error } = await createSackReports(supabase, rows);
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '42501') {
        return routeError(
          403,
          'crm_work_order_sack_report_forbidden',
          'Du är inte inbokad på det här jobbet och kan därför inte bokföra säckar på det.',
        );
      }
      return routeError(500, 'crm_work_order_sack_report_create_failed', error?.message || 'Kunde inte bokföra säckarna.');
    }

    // Nu — och först nu, efter att RLS godkänt skrivningen — tas den föregående uppsättningen bort.
    const { error: deleteError } = await deleteSackReportsByIds(getSupabaseAdmin(), supersededIds);
    if (deleteError) {
      console.warn(
        `[Säckrapport] Kunde inte ta bort ${supersededIds.length} ersatta final-rader på arbetsorder ` +
          `${workOrderId}: ${deleteError.message}. Totalen är nu för hög tills de rensas.`,
      );
    }

    return ok(
      {
        recorded: true,
        replaced: supersededIds.length,
        replace_failed: Boolean(deleteError),
        items: (data || []) as unknown as SackReportRow[],
      },
      201,
    );
  } catch (e: any) {
    return routeError(500, 'crm_work_order_sack_report_final_unexpected', e?.message || 'Failed to record egenkontroll sacks');
  }
}
