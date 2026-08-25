import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createSackReports,
  listSackReports,
  listWorkOrderSegments,
  type NewSackReport,
  type SackReportRow,
} from '@/lib/domains/planning/reports';
import { markSupersededReports, resolveSegmentForDay, sackReportKind } from '@/lib/domains/planning/sackLedger';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  createSackReportSchema,
  invalidUuidParam,
  ok,
  requireSignedInUser,
  routeError,
  validationError,
} from '../../_lib';

// Säckrapportering — huvudbokens skrivväg och läsväg för EN arbetsorder.
//
// Betjänar två ytor: fältvyns delrapport (app/arbetsorder/[id]) skriver hit, och både den och
// kontorets orderöversikt läser härifrån. Egenkontrollen skriver INTE hit — den är jobbets fulla
// sanning och går sin egen väg, se nedan.
//
// ── TVÅ KLIENTER, MED FLIT ───────────────────────────────────────────────────
// Segmentet slås upp ELEVERAT: ops_segments kräver planning.schedule.read, som installatören inte
// har. Själva insert:en går genom SESSIONSKLIENTEN, så det är RLS som auktoriserar skrivningen
// (created_by = auth.uid() och is_user_on_work_order). Byts den ordningen — admin på insert:en —
// blir routens egna kontroller den enda spärren, och en glömd kontroll blir ett hål.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

// Vem som läser. Bärs med i mappningen för att `can_delete` ska kunna avgöras på servern — se
// SackReportView.can_delete för varför den frågan inte får ställas i klienten.
type Viewer = {
  userId: string;
  /** planning.schedule.write — samma nyckel som kontorets DELETE-policy gatar på. */
  isOffice: boolean;
};

