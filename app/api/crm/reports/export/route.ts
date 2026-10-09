import { getSupabaseAdmin } from '@/lib/supabase/server';
import { routeError, requireCrmUser } from '@/app/api/crm/_shared';
import { fetchInvoicedValue, fetchReportData, monthsInRange, type ReportRange } from '@/lib/domains/crm/reports';
import { fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { buildOwnerReport } from '@/lib/domains/crm/reportOwnerExport';
import { fetchSellerGoals } from '@/lib/domains/crm/reportOwnerExportLoader';
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
    const range: ReportRange = { from: `${todayIso.slice(0, 4)}-01-01`, to: todayIso };
    const basisRange = reportRange('prevMonth', now);
    const admin = getSupabaseAdmin();

    // ⚠️ BUDGETEN OCH ORDERSTOCKEN FÅR FELA FÖR SIG och blir null — filen säger då att de inte kunde
    // läsas, i stället för att visa tomma mål eller en orderstock på 0 kr. Försäljningssiffrorna är
    // filens kärna; felar de, felar exporten.
    const [data, goals, orderStockRows, basis] = await Promise.all([
      fetchReportData(admin, range),
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

    const report = buildOwnerReport({ data, range, today: todayIso, goals, orderStockRows, basis });
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
