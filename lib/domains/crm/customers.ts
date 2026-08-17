import type { SupabaseClient } from '@supabase/supabase-js';

export type CrmCustomerType = 'business' | 'private';
export type CrmCustomerStatus = 'active' | 'inactive' | 'churned';
export type CrmCustomerSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';
export type CrmCustomerStage = 'prospect' | 'customer' | 'fortnox_customer';

export type CrmAddress = {
  street: string | null;
  postal_code: string | null;
  city: string | null;
};

// Risk/intelligence flags sourced from the tic.io lookup, stored as JSONB.
export type CrmRiskIndicator = {
  type: string;
  subtype?: string;
  notes?: string;
  score?: number | null;
};

export const crmCustomerSelect = `
  id,
  customer_type,
  customer_stage,
  company_name,
  organization_number,
  first_name,
  last_name,
  personal_number,
  email,
  phone,
  mobile,
  visit_address,
  delivery_address,
  invoice_address,
  invoice_email,
  payment_terms,
  price_list,
  discount,
  vat_number,
  reverse_vat,
  annual_revenue,
  number_of_employees,
  legal_entity_type,
  sni_code,
  sni_name,
  operating_profit,
  profit_after_financial_items,
  total_assets,
  operating_margin,
  equity_ratio,
  financial_year,
  risk_indicators,
  tic_company_id,
  credit_report,
  credit_report_fetched_at,
  fortnox_customer_id,
  sync_status,
  last_synced_at,
  status,
  source,
  notes,
  assigned_to,
  account_manager_id,
  created_by,
  created_at,
  updated_at,
  contacts:crm_customer_contacts(
    id,
    name,
    role,
    phone,
    email,
    is_primary
  )
`;

const crmCustomerSearchSelect = `
  id,
  customer_type,
  customer_stage,
  company_name,
  first_name,
  last_name,
  organization_number,
  email,
  phone,
  mobile,
  visit_address,
  contacts:crm_customer_contacts(name, phone, email, is_primary)
`;

export type CreateCrmCustomerInput = {
  customer_type: CrmCustomerType;
  customer_stage?: CrmCustomerStage;
  company_name?: string | null;
  organization_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  personal_number?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  visit_address?: CrmAddress | null;
  delivery_address?: CrmAddress | null;
  invoice_address?: CrmAddress | null;
  invoice_email?: string | null;
  payment_terms?: string | null;
  price_list?: string | null;
  discount?: number | null;
  vat_number?: string | null;
  reverse_vat?: boolean;
  annual_revenue?: number | null;
  number_of_employees?: number | null;
  legal_entity_type?: string | null;
  sni_code?: string | null;
  sni_name?: string | null;
  operating_profit?: number | null;
  profit_after_financial_items?: number | null;
  total_assets?: number | null;
  operating_margin?: number | null;
  equity_ratio?: number | null;
  financial_year?: number | null;
  risk_indicators?: CrmRiskIndicator[] | null;
  tic_company_id?: number | null;
  credit_report?: unknown;
  credit_report_fetched_at?: string | null;
  fortnox_customer_id?: string | null;
  sync_status?: CrmCustomerSyncStatus;
  source?: string | null;
  notes?: string | null;
  assigned_to: string;
  // Kundansvarig säljare (FK profiles). Fristående från assigned_to (ägare/RLS-synlighet).
  account_manager_id?: string | null;
  created_by: string;
};

export type UpdateCrmCustomerInput = {
  customer_type?: CrmCustomerType;
  customer_stage?: CrmCustomerStage;
  company_name?: string | null;
  organization_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  personal_number?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  visit_address?: CrmAddress | null;
  delivery_address?: CrmAddress | null;
  invoice_address?: CrmAddress | null;
  invoice_email?: string | null;
  payment_terms?: string | null;
  price_list?: string | null;
  discount?: number | null;
  vat_number?: string | null;
  reverse_vat?: boolean;
  annual_revenue?: number | null;
  number_of_employees?: number | null;
  legal_entity_type?: string | null;
  sni_code?: string | null;
  sni_name?: string | null;
  operating_profit?: number | null;
  profit_after_financial_items?: number | null;
  total_assets?: number | null;
  operating_margin?: number | null;
  equity_ratio?: number | null;
  financial_year?: number | null;
  risk_indicators?: CrmRiskIndicator[] | null;
  fortnox_customer_id?: string | null;
  sync_status?: CrmCustomerSyncStatus;
  last_synced_at?: string | null;
  status?: CrmCustomerStatus;
  source?: string | null;
  notes?: string | null;
  assigned_to?: string;
  account_manager_id?: string | null;
};

