import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut } from './client';
import type {
  FortnoxCustomerListResponse,
  FortnoxCustomer,
  FortnoxTermsOfPaymentListResponse,
  FortnoxPriceListResponse,
} from './types';

type FortnoxCustomerDetailResponse = { Customer: FortnoxCustomer };

const PAGE_SIZE = 500;
// Concurrency for DB writes (no Fortnox calls happen in the bulk import path, so
// this is only about not flooding Supabase with simultaneous statements).
const DB_CONCURRENCY = 10;
// Verification pass: small batch + spacing keeps the per-customer Fortnox GETs
// well under the ~4 req/s rate limit. Resumable, so size is just per-request cost.
const VERIFY_BATCH_SIZE = 50;
const VERIFY_SPACING_MS = 300; // ~3 req/s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Heuristic company-vs-private from the list endpoint, which omits Type. A Swedish
// organisationsnummer's 3rd digit is the "group" digit (2–9), while a personnummer's
// 3rd digit is the tens-of-month, always 0 or 1 (months 01–12). Falls back to
// VAT-number presence, then private (safe default). Known edge case: a sole trader
// (enskild firma) uses the owner's personnummer as org.nr and is read as private
// until the verification pass fetches Fortnox's authoritative Type.
export function inferCustomerType(
  orgNumber: string | null | undefined,
  vatNumber: string | null | undefined,
): 'business' | 'private' {
  const digits = (orgNumber ?? '').replace(/\D/g, '');
  // A 12-digit number is century-prefixed (YYYYMMDD… or 16-prefixed org.nr) – the
  // last 10 carry the discriminating digit either way.
  const normalized = digits.length === 12 ? digits.slice(2) : digits;
  if (normalized.length >= 10) {
    return Number(normalized[2]) >= 2 ? 'business' : 'private';
  }
  if (vatNumber && vatNumber.trim()) return 'business';
  return 'private';
}

// Runs fn over items in serial batches of batchSize concurrent calls. Used for
// per-customer DB UPDATEs to avoid flooding the DB with concurrent statements.
async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export type CustomerSyncResult = {
  created: number;
  updated: number;
  pages: number;
};

// Split a single "Förnamn Efternamn" string into first/last (first token vs the rest).
// Shared by every place that maps a single Name field back to our split columns.
export function splitSwedishName(fullName: string | null | undefined): { first: string | null; last: string | null } {
  const name = (fullName ?? '').trim();
  if (!name) return { first: null, last: null };
  const parts = name.split(' ');
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') || null };
}

// Build a {street, postal_code, city} address object, or null when all parts are empty.
export function buildFortnoxAddress(
  street: string | null | undefined,
  postalCode: string | null | undefined,
  city: string | null | undefined,
): { street: string | null; postal_code: string | null; city: string | null } | null {
  if (!street && !postalCode && !city) return null;
  return { street: street ?? null, postal_code: postalCode ?? null, city: city ?? null };
}

