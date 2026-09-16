import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createCrmWorkOrderProgressReports,
  getCrmWorkOrderLineItems,
  isUserOnWorkOrder,
  listCrmWorkOrderProgressReports,
} from '@/lib/domains/crm/work-orders';
import {
  progressWorkItemsFromLineItems,
  resolveProgressEntry,
  type ProgressReportView,
} from '@/lib/domains/crm/workOrderProgress';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import {
  createProgressReportSchema,
  invalidUuidParam,
  ok,
  requireSignedInUser,
  routeError,
  validationError,
} from '../../_lib';

// Framdriftsrapportering — läsväg och skrivväg för EN arbetsorder.
//
// Betjänar två ytor: fältvyns framdriftskort (app/arbetsorder/[id]) skriver hit, och både den och
// kontorets orderöversikt läser härifrån.
//
// ── EN KLIENT, TILL SKILLNAD FRÅN SÄCKRAPPORTERINGEN ─────────────────────────
// Säckrutten slår upp segmentet ELEVERAT (ops_segments kräver planning.schedule.read, som
// installatören inte har) och skriver sedan genom sessionsklienten. Här finns inget segment att
// slå upp: framdrift debiterar ingen depå, så kolumnen finns inte. Allt går alltså genom
// SESSIONSKLIENTEN och RLS gör hela auktoriseringen — ingen admin-klient, ingen service-role-nyckel,
// och därmed inget behov av `runtime = 'nodejs'`.
//
// Följden är också att en oplanerad order fungerar: säckrutten måste avvisa en dag inget segment
// täcker, den här behöver inte fråga.
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

// Vem som läser. Bärs med i mappningen för att `can_delete` ska kunna avgöras på servern — se
// ProgressReportView.can_delete för varför den frågan inte får ställas i klienten.
type Viewer = {
  userId: string;
  /** crm.workorder.write — samma nyckel som kontorets DELETE-gren i policyn. */
  isOffice: boolean;
  /** is_user_on_work_order — andra villkoret i rapportörens DELETE-gren. */
  isCrew: boolean;
};

