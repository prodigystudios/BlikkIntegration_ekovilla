import { getSupabaseAdmin } from '@/lib/supabase/server';
import { routeError, requireCrmUser } from '@/app/api/crm/_shared';
import { fetchInvoicedValue, fetchTrendData, monthsInRange } from '@/lib/domains/crm/reports';
import { fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { buildOwnerReport, sellerIdsOf } from '@/lib/domains/crm/reportOwnerExport';
import { fetchProfileNames, fetchSellerGoals } from '@/lib/domains/crm/reportOwnerExportLoader';
import { ownerReportFilename, writeOwnerWorkbook } from '@/lib/domains/crm/reportOwnerWorkbook';
import { reportRange, today } from '@/app/crm/rapportering/reportRanges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Rutten läser kakan (requireCrmUser) och är därför redan okachad, men en ägarrapport får aldrig komma
// ur en cache — samma bälte som dokumentrutten (se project_next14_get_route_fetch_cache).
export const fetchCache = 'force-no-store';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Ägarnas veckorapport som Excel: året hittills per säljare och vecka, budget mot utfall per månad och
// orderstocken just nu. Samma siffror och samma grind som rapportsidan (crm.access) — filen visar inget
// som sidan inte redan visar. Ingen tid, ingen frånvaro.
export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const now = new Date();
    const todayIso = today(now);
    // Rapportsidans eget "I år" — samma intervall, ankrat i svensk dag.
    const range = reportRange('year', now);
    const basisRange = reportRange('prevMonth', now);
    const admin = getSupabaseAdmin();

    // ⚠️ BUDGETEN OCH ORDERSTOCKEN FÅR FELA FÖR SIG och blir null — filen säger då att de inte kunde
    // läsas, i stället för att visa tomma mål eller en orderstock på 0 kr. Försäljningssiffrorna är
    // filens kärna; felar de, felar exporten.
    //
    // Offerterna, ordrarna och rundorna läses som rapportens (fetchTrendData = fetchReportData utan samtal
    // och säljarlista — exporten visar inga samtal, och säljarnas namn läses nedan för alla som förekommer).
    const [rows, goals, orderStockRows, basis] = await Promise.all([
      fetchTrendData(admin, range),
      fetchSellerGoals(admin, monthsInRange(range.from, range.to)).catch((e: any) => {
        console.warn(`[Ägarrapport] Målen kunde inte läsas: ${e?.message || e}`);
        return null;
      }),
      fetchOrderStockRows(admin).catch((e: any) => {
        console.warn(`[Ägarrapport] Orderstocken kunde inte läsas: ${e?.message || e}`);
        return null;
      }),
      fetchInvoicedValue(admin, basisRange).then(
        (invoiced) => ({ range: basisRange, invoiced }),
        (e: any) => {
          console.warn(`[Ägarrapport] Förra månadens fakturering kunde inte läsas: ${e?.message || e}`);
          return null;
        },
      ),
    ]);

    // Namnen på alla som har siffror eller mål, oavsett roll: den som slutat ska stå med sitt namn. Felar
    // läsningen står siffrorna kvar under "Okänd användare" — namnen får inte fälla exporten.
    const sellers = await fetchProfileNames(admin, sellerIdsOf(rows, goals)).catch((e: any) => {
      console.warn(`[Ägarrapport] Säljarnas namn kunde inte läsas: ${e?.message || e}`);
      return [];
    });

    const report = buildOwnerReport({ data: { ...rows, sellers }, range, today: todayIso, goals, orderStockRows, basis });
    const file = await writeOwnerWorkbook(report, now);
    const filename = ownerReportFilename(report);

    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return routeError(500, 'crm_report_export_failed', e?.message || 'Kunde inte skapa Excel-filen');
  }
}
