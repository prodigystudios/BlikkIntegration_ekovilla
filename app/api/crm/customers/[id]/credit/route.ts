import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmCustomer, saveCrmCustomerCreditReport } from '@/lib/domains/crm/customers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fetchTicCreditReport, TicCompanyNotFoundError } from '@/lib/domains/tic/credit';
import { ticRouteErrorInfo } from '@/lib/domains/tic/client';
import { ok, requireCrmWriter, routeError } from '../../_lib';

type RouteContext = { params: { id: string } };

// Manually fetch a tic.io credit report (kreditupplysning) for a company customer and
// store the snapshot on the row. Manual + persisted by design so we don't re-bill tic.io
// on every page view. Writer-gated (sales/admin); konsult is read-only.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: existing, error } = await getCrmCustomer(supabase, context.params.id);
    if (error || !existing) {
      return routeError(404, 'crm_customer_not_found', error?.message || 'Kund hittades inte');
    }

    if (existing.customer_type !== 'business') {
      return routeError(400, 'crm_customer_not_company', 'Kreditupplysning är endast tillgänglig för företagskunder.');
    }
    if (!existing.organization_number && !existing.tic_company_id) {
      return routeError(400, 'crm_customer_missing_org_number', 'Kunden saknar organisationsnummer – kan inte hämta kreditupplysning.');
    }

    let result: Awaited<ReturnType<typeof fetchTicCreditReport>>;
    try {
      result = await fetchTicCreditReport({
        organizationNumber: existing.organization_number,
        companyId: existing.tic_company_id,
      });
    } catch (ticErr) {
      if (ticErr instanceof TicCompanyNotFoundError) {
        return routeError(404, 'tic_company_not_found', ticErr.message);
      }
      const info = ticRouteErrorInfo(ticErr);
      return routeError(info.status, info.code, info.message);
    }

    // Persist via the admin client so any CRM writer can pull a report regardless of the
    // row's assigned_to (auth is already enforced above). Writes only the credit columns.
    const admin = getSupabaseAdmin();
    const { data: updated, error: saveError } = await saveCrmCustomerCreditReport(admin, context.params.id, {
      tic_company_id: result.companyId,
      credit_report: result.report,
      credit_report_fetched_at: new Date().toISOString(),
    });
    if (saveError || !updated) {
      return routeError(500, 'crm_customer_credit_save_failed', saveError?.message || 'Kunde inte spara kreditupplysningen.');
    }

    return ok({ item: updated });
  } catch (e: any) {
    return routeError(500, 'crm_customer_credit_unexpected', e?.message || 'Failed to fetch credit report');
  }
}