// Maps a Fortnox customer onto a crm_customers row. `resolvedType` is decided by
// the caller (heuristic on import, Fortnox's authoritative Type on verification),
// and `verified` records which of those it is. Guards the identity constraint: a
// single-word/empty Fortnox Name must never produce an all-null-identity row.
function mapFortnoxCustomerToRow(
  c: FortnoxCustomer,
  resolvedType: 'business' | 'private',
  verified: boolean,
  now: string,
) {
  const isCompany = resolvedType === 'business';
  const name = splitSwedishName(c.Name);
  // Fortnox always has a Name, but stay defensive: fall back to a stable label so
  // company_name / first_name can never both be null (constraint violation).
  const fallbackName = (c.Name ?? '').trim() || `Fortnox-kund ${c.CustomerNumber}`;
  return {
    customer_type: resolvedType,
    customer_type_verified: verified,
    customer_stage: 'fortnox_customer' as const,
    company_name: isCompany ? fallbackName : null,
    first_name: isCompany ? null : (name.first ?? fallbackName),
    last_name: isCompany ? null : name.last,
    // OrganisationNumber holds a company's org.nr or a private person's personnummer.
    organization_number: isCompany ? (c.OrganisationNumber ?? null) : null,
    personal_number: isCompany ? null : (c.OrganisationNumber ?? null),
    email: c.Email ?? null,
    phone: c.Phone1 ?? null,
    mobile: c.Mobile ?? c.Phone2 ?? null,
    visit_address: buildFortnoxAddress(c.VisitingAddress, c.VisitingZipCode, c.VisitingCity),
    delivery_address: buildFortnoxAddress(c.DeliveryAddress1, c.DeliveryZipCode, c.DeliveryCity),
    invoice_address: buildFortnoxAddress(c.Address1, c.ZipCode, c.City),
    invoice_email: c.EmailInvoice ?? null,
    payment_terms: c.TermsOfPayment ?? null,
    price_list: c.PriceList ?? null,
    discount: c.InvoiceDiscount ?? null,
    vat_number: c.VATNumber ?? null,
    reverse_vat: c.VATType === 'SEREVERSEDVAT',
    fortnox_customer_id: c.CustomerNumber,
    sync_status: 'synced' as const,
    last_synced_at: now,
    status: 'active' as const,
    source: 'fortnox_import',
    updated_at: now,
  };
}

// Bulk-insert rows, falling back to row-by-row on failure so a single bad record
// (e.g. an identity-constraint edge case) never aborts the whole page. Returns
// how many rows actually landed.
async function insertCustomersResilient(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: Record<string, unknown>[],
): Promise<number> {
  const { error } = await supabase.from('crm_customers').insert(rows);
  if (!error) return rows.length;

  console.warn(`[Fortnox sync] Bulk-insert misslyckades (${error.message}) → faller tillbaka på rad-för-rad`);
  let inserted = 0;
  for (const row of rows) {
    const { error: rowErr } = await supabase.from('crm_customers').insert(row);
    if (rowErr) {
      console.warn(`[Fortnox sync] Hoppar över kund ${row.fortnox_customer_id} (${rowErr.message})`);
    } else {
      inserted++;
    }
  }
  return inserted;
}

// Fetch all customers from Fortnox and upsert into crm_customers.
// Matches on fortnox_customer_id (unique) to update existing rows.
//
// The list endpoint does NOT return Type, so company-vs-private is decided by
// inferCustomerType() heuristic and the row is marked customer_type_verified=false.
// We deliberately do NOT fetch each customer individually here – that fan-out
// (one GET per customer) blew past Fortnox's rate limit on real-size registers
// (thousands of customers → mass 429s → every row mis-classified as private).
// verifyCustomerTypesBatch() confirms Type afterwards, throttled.
export async function syncFortnoxCustomers(triggeredByUserId: string): Promise<CustomerSyncResult> {
  const supabase = getSupabaseAdmin();
  let page = 1;
  let totalPages = 1;
  let totalCreated = 0;
  let totalUpdated = 0;
  const now = new Date().toISOString();

  do {
    const response = await fortnoxGet<FortnoxCustomerListResponse>('/customers', {
      limit: String(PAGE_SIZE),
      page: String(page),
      sortby: 'customernumber',
      sortorder: 'ascending',
    });

    const listCustomers = response.Customers ?? [];
    totalPages = response.MetaInformation?.['@TotalPages'] ?? 1;

    if (listCustomers.length > 0) {
      const ids = listCustomers.map((c) => c.CustomerNumber);
      const { data: existing } = await supabase
        .from('crm_customers')
        .select('id, fortnox_customer_id, customer_type, customer_type_verified')
        .in('fortnox_customer_id', ids);

      const existingById = new Map((existing ?? []).map((r) => [r.fortnox_customer_id, r]));

      const toCreate = listCustomers.filter((c) => !existingById.has(c.CustomerNumber));
      const toUpdate = listCustomers.filter((c) => existingById.has(c.CustomerNumber));

      // Create new rows. Heuristic Type, unverified until the verification pass runs.
      if (toCreate.length > 0) {
        const rows = toCreate.map((c) => ({
          ...mapFortnoxCustomerToRow(c, inferCustomerType(c.OrganisationNumber, c.VATNumber), false, now),
          assigned_to: triggeredByUserId,
          created_by: triggeredByUserId,
          created_at: now,
        }));
        totalCreated += await insertCustomersResilient(supabase, rows);
      }

      // Update existing rows. An upsert would clobber assigned_to/created_by
      // ownership, so we UPDATE per customer (matched on unique fortnox_customer_id).
      // A row already verified keeps its authoritative Type – we must not regress it
      // back to a heuristic guess on a routine re-sync.
      if (toUpdate.length > 0) {
        await runInBatches(toUpdate, DB_CONCURRENCY, async (c) => {
          const prev = existingById.get(c.CustomerNumber)!;
          const verified = prev.customer_type_verified === true;
          const type: 'business' | 'private' = verified
            ? (prev.customer_type === 'business' ? 'business' : 'private')
            : inferCustomerType(c.OrganisationNumber, c.VATNumber);
          const { error } = await supabase
            .from('crm_customers')
            .update(mapFortnoxCustomerToRow(c, type, verified, now))
            .eq('fortnox_customer_id', c.CustomerNumber);
          if (error) {
            console.warn(`[Fortnox sync] Kunde inte uppdatera kund ${c.CustomerNumber} (${error.message})`);
          }
          return null;
        });
        totalUpdated += toUpdate.length;
      }
    }

    page++;
  } while (page <= totalPages);

  return { created: totalCreated, updated: totalUpdated, pages: totalPages };
}