type ProgressRow = {
  id: string;
  report_day: string;
  line_item_id: string | null;
  work_item: string;
  quantity: number | string;
  unit: string | null;
  location: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

// Rå rad → det klienten får. `quantity` är numeric(10,2) och kommer tillbaka som STRÄNG från
// PostgREST; skickas den vidare orörd blir "20" + "25" en strängkonkatenering någonstans i UI:t.
function mapProgressRow(row: ProgressRow, viewer: Viewer): ProgressReportView {
  return {
    id: row.id,
    report_day: row.report_day,
    line_item_id: row.line_item_id,
    work_item: row.work_item,
    quantity: Number(row.quantity),
    unit: row.unit,
    location: row.location,
    note: row.note,
    // Namnet är snapshottat på raden. profiles är self-read-only, och uppslag via
    // /work-orders/assignees når inte installatörer alls (listAssignableCrmUsers filtrerar bort
    // dem) — alltså exakt de som rapporterar.
    created_by_name: row.created_by_name || 'Okänd',
    created_at: row.created_at,
    // Speglar DELETE-policyns två grenar, och ingenting annat: kontoret (crm.workorder.write),
    // eller den som skrev raden OCH fortfarande är besättning på jobbet. Håll den identisk med
    // 20260916_crm_work_order_progress_reports.sql; glider de isär visar kortet en knapp som
    // svarar 403.
    //
    // ⚠️ `isCrew` är inte överflödigt bara för att en member måste vara besättning för att se raden
    // alls. En kontorsanvändare kan ha SKRIVIT en rad med crm.workorder.write och sedan fått
    // nyckeln indragen: hen läser fortfarande raden (crm.workorder.read), äger den, och är inte
    // besättning. Utan villkoret ritas knappen åt just hen.
    can_delete: viewer.isOffice || (row.created_by === viewer.userId && viewer.isCrew),
  };
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCrmWorkOrderProgressReports(supabase, context.params.id);
    if (error) {
      return routeError(500, 'crm_work_order_progress_list_failed', error.message);
    }

    const rows = (data || []) as unknown as ProgressRow[];

    // Kontoret känns igen på samma nyckel som kontorets DELETE-gren kräver, inte på rollen.
    // Härleddes den ur rollen svarade routen ja där databasen svarar nej så fort en nyckel dras in
    // i adminytan.
    const userId = currentUser.currentUser.id;
    const isOffice = can(await getEffectivePermissions(), 'crm.workorder.write');
    // Besättningsfrågan ställs till SAMMA funktion som policyn kallar, och bara när svaret kan
    // spela roll: kontoret behöver den inte, och den som inte äger någon rad på jobbet har ändå
    // ingenting att ta bort. Fältvyn betalar alltså ett RPC per öppnat jobb, kontoret noll.
    let isCrew = false;
    if (!isOffice && rows.some((row) => row.created_by === userId)) {
      const { data: onJob } = await isUserOnWorkOrder(supabase, userId, context.params.id);
      isCrew = onJob === true;
    }
    const viewer: Viewer = { userId, isOffice, isCrew };

    return ok({ items: rows.map((row) => mapProgressRow(row, viewer)) });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_progress_unexpected', e?.message || 'Failed to list progress reports');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const parsedBody = createProgressReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createRouteHandlerClient({ cookies });

    // ── Momenten hämtas ur ORDERN, inte ur kroppen ───────────────────────────
    // Etikett och enhet för ett kopplat moment snapshottas här. Tillåts klienten sätta dem kan en
    // rapport säga "45 st" mot en rad som säljer 120 meter, och kontorets "45 av 120" blir ett tal
    // utan betydelse.
    //
    // Läses med sessionsklienten: kan användaren inte läsa ordern ska hen inte kunna rapportera på
    // den, och då är null rätt svar snarare än ett uppslag vi eleverar oss till.
    const { data: order, error: orderError } = await getCrmWorkOrderLineItems(supabase, workOrderId);
    if (orderError) {
      return routeError(500, 'crm_work_order_progress_order_read_failed', orderError.message);
    }
    if (!order) {
      return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');
    }

    const workItems = progressWorkItemsFromLineItems(((order as any).line_items || []) as any[]);

    const rows: Array<Record<string, unknown>> = [];
    for (const entry of parsedBody.data.entries) {
      // Datum, plats och notering hör till DAGEN och stämplas på varje moment — se schemats huvud.
      const resolution = resolveProgressEntry(workItems, {
        ...entry,
        location: parsedBody.data.location,
        note: parsedBody.data.note,
      });
      if (!resolution.ok) {
        if (resolution.reason === 'unknown_line_item') {
          // 409 och inte 400: kroppen var välformad, men ordern har ändrats under fältvyns fötter.
          // Att i stället tyst spara raden som ett fritextmoment hade gjort en PLANERAD rapport
          // till en avvikelse i kontorets vy.
          return routeError(
            409,
            'crm_work_order_progress_unknown_line_item',
            'Ett av momenten finns inte längre på arbetsordern. Ladda om sidan så hämtas orderns aktuella rader.',
          );
        }
        return routeError(
          400,
          'crm_work_order_progress_missing_work_item',
          'Ett moment saknar namn. Välj en rad från ordern eller skriv vad ni gjorde.',
        );
      }

      rows.push({
        ...resolution.entry,
        // Ur rutt-parametern, aldrig ur kroppen — RLS gatar på det här fältet.
        work_order_id: workOrderId,
        report_day: parsedBody.data.report_day,
        created_by: currentUser.currentUser.id,
        created_by_name: currentUser.currentUser.name || 'Okänd',
      });
    }

    const { data, error } = await createCrmWorkOrderProgressReports(supabase, rows);
    if (error || !data) {
      // 42501 = RLS avvisade skrivningen. Det är ett behörighetssvar, inte ett serverfel: den som
      // inte är besättning på jobbet (och saknar crm.workorder.write) hamnar här.
      if ((error as { code?: string } | null)?.code === '42501') {
        return routeError(
          403,
          'crm_work_order_progress_forbidden',
          'Du är inte inbokad på det här jobbet och kan därför inte rapportera framdrift på det.',
        );
      }
      return routeError(500, 'crm_work_order_progress_create_failed', error?.message || 'Kunde inte spara rapporten.');
    }

    // Rapportören äger raderna hen just skrev, så knappen finns direkt — vilket är hela poängen med
    // den: dubbeltrycket i dålig mottagning ska gå att ta tillbaka på plats.
    //
    // `isCrew: true` utan uppslag är inte en gissning: insert-policyn ovan SLÄPPTE IGENOM raderna,
    // och den kräver besättning eller crm.workorder.write. Databasen har alltså just svarat på
    // frågan, och ett RPC till hade bara ställt den en gång till.
    const viewer: Viewer = {
      userId: currentUser.currentUser.id,
      isOffice: can(await getEffectivePermissions(), 'crm.workorder.write'),
      isCrew: true,
    };
    return ok({ items: (data as unknown as ProgressRow[]).map((row) => mapProgressRow(row, viewer)) }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_progress_create_unexpected', e?.message || 'Failed to create progress report');
  }
}