export type CreateCrmCustomerContactInput = {
  customer_id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean;
};

export type UpdateCrmCustomerContactInput = {
  name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean;
};

// Default page size for the paginated customer list (infinite scroll appends pages).
export const CRM_CUSTOMERS_PAGE_SIZE = 50;

type ListCrmCustomersOptions = {
  search?: string;
  status?: CrmCustomerStatus;
  stage?: CrmCustomerStage;
  assignedTo?: string;
  limit?: number;
  offset?: number;
};

// Free-text search across the customer's identifying fields. `%term%` is a leading-wildcard
// match (no index can serve it) — fine at the current scale; add a pg_trgm index if the table
// grows into the tens of thousands.
function customerSearchOr(search: string): string {
  return `company_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,organization_number.ilike.%${search}%`;
}

// Paginated list. Returns rows for the requested page plus an exact `count` of the whole
// filtered set (PostgREST caps a plain select at db.max_rows ~1000, so we page with .range()
// instead of relying on a single large .limit()).
export async function listCrmCustomers(supabase: SupabaseClient, options: ListCrmCustomersOptions = {}) {
  const limit = Math.min(Math.max(options.limit ?? CRM_CUSTOMERS_PAGE_SIZE, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = supabase
    .from('crm_customers')
    .select(crmCustomerSelect, { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.search) {
    query = query.or(customerSearchOr(options.search));
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.stage) {
    query = query.eq('customer_stage', options.stage);
  }

  if (options.assignedTo) {
    query = query.eq('assigned_to', options.assignedTo);
  }

  return query;
}

export type CrmCustomerStageCounts = {
  alla: number;
  prospect: number;
  customer: number;
  fortnox_customer: number;
};

// Exact per-stage counts for the filter chips. Applies search/status/assignedTo but NOT the
// stage filter (so the chips always show the true totals you could switch to). Uses head-only
// count queries (no rows transferred) run in parallel.
export async function getCrmCustomerStageCounts(
  supabase: SupabaseClient,
  options: { search?: string; status?: CrmCustomerStatus; assignedTo?: string } = {}
): Promise<CrmCustomerStageCounts> {
  const stages: CrmCustomerStage[] = ['prospect', 'customer', 'fortnox_customer'];

  const countFor = (stage?: CrmCustomerStage) => {
    let q = supabase.from('crm_customers').select('id', { count: 'exact', head: true });
    if (options.search) q = q.or(customerSearchOr(options.search));
    if (options.status) q = q.eq('status', options.status);
    if (options.assignedTo) q = q.eq('assigned_to', options.assignedTo);
    if (stage) q = q.eq('customer_stage', stage);
    return q;
  };

  const [total, ...perStage] = await Promise.all([countFor(), ...stages.map((s) => countFor(s))]);

  return {
    alla: total.count ?? 0,
    prospect: perStage[0]?.count ?? 0,
    customer: perStage[1]?.count ?? 0,
    fortnox_customer: perStage[2]?.count ?? 0,
  };
}

export async function searchCrmCustomers(supabase: SupabaseClient, query: string) {
  return supabase
    .from('crm_customers')
    .select(crmCustomerSearchSelect)
    .or(
      `company_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,organization_number.ilike.%${query}%`
    )
    .order('updated_at', { ascending: false })
    .limit(10);
}

export async function getCrmCustomer(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_customers').select(crmCustomerSelect).eq('id', id).single();
}

// Privatkundens kontaktperson: personen ÄR kunden, så namnet står redan på kortet.
// Returnerar null för företag — där heter kontaktpersonen nästan aldrig samma sak som
// bolaget, så ett härlett namn vore fel — och för en privatkund utan ifyllt namn.
export function privateCustomerContactName(input: {
  customer_type: CrmCustomerType;
  first_name?: string | null;
  last_name?: string | null;
}): string | null {
  if (input.customer_type !== 'private') return null;
  const name = [input.first_name, input.last_name]
    .map((part) => part?.trim() || '')
    .filter(Boolean)
    .join(' ');
  return name || null;
}

// Skapar kunden och — för privatkunder — en primär kontaktperson med BARA namnet.
//
// Varför raden behövs: utan den returnerar `resolveCrmContact` tom sträng som namn, och
// offertens "Er referens" (obligatorisk, går till Fortnox YourReference) står tom trots att
// kontaktpersonen bevisligen är kunden själv. Prospektformuläret fyller redan i sin halva
// (se createCrmProspect) — det här stänger luckan från kundhållet.
//
// Varför BARA namnet: `resolveCrmContact` löser fält för fält och låter kontaktraden vinna
// över kortet. Kopierades telefon och e-post hit skulle en adress som rättas på kortet i
// efterhand tyst förbli oanvänd på offerter och mejl. Med enbart namnet fylls "Er referens"
// i av sig själv medan kortet förblir enda källan för telefon och e-post.
//
// Raden lever sitt eget liv efter skapandet — den speglar inte ett senare namnbyte på kortet.
// Den syns i kundkortets kontaktlista och rättas där.
export async function createCrmCustomer(supabase: SupabaseClient, input: CreateCrmCustomerInput) {
  const created = await supabase.from('crm_customers').insert(input).select(crmCustomerSelect).single();
  if (created.error || !created.data) return created;

  const contactName = privateCustomerContactName(input);
  if (!contactName) return created;

  const customerId = created.data.id as string;
  const { error: contactError } = await supabase
    .from('crm_customer_contacts')
    .insert({ customer_id: customerId, name: contactName, is_primary: true });
  // Icke-kritiskt: kunden är skapad. Utan kontaktraden faller allt tillbaka på kortet,
  // precis som det gjorde före den här ändringen — bättre än att fela hela skapandet.
  if (contactError) return created;

  // Hämta om så svaret bär med sig den nya kontakten (samma mönster som createCrmProspect).
  const refetched = await supabase.from('crm_customers').select(crmCustomerSelect).eq('id', customerId).single();
  return refetched.error || !refetched.data ? created : refetched;
}

export async function updateCrmCustomer(supabase: SupabaseClient, id: string, input: UpdateCrmCustomerInput) {
  return supabase.from('crm_customers').update(input).eq('id', id).select(crmCustomerSelect).single();
}

// Persist a fetched tic.io credit report snapshot. Writes only the credit columns and is
// meant to be called with an elevated (admin) client from the manual-fetch route, so any
// CRM writer can pull a report regardless of the row's assigned_to (the route gates auth).
export async function saveCrmCustomerCreditReport(
  supabase: SupabaseClient,
  id: string,
  input: { tic_company_id: number; credit_report: unknown; credit_report_fetched_at: string }
) {
  return supabase.from('crm_customers').update(input).eq('id', id).select(crmCustomerSelect).single();
}

// Bara EN primärkontakt per kund. `is_primary` är en vanlig boolean utan unikt index eller
// trigger (20260602_crm_customers.sql), så invarianten måste hållas här — annars kan en kund
// få två primärrader, och `primaryCrmContact` gör `.find(c => c.is_primary)` över en OORDNAD
// PostgREST-embed: vilken som vinner blir godtyckligt, och den kontakt säljaren medvetet
// pekade ut kan tyst ignoreras.
//
// Blev akut i och med att privatkunder nu får en automatisk primärrad vid skapandet: utan
// degraderingen förlorar den kontaktperson säljaren lägger till EFTERÅT mot den automatiska.
// Tidigare fanns ingen rad alls, så säljarens val vann alltid.
//
// Degradera FÖRE skrivningen, annars nollas den nya raden av sin egen städning. Två anrop
// utan transaktion: slår skrivningen fel efteråt står kunden utan primär, och
// `primaryCrmContact` faller tillbaka på `contacts[0]` — den kan alltså fortfarande nå en
// kontakt. Alternativet vore ett partiellt unikt index, men det kräver en migrering.
async function demoteOtherPrimaryContacts(supabase: SupabaseClient, customerId: string, exceptId?: string) {
  let query = supabase.from('crm_customer_contacts').update({ is_primary: false }).eq('customer_id', customerId);
  if (exceptId) query = query.neq('id', exceptId);
  await query;
}

export async function createCrmCustomerContact(supabase: SupabaseClient, input: CreateCrmCustomerContactInput) {
  if (input.is_primary) await demoteOtherPrimaryContacts(supabase, input.customer_id);
  return supabase.from('crm_customer_contacts').insert(input).select('id, name, role, phone, email, is_primary').single();
}

export async function updateCrmCustomerContact(
  supabase: SupabaseClient,
  id: string,
  input: UpdateCrmCustomerContactInput
) {
  // Kontaktraden bär kundens id, så vi måste läsa den innan vi kan degradera syskonen.
  if (input.is_primary) {
    const { data: existing } = await supabase
      .from('crm_customer_contacts')
      .select('customer_id')
      .eq('id', id)
      .maybeSingle();
    if (existing?.customer_id) await demoteOtherPrimaryContacts(supabase, existing.customer_id as string, id);
  }
  return supabase
    .from('crm_customer_contacts')
    .update(input)
    .eq('id', id)
    .select('id, name, role, phone, email, is_primary')
    .single();
}

export async function deleteCrmCustomerContact(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_customer_contacts').delete().eq('id', id);
}

export async function convertProspectToCustomer(
  supabase: SupabaseClient,
  prospectId: string,
  _assignedTo: string,
  _createdBy: string
): Promise<{ customerId: string | null; error: string | null }> {
  const { data: customer, error } = await supabase
    .from('crm_customers')
    .select('id, customer_stage')
    .eq('id', prospectId)
    .maybeSingle();

  if (error) {
    return { customerId: null, error: error.message };
  }

  if (!customer) {
    return { customerId: null, error: 'Prospekt hittades inte' };
  }

  if (customer.customer_stage !== 'prospect') {
    return { customerId: customer.id, error: null };
  }

  const { data: updated, error: updateError } = await supabase
    .from('crm_customers')
    .update({ customer_stage: 'customer', status: 'active' })
    .eq('id', prospectId)
    .select('id')
    .single();

  if (updateError || !updated) {
    return { customerId: null, error: updateError?.message || 'Kunde inte konvertera prospekt' };
  }

  return { customerId: updated.id, error: null };
}

/**
 * Sätter kundansvarig på en kund — men BARA om fältet är tomt.
 *
 * Anropas när en offert markeras vunnen, så att offertens ansvariga säljare också blir
 * ansvarig för kunden. Fyll-om-tomt och inte skriv-över: en säljare som vinner en enskild
 * offert hos någon annans etablerade kund ska inte tyst ta över hela kundrelationen (den
 * styr både kundregistret och vem topplistan räknar). Ett medvetet byte görs i kundformuläret.
 *
 * Returnerar `changed` så anroparen kan logga skillnaden mellan "satte den" och "fanns redan".
 * RLS: crm_customers UPDATE släpper igenom alla med crm.customer.write
 * (20260629_crm_customers_shared_register.sql), så ingen elevated klient behövs.
 */
export async function setAccountManagerIfUnset(
  supabase: SupabaseClient,
  customerId: string,
  sellerId: string
): Promise<{ changed: boolean; error: string | null }> {
  const { data: existing, error: readError } = await supabase
    .from('crm_customers')
    .select('id, account_manager_id')
    .eq('id', customerId)
    .maybeSingle();

  if (readError) return { changed: false, error: readError.message };
  if (!existing) return { changed: false, error: 'Kunden hittades inte' };
  if (existing.account_manager_id) return { changed: false, error: null };

  // is null-villkoret är med i UPDATE:en och inte bara i läsningen ovan: två samtidiga
  // vunna offerter på samma kund skulle annars låta den sista skriva över den första.
  //
  // .select('id') är inte kosmetik. En UPDATE som träffar noll rader svarar `error: null` —
  // en RLS-nekad skrivning ser exakt ut som en lyckad. Utan radräkningen hade anroparens
  // felloggning aldrig gått igång och kundansvarig tyst uteblivit. Samma felklass som
  // planeringen tappade segment på.
  const { data: updated, error: updateError } = await supabase
    .from('crm_customers')
    .update({ account_manager_id: sellerId })
    .eq('id', customerId)
    .is('account_manager_id', null)
    .select('id');

  if (updateError) return { changed: false, error: updateError.message };
  if (!updated || updated.length === 0) {
    return {
      changed: false,
      error: 'Skrivningen träffade noll rader — antingen nekad av RLS eller så hann en annan sparning före.',
    };
  }
  return { changed: true, error: null };
}

// Säljare som kan vara kundansvarig: profiles med role sales/admin. konsult är
// READONLY och utesluts. Läs-modell över hela teamet → kör med en elevated klient
// (profiles-RLS är self-only), samma mönster som reports.ts/ringlists.ts.
export type CrmSeller = { id: string; full_name: string | null; role: string };

export async function listCrmSellers(supabase: SupabaseClient): Promise<CrmSeller[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['sales', 'admin'])
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmSeller[];
}

export function getCrmCustomerDisplayName(customer: {
  customer_type: CrmCustomerType;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (customer.customer_type === 'business') {
    return customer.company_name ?? 'Okänt företag';
  }
  const parts = [customer.first_name, customer.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}
