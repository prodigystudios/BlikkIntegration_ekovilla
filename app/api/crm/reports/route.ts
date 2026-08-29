import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, requireCrmUser } from '@/app/api/crm/_shared';
import { composeSalesReport, fetchReportData, partitionOrders, type ReportRange } from '@/lib/domains/crm/reports';
import { computeAfterCalculations, type AfterCalculationOrderRow } from '@/lib/domains/crm/afterCalculationLoader';
import type { AfterCalculation } from '@/lib/domains/crm/afterCalculation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)');
const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

// Default range: the last 12 months (inclusive of the current month).
function defaultRange(): ReportRange {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: start.toISOString().slice(0, 10), to };
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

    let afterCalculations = new Map<string, AfterCalculation>();
    if (invoicedIds.length > 0) {
      try {
        const { data: orderRows, error } = await admin
          .from('crm_work_orders')
          .select('id, line_items, vat_percent')
          .in('id', invoicedIds);
        if (error) throw new Error(error.message);
        afterCalculations = await computeAfterCalculations(admin, (orderRows || []) as AfterCalculationOrderRow[]);
      } catch (e: any) {
        console.warn(`[Rapport] Lönsamheten kunde inte räknas: ${e?.message || e}`);
      }
    }

    const report = composeSalesReport(data, range, afterCalculations);

    return ok(report);
  } catch (e: any) {
    return routeError(500, 'crm_reports_failed', e?.message || 'Kunde inte ta fram rapporten');
  }
}
