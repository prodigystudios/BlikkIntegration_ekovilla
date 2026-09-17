import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, requireCrmUser } from '@/app/api/crm/_shared';
import { composeSalesReport, fetchReportData, partitionOrders, type ReportRange } from '@/lib/domains/crm/reports';
import { computeAfterCalculations, type AfterCalculationOrderRow } from '@/lib/domains/crm/afterCalculationLoader';
import type { AfterCalculation } from '@/lib/domains/crm/afterCalculation';
import { reportRange } from '@/app/crm/rapportering/reportRanges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)');
const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

// Default range: the last 12 months (inclusive of the current month).
// Ankrat i svensk dag: strax efter midnatt gav UTC-dygnet ett intervall som slutade i går, och den
// 1:a i månaden flyttade dessutom hela tolvmånadersfönstret en månad bakåt.
//
// Samma funktion som rapportsidans egen snabbknapp "Senaste 12 mån" använder — den är ren, tar
// ögonblicket som argument och är redan testad. En egen kopia av månadsaritmetiken här hade varit
// husets tredje, och den enda som ingen prövar.
function defaultRange(): ReportRange {
  return reportRange('last12');
}

export async function GET(req: Request) {
  try {
    // Reporting is gated to CRM users; all sellers may view team-wide figures.
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const fallback = defaultRange();
    const range: ReportRange = {
      from: parsed.data.from || fallback.from,
      to: parsed.data.to || fallback.to,
    };
    if (range.from > range.to) return routeError(400, 'invalid_range', 'Startdatum måste vara före slutdatum.');

    // Admin client: team-wide aggregated read model (profiles RLS only self-reads
    // with a session client — same rationale as the goals route).
    const admin = getSupabaseAdmin();
    const data = await fetchReportData(admin, range);

    // ── Lönsamheten ──────────────────────────────────────────────────────────
    // Bara de FAKTURERADE ordrarna efterkalkyleras. Populationen är densamma som "Fakturerat" i
    // serien, och det håller nere arbetet: `line_items` hämtas för en handfull ordrar i stället för
    // tolv månaders hela orderstock.
    //
    // ⚠️ Lönsamheten får inte kunna sänka rapporten. Kalkylen vilar på två inställningstabeller och
    // artikelcachen; felar någon av dem ska säljsiffrorna fortfarande visas, och lönsamhetsdelen
    // stå tom. Det är skillnaden mellan en del av sidan som saknas och en sida som inte laddar.
    const invoicedIds = partitionOrders(data.orders, range).invoiced
      .map((order) => order.id)
      .filter((id): id is string => Boolean(id));

    const afterCalculations = new Map<string, AfterCalculation>();
    let profitabilityUnavailable = false;
    if (invoicedIds.length > 0) {
      try {
        // ⚠️ KLUMPAR, INTE HELA LISTAN. `.in()` blir en query-sträng, och tolv månaders fakturerade
        // ordrar kan vara hundratals uuid:n à 37 tecken — långt förbi vad mellanled garanterar, med
        // ett 414 som svar. Klumparna håller dessutom varje svar under PostgRESTs radtak, som
        // annars kapar tyst: de tappade ordrarna hade försvunnit ur täckningsgraden men räknats
        // kvar i "av N jobb". Samma tak som listrutten delar på.
        const CHUNK = 100;
        for (let i = 0; i < invoicedIds.length; i += CHUNK) {
          const chunk = invoicedIds.slice(i, i + CHUNK);
          const { data: orderRows, error } = await admin
            .from('crm_work_orders')
            .select('id, line_items, vat_percent')
            .in('id', chunk);
          if (error) throw new Error(error.message);
          const computed = await computeAfterCalculations(admin, (orderRows || []) as AfterCalculationOrderRow[]);
          for (const [id, result] of computed) afterCalculations.set(id, result);
        }
      } catch (e: any) {
        // ⚠️ FLAGGAN MÅSTE MED I SVARET. Bara en logg här gjorde att klienten renderade "inget jobb
        // har komplett underlag än" — ett påstående om att fältet inte lämnat in sina
        // egenkontroller, när sanningen kunde vara att migreringen inte var körd. Orsaken får inte
        // stanna i serverloggen.
        profitabilityUnavailable = true;
        console.warn(`[Rapport] Lönsamheten kunde inte räknas: ${e?.message || e}`);
      }
    }

    const report = composeSalesReport(data, range, afterCalculations, { profitabilityUnavailable });

    return ok(report);
  } catch (e: any) {
    return routeError(500, 'crm_reports_failed', e?.message || 'Kunde inte ta fram rapporten');
  }
}