// Rå rad → det klienten får. `sacks_blown` är numeric(10,2) och kommer tillbaka som STRÄNG från
// PostgREST; skickas den vidare orörd blir "30" + "25" en strängkonkatenering någonstans i UI:t.
function mapSackReportRow(row: SackReportRow & { superseded: boolean }, viewer: Viewer) {
  const kind = sackReportKind(row);
  return {
    id: row.id,
    report_day: row.report_day,
    sacks_blown: Number(row.sacks_blown),
    kind,
    material: row.material,
    construction: row.construction,
    note: row.note,
    // Namnet är snapshottat på raden. profiles är self-read-only, och uppslag via
    // /work-orders/assignees når inte installatörer alls (listAssignableCrmUsers filtrerar bort
    // dem) — alltså exakt de som rapporterar.
    created_by_name: row.created_by_name || 'Okänd',
    created_at: row.created_at,
    // ⚠️ Efter en final ligger delrapporterna kvar i boken. Listas de omärkta läser kontoret
    // 30 + 25 + 91 = 146 och tror att talen inte går ihop.
    superseded: row.superseded,
    // Speglar de två DELETE-policyerna, och ingenting annat: kontoret (planning.schedule.write)
    // eller den som skrev raden, och aldrig en final. Håll den identisk med
    // 20260825_ops_segment_reports_delete_own_partial.sql — glider de isär visar kortet en knapp
    // som svarar 403.
    can_delete: kind === 'partial' && (viewer.isOffice || row.created_by === viewer.userId),
  };
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listSackReports(supabase, context.params.id);
    if (error) {
      return routeError(500, 'crm_work_order_sack_reports_list_failed', error.message);
    }

    // Kontoret känns igen på samma nyckel som kontorets DELETE-policy kräver, inte på rollen.
    // Härleddes den ur rollen svarade routen ja där databasen svarar nej så fort en nyckel dras
    // in i adminytan.
    const viewer = {
      userId: currentUser.currentUser.id,
      isOffice: can(await getEffectivePermissions(), 'planning.schedule.write'),
    };

    const rows = (data || []) as unknown as SackReportRow[];
    const marked = markSupersededReports(rows);

    return ok({
      items: marked.map((row) => mapSackReportRow(row, viewer)),
      // Dörr 2 spärras när en final finns — se POST. Flaggan följer med listan så knappen kan vara
      // borta i stället för att svara 409 efter att någon skrivit in en dagsrapport.
      has_final: marked.some((row) => sackReportKind(row) === 'final'),
    });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_sack_reports_unexpected', e?.message || 'Failed to list sack reports');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const parsedBody = createSackReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // ── Spärr: finns en final är jobbet redan avräknat ───────────────────────
    // Utan den här blir en sen delrapport en TYST NOLLOPERATION: installatören skriver tio säckar,
    // raden landar i boken, och totalen rör sig inte en millimeter eftersom finalen vinner. Bättre
    // att neka med ett skäl än att låtsas att rapporten togs emot.
    //
    // Läses med sessionsklienten. En roll som inte får se raderna kan inte heller skriva dem —
    // insert-policyn gatar hårdare än select-policyn — så spärren kan inte kringgås genom att
    // läsa noll rader.
    const { data: existing, error: existingError } = await listSackReports(supabase, workOrderId);
    if (existingError) {
      return routeError(500, 'crm_work_order_sack_reports_list_failed', existingError.message);
    }
    if (((existing || []) as unknown as SackReportRow[]).some((row) => sackReportKind(row) === 'final')) {
      return routeError(
        409,
        'crm_work_order_sack_report_final_exists',
        'Egenkontrollen är redan inlämnad för det här jobbet och räknas som slutgiltig. En delrapport skulle inte påverka totalen.',
      );
    }

    // ── Segmentet: täckning först, närmaste som reserv ───────────────────────
    const segments = await listWorkOrderSegments(getSupabaseAdmin(), workOrderId);
    const resolved = resolveSegmentForDay(segments, parsedBody.data.report_day);
    if (!resolved) {
      // Ska i praktiken inte gå att nå: /mina-jobb bygger fältfeeden ur ops_segments med
      // generate_series(start_day, end_day), så en dag som inget segment täcker syns inte ens för
      // installatören. Kvarstår för den oplanerade ordern, som går att nå på andra vägar.
      return routeError(
        400,
        'crm_work_order_sack_report_no_segment',
        'Jobbet har ingen planerad dag att koppla rapporten till. Kontakta kontoret så läggs den in i planeringen.',
      );
    }
    if (resolved.match === 'nearest') {
      // ⚠️ Reserven har fallit ut, alltså brast antagandet ovan. Loggas för att det annars är
      // OSYNLIGT: säckarna hamnar på ett segment vars bil kanske hör till en annan depå, och
      // depåsaldot blir fel utan att något felar.
      console.warn(
        `[Säckrapport] Ingen täckning för ${parsedBody.data.report_day} på arbetsorder ${workOrderId} — ` +
          `föll tillbaka på närmaste segment ${resolved.segmentId} (${resolved.daysOff} dagar ifrån).`,
      );
    }

    const rows: NewSackReport[] = parsedBody.data.entries.map((entry) => ({
      segment_id: resolved.segmentId,
      // Ur rutt-parametern, aldrig ur kroppen — RLS gatar på det här fältet.
      work_order_id: workOrderId,
      report_day: parsedBody.data.report_day,
      sacks_blown: entry.sacks_blown,
      // Dörr 2 skriver aldrig finaler; se schemats huvud.
      kind: 'partial',
      material: entry.material,
      construction: entry.construction,
      // Datum och notering hör till dagen och stämplas på varje placering.
      note: parsedBody.data.note,
      created_by: currentUser.currentUser.id,
      created_by_name: currentUser.currentUser.name || 'Okänd',
    }));

    const { data, error } = await createSackReports(supabase, rows);
    if (error || !data) {
      // 42501 = RLS avvisade skrivningen. Det är ett behörighetssvar, inte ett serverfel: den som
      // inte är besättning på jobbet (och saknar planning.schedule.write) hamnar här.
      if ((error as { code?: string } | null)?.code === '42501') {
        return routeError(
          403,
          'crm_work_order_sack_report_forbidden',
          'Du är inte inbokad på det här jobbet och kan därför inte rapportera säckar på det.',
        );
      }
      return routeError(500, 'crm_work_order_sack_report_create_failed', error?.message || 'Kunde inte spara rapporten.');
    }

    // Nyskrivna rader kan inte vara ersatta: spärren ovan har redan avvisat submiten om en final
    // fanns. superseded sätts ändå av samma funktion som listan, så de två aldrig kan säga olika.
    const created = markSupersededReports((data || []) as unknown as SackReportRow[]);
    // Rapportören äger raderna hen just skrev, så knappen finns direkt — vilket är hela poängen
    // med den: det är dubbeltrycket i dålig täckning som ska gå att ta tillbaka på plats.
    const viewer = {
      userId: currentUser.currentUser.id,
      isOffice: can(await getEffectivePermissions(), 'planning.schedule.write'),
    };
    return ok({ items: created.map((row) => mapSackReportRow(row, viewer)) }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_sack_report_unexpected', e?.message || 'Failed to create sack report');
  }
}
