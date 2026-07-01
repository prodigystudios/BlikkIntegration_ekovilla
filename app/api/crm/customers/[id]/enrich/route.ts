import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmCustomer, updateCrmCustomer, type UpdateCrmCustomerInput } from '@/lib/domains/crm/customers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getTicCompanyByOrgNumber } from '@/lib/domains/tic/companies';
import { ticRouteErrorInfo } from '@/lib/domains/tic/client';
import { invalidUuidParam, ok, requireCrmWriter, routeError } from '../../_lib';

type RouteContext = { params: { id: string } };

const isEmptyStr = (v: unknown) => v == null || String(v).trim() === '';
const addressEmpty = (a: { street: string | null; postal_code: string | null; city: string | null } | null | undefined) =>
  !a || (isEmptyStr(a.street) && isEmptyStr(a.postal_code) && isEmptyStr(a.city));

// Enrich an existing company customer with tic.io company data (bransch, bolagsform,
// ekonomi/nyckeltal, risk, plus contact/address). Mirrors the create-form lookup: fills only
// EMPTY fields so Fortnox-imported identity data is never clobbered. Writer-gated; saves via
// the admin client so any CRM writer can enrich regardless of the row's assigned_to.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: existing, error } = await getCrmCustomer(supabase, context.params.id);
    if (error || !existing) {
      return routeError(404, 'crm_customer_not_found', error?.message || 'Kund hittades inte');
    }
    if (existing.customer_type !== 'business') {
      return routeError(400, 'crm_customer_not_company', 'Företagsdata är endast tillgänglig för företagskunder.');
    }
    if (!existing.organization_number) {
      return routeError(400, 'crm_customer_missing_org_number', 'Kunden saknar organisationsnummer – kan inte hämta företagsdata.');
    }

    let company;
    try {
      company = await getTicCompanyByOrgNumber(existing.organization_number);
    } catch (ticErr) {
      const info = ticRouteErrorInfo(ticErr);
      return routeError(info.status, info.code, info.message);
    }
    if (!company) {
      return routeError(404, 'tic_company_not_found', 'Företaget kunde inte hittas hos tic.io.');
    }

    // Fill-only-empty: build an update from fields tic has a value for AND the customer lacks.
    const update: UpdateCrmCustomerInput = {};
    if (isEmptyStr(existing.company_name) && company.company_name) update.company_name = company.company_name;
    if (isEmptyStr(existing.email) && company.email) update.email = company.email;
    if (isEmptyStr(existing.phone) && company.phone) update.phone = company.phone;
    if (addressEmpty(existing.visit_address) && company.address) {
      update.visit_address = {
        street: company.address.street || null,
        postal_code: company.address.postal_code || null,
        city: company.address.city || null,
      };
    }
    if (existing.annual_revenue == null && company.annual_revenue != null) update.annual_revenue = company.annual_revenue;
    if (existing.number_of_employees == null && company.number_of_employees != null) update.number_of_employees = company.number_of_employees;
    if (isEmptyStr(existing.legal_entity_type) && company.legal_entity_type) update.legal_entity_type = company.legal_entity_type;
    if (isEmptyStr(existing.sni_code) && company.sni_code) update.sni_code = company.sni_code;
    if (isEmptyStr(existing.sni_name) && company.sni_name) update.sni_name = company.sni_name;
    if (existing.operating_profit == null && company.operating_profit != null) update.operating_profit = company.operating_profit;
    if (existing.profit_after_financial_items == null && company.profit_after_financial_items != null) update.profit_after_financial_items = company.profit_after_financial_items;
    if (existing.total_assets == null && company.total_assets != null) update.total_assets = company.total_assets;
    if (existing.operating_margin == null && company.operating_margin != null) update.operating_margin = company.operating_margin;
    if (existing.equity_ratio == null && company.equity_ratio != null) update.equity_ratio = company.equity_ratio;
    if (existing.financial_year == null && company.financial_year != null) update.financial_year = company.financial_year;
    if ((!existing.risk_indicators || existing.risk_indicators.length === 0) && company.risk_indicators && company.risk_indicators.length > 0) {
      update.risk_indicators = company.risk_indicators;
    }

    const filled = Object.keys(update).length;
    if (filled === 0) {
      return ok({ item: existing, filled: 0 });
    }

    const admin = getSupabaseAdmin();
    const { data: updated, error: saveError } = await updateCrmCustomer(admin, context.params.id, update);
    if (saveError || !updated) {
      return routeError(500, 'crm_customer_enrich_save_failed', saveError?.message || 'Kunde inte spara företagsdata.');
    }

    return ok({ item: updated, filled });
  } catch (e: any) {
    return routeError(500, 'crm_customer_enrich_unexpected', e?.message || 'Failed to enrich customer');
  }
}