export type VerifyTypesResult = {
  processed: number;
  corrected: number;
  remaining: number;
};

// Confirm customer_type for rows imported via heuristic (customer_type_verified=false)
// by fetching each customer's authoritative Type from Fortnox, throttled to stay
// under the rate limit. Resumable: processes one batch per call and reports how
// many still remain, so a UI/cron can loop until remaining === 0.
export async function verifyCustomerTypesBatch(limit = VERIFY_BATCH_SIZE): Promise<VerifyTypesResult> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: pending, error } = await supabase
    .from('crm_customers')
    .select('id, fortnox_customer_id, customer_type')
    .eq('customer_type_verified', false)
    .not('fortnox_customer_id', 'is', null)
    .order('fortnox_customer_id', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Kunde inte hämta overifierade kunder: ${error.message}`);

  const rows = pending ?? [];
  let corrected = 0;

  for (const row of rows) {
    try {
      const detail = await fortnoxGet<FortnoxCustomerDetailResponse>(`/customers/${row.fortnox_customer_id}`);
      const c = detail.Customer;
      const realType: 'business' | 'private' = c.Type === 'COMPANY' ? 'business' : 'private';

      const { error: updErr } = await supabase
        .from('crm_customers')
        .update(mapFortnoxCustomerToRow(c, realType, true, now))
        .eq('id', row.id);

      if (updErr) {
        console.warn(`[Fortnox verify] Kunde inte uppdatera kund ${row.fortnox_customer_id} (${updErr.message})`);
        continue;
      }
      if (realType !== row.customer_type) corrected++;
    } catch (err) {
      console.warn(`[Fortnox verify] Kunde inte hämta kund ${row.fortnox_customer_id} (${(err as Error)?.message ?? err})`);
    }
    await sleep(VERIFY_SPACING_MS);
  }

  const { count } = await supabase
    .from('crm_customers')
    .select('id', { count: 'exact', head: true })
    .eq('customer_type_verified', false)
    .not('fortnox_customer_id', 'is', null);

  return { processed: rows.length, corrected, remaining: count ?? 0 };
}

// Search Fortnox customers live (for use in quote form, etc.)
export async function searchFortnoxCustomersLive(query: string): Promise<FortnoxCustomer[]> {
  const response = await fortnoxGet<FortnoxCustomerListResponse>('/customers', {
    filter: 'active',
    search: query,
    limit: '20',
  });
  return response.Customers ?? [];
}

type FortnoxCustomerWriteResponse = { Customer: FortnoxCustomer };

type FortnoxAddress = { street: string | null; postal_code: string | null; city: string | null } | null;

// The subset of a crm_customers row that maps to the Fortnox Customer payload.
// Defined explicitly (rather than `any`) so the field mapping stays type-checked –
// this is the exact mapping that caused the VatType/VATType field-name bug.
export type FortnoxCustomerSource = {
  customer_type: 'business' | 'private' | string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_number: string | null;
  personal_number: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  visit_address: FortnoxAddress;
  invoice_address: FortnoxAddress;
  delivery_address: FortnoxAddress;
  invoice_email: string | null;
  payment_terms: string | null;
  price_list: string | null;
  discount: number | null;
  vat_number: string | null;
  reverse_vat: boolean | null;
  fortnox_customer_id: string | null;
};

// Fields that map into the Fortnox Customer payload. Used to decide whether an
// update actually needs to be pushed to Fortnox (changes to e.g. notes/status/
// assigned_to are not relevant). personal_number is included because it maps to
// OrganisationNumber for private customers; visit_address maps to the Fortnox
// VisitingAddress register.
const FORTNOX_SCALAR_FIELDS = [
  'customer_type', 'company_name', 'first_name', 'last_name', 'organization_number',
  'personal_number', 'email', 'phone', 'mobile', 'invoice_email', 'payment_terms',
  'price_list', 'discount', 'vat_number', 'reverse_vat',
] as const;
const FORTNOX_ADDRESS_FIELDS = ['visit_address', 'invoice_address', 'delivery_address'] as const;

// True if any Fortnox-relevant field differs between two customer rows. Lets the
// update route skip a Fortnox round-trip when an edit touched no synced field.
export function fortnoxCustomerFieldsChanged(
  before: Partial<FortnoxCustomerSource> | null | undefined,
  after: Partial<FortnoxCustomerSource> | null | undefined,
): boolean {
  if (!before || !after) return true;
  for (const f of FORTNOX_SCALAR_FIELDS) {
    if ((before[f] ?? null) !== (after[f] ?? null)) return true;
  }
  for (const f of FORTNOX_ADDRESS_FIELDS) {
    if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) return true;
  }
  return false;
}

// Build the Fortnox Customer payload from a crm_customers row.
// Field names must match the Fortnox API exactly (VATType/VATNumber/TermsOfPayment).
// undefined values are omitted from the JSON body so we never overwrite Fortnox
// data with blanks on update.
export function buildFortnoxCustomerPayload(customer: FortnoxCustomerSource) {
  const isBusiness = customer.customer_type === 'business';
  const name = isBusiness
    ? (customer.company_name ?? '')
    : [customer.first_name, customer.last_name].filter(Boolean).join(' ');

  // Fortnox has no dedicated personal-number field – a private person's
  // personnummer lives in the same OrganisationNumber field as a company's org.nr.
  const organisationNumber = isBusiness
    ? customer.organization_number
    : customer.personal_number;

  return {
    Name: name || undefined,
    Type: isBusiness ? 'COMPANY' : 'PRIVATE',
    OrganisationNumber: organisationNumber ?? undefined,
    Email: customer.email ?? undefined,
    Phone1: customer.phone ?? undefined,
    Mobile: customer.mobile ?? undefined,
    Address1: customer.invoice_address?.street ?? undefined,
    ZipCode: customer.invoice_address?.postal_code ?? undefined,
    City: customer.invoice_address?.city ?? undefined,
    VisitingAddress: customer.visit_address?.street ?? undefined,
    VisitingZipCode: customer.visit_address?.postal_code ?? undefined,
    VisitingCity: customer.visit_address?.city ?? undefined,
    DeliveryAddress1: customer.delivery_address?.street ?? undefined,
    DeliveryZipCode: customer.delivery_address?.postal_code ?? undefined,
    DeliveryCity: customer.delivery_address?.city ?? undefined,
    EmailInvoice: customer.invoice_email ?? undefined,
    TermsOfPayment: customer.payment_terms ?? undefined,
    PriceList: customer.price_list ?? undefined,
    InvoiceDiscount: customer.discount ?? undefined,
    VATNumber: customer.vat_number ?? undefined,
    VATType: customer.reverse_vat ? 'SEREVERSEDVAT' : 'SEVAT',
  };
}

async function loadCustomerRow(customerId: string): Promise<FortnoxCustomerSource> {
  const supabase = getSupabaseAdmin();
  const { data: customer, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error || !customer) {
    throw new Error('Kund hittades inte i databasen');
  }
  return customer as FortnoxCustomerSource;
}

// Push a CRM customer to Fortnox. Creates the customer in Fortnox and updates
// our DB record with the returned CustomerNumber. Uses service role – approved
// use for integration writes that cannot go through the session client.
export async function createFortnoxCustomer(customerId: string): Promise<{ fortnoxCustomerNumber: string }> {
  const supabase = getSupabaseAdmin();
  const customer = await loadCustomerRow(customerId);

  const response = await fortnoxPost<FortnoxCustomerWriteResponse>('/customers', {
    Customer: buildFortnoxCustomerPayload(customer),
  });
  const fortnoxCustomerNumber = response.Customer.CustomerNumber;
  const now = new Date().toISOString();

  await supabase
    .from('crm_customers')
    .update({
      fortnox_customer_id: fortnoxCustomerNumber,
      customer_stage: 'fortnox_customer',
      sync_status: 'synced',
      last_synced_at: now,
      updated_at: now,
    })
    .eq('id', customerId);

  return { fortnoxCustomerNumber };
}

// Push updates for an already-synced CRM customer back to Fortnox.
// Requires fortnox_customer_id to be set – otherwise there is nothing to update.
// Marks sync_status as 'failed' and re-throws if Fortnox rejects the update, so
// the customer is flagged for re-sync rather than silently diverging.
export async function updateFortnoxCustomer(customerId: string): Promise<{ fortnoxCustomerNumber: string }> {
  const supabase = getSupabaseAdmin();
  const customer = await loadCustomerRow(customerId);

  const fortnoxCustomerNumber = customer.fortnox_customer_id;
  if (!fortnoxCustomerNumber) {
    throw new Error('Kunden saknar Fortnox-koppling och kan inte uppdateras i Fortnox');
  }

  const now = new Date().toISOString();
  try {
    await fortnoxPut<FortnoxCustomerWriteResponse>(`/customers/${fortnoxCustomerNumber}`, {
      Customer: buildFortnoxCustomerPayload(customer),
    });
  } catch (err) {
    await supabase
      .from('crm_customers')
      .update({ sync_status: 'failed', updated_at: now })
      .eq('id', customerId);
    throw err;
  }

  await supabase
    .from('crm_customers')
    .update({
      sync_status: 'synced',
      last_synced_at: now,
      updated_at: now,
    })
    .eq('id', customerId);

  return { fortnoxCustomerNumber };
}

// List the account's terms-of-payment register from Fortnox so sellers pick a
// valid Code instead of typing free text (Fortnox rejects unknown codes on the
// Customer endpoint). Returns [] if Fortnox returns nothing.
export async function listFortnoxTermsOfPayment(): Promise<{ code: string; description: string }[]> {
  const response = await fortnoxGet<FortnoxTermsOfPaymentListResponse>('/termsofpayments');
  return (response.TermsOfPayments ?? []).map((t) => ({ code: t.Code, description: t.Description }));
}

// List the account's price-list register from Fortnox so the customer form can
// offer valid codes instead of free text. Requires the `price` scope.
export async function listFortnoxPriceLists(): Promise<{ code: string; description: string }[]> {
  const response = await fortnoxGet<FortnoxPriceListResponse>('/pricelists');
  return (response.PriceLists ?? []).map((p) => ({ code: p.Code, description: p.Description }));
}
