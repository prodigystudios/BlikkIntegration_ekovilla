import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut } from './client';
import type { FortnoxCustomerListResponse, FortnoxCustomer } from './types';

type FortnoxCustomerDetailResponse = { Customer: FortnoxCustomer };

const PAGE_SIZE = 500;
const FETCH_CONCURRENCY = 10;

// Runs fn over items in serial batches of batchSize concurrent calls.
// Avoids hitting Fortnox rate limits when fetching individual customer records.
async function fetchInBatches<T, R>(
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

function mapFortnoxCustomerToRow(c: FortnoxCustomer, now: string) {
  // Type is only returned by the individual GET endpoint, not the list endpoint.
  // Default to 'private' when missing – safer than guessing from OrganisationNumber
  // since private persons can also have a personal number in that field.
  const isCompany = c.Type === 'COMPANY';
  const isPrivate = c.Type === 'PRIVATE';
  if (!isCompany && !isPrivate) {
    console.warn(`[Fortnox sync] Kund ${c.CustomerNumber} har oväntat Type-värde: "${c.Type}" → klassificeras som privat`);
  }
  return {
    customer_type: isCompany ? 'business' : 'private',
    customer_stage: 'fortnox_customer' as const,
    company_name: isCompany ? (c.Name ?? null) : null,
    first_name: !isCompany ? (c.Name?.split(' ')[0] ?? null) : null,
    last_name: !isCompany ? (c.Name?.split(' ').slice(1).join(' ') || null) : null,
    organization_number: c.OrganisationNumber ?? null,
    email: c.Email ?? null,
    phone: c.Phone1 ?? null,
    mobile: c.Mobile ?? c.Phone2 ?? null,
    visit_address: (c.Address1 || c.ZipCode || c.City)
      ? { street: c.Address1 ?? null, postal_code: c.ZipCode ?? null, city: c.City ?? null }
      : null,
    delivery_address: (c.DeliveryAddress1 || c.DeliveryZipCode || c.DeliveryCity)
      ? { street: c.DeliveryAddress1 ?? null, postal_code: c.DeliveryZipCode ?? null, city: c.DeliveryCity ?? null }
      : null,
    invoice_address: (c.Address1 || c.ZipCode || c.City)
      ? { street: c.Address1 ?? null, postal_code: c.ZipCode ?? null, city: c.City ?? null }
      : null,
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

// Fetch all customers from Fortnox and upsert into crm_customers.
// Matches on fortnox_customer_id (unique) to update existing rows.
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
      // Fetch each customer individually – the list endpoint does not return Type.
      // Batched at FETCH_CONCURRENCY to stay within Fortnox rate limits.
      const customers = await fetchInBatches(
        listCustomers,
        FETCH_CONCURRENCY,
        (c) =>
          fortnoxGet<FortnoxCustomerDetailResponse>(`/customers/${c.CustomerNumber}`)
            .then((r) => r.Customer)
            .catch((err) => {
              console.warn(`[Fortnox sync] Kunde inte hämta kund ${c.CustomerNumber} individuellt (${(err as Error)?.message ?? err}) → faller tillbaka på listdata, Type saknas`);
              return c;
            }),
      );

      // Check which fortnox_customer_ids already exist
      const ids = customers.map((c) => c.CustomerNumber);
      const { data: existing } = await supabase
        .from('crm_customers')
        .select('id, fortnox_customer_id')
        .in('fortnox_customer_id', ids);

      const existingIds = new Set((existing ?? []).map((r) => r.fortnox_customer_id));

      const toCreate = customers.filter((c) => !existingIds.has(c.CustomerNumber));
      const toUpdate = customers.filter((c) => existingIds.has(c.CustomerNumber));

      // Create new rows (assign_to = null, created_by = null – no user owns Fortnox imports)
      if (toCreate.length > 0) {
        const rows = toCreate.map((c) => ({
          ...mapFortnoxCustomerToRow(c, now),
          assigned_to: triggeredByUserId,
          created_by: triggeredByUserId,
          created_at: now,
        }));

        const { error } = await supabase.from('crm_customers').insert(rows);
        if (error) throw new Error(`Kunde inte skapa Fortnox-kunder: ${error.message}`);
        totalCreated += rows.length;
      }

      // Update existing rows with a real UPDATE per customer (matched on the
      // unique fortnox_customer_id). An upsert would treat the row as a potential
      // INSERT and fail the NOT NULL constraint on assigned_to/created_by, which
      // mapFortnoxCustomerToRow intentionally omits to preserve ownership.
      if (toUpdate.length > 0) {
        await fetchInBatches(toUpdate, FETCH_CONCURRENCY, async (c) => {
          const { error } = await supabase
            .from('crm_customers')
            .update(mapFortnoxCustomerToRow(c, now))
            .eq('fortnox_customer_id', c.CustomerNumber);
          if (error) throw new Error(`Kunde inte uppdatera Fortnox-kund ${c.CustomerNumber}: ${error.message}`);
          return null;
        });
        totalUpdated += toUpdate.length;
      }
    }

    page++;
  } while (page <= totalPages);

  return { created: totalCreated, updated: totalUpdated, pages: totalPages };
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

// Build the Fortnox Customer payload from a crm_customers row.
// Field names must match the Fortnox API exactly (VATType/VATNumber/TermsOfPayment).
// undefined values are omitted from the JSON body so we never overwrite Fortnox
// data with blanks on update.
function buildFortnoxCustomerPayload(customer: any) {
  const name =
    customer.customer_type === 'business'
      ? (customer.company_name ?? '')
      : [customer.first_name, customer.last_name].filter(Boolean).join(' ');

  return {
    Name: name || undefined,
    Type: customer.customer_type === 'business' ? 'COMPANY' : 'PRIVATE',
    OrganisationNumber: customer.organization_number ?? undefined,
    Email: customer.email ?? undefined,
    Phone1: customer.phone ?? undefined,
    Phone2: customer.mobile ?? undefined,
    Address1: customer.invoice_address?.street ?? undefined,
    ZipCode: customer.invoice_address?.postal_code ?? undefined,
    City: customer.invoice_address?.city ?? undefined,
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

async function loadCustomerRow(customerId: string) {
  const supabase = getSupabaseAdmin();
  const { data: customer, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error || !customer) {
    throw new Error('Kund hittades inte i databasen');
  }
  return customer;
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

type FortnoxTermsOfPaymentListResponse = {
  TermsOfPayments: { Code: string; Description: string }[];
};

// List the account's terms-of-payment register from Fortnox so sellers pick a
// valid Code instead of typing free text (Fortnox rejects unknown codes on the
// Customer endpoint). Returns [] if Fortnox returns nothing.
export async function listFortnoxTermsOfPayment(): Promise<{ code: string; description: string }[]> {
  const response = await fortnoxGet<FortnoxTermsOfPaymentListResponse>('/termsofpayments');
  return (response.TermsOfPayments ?? []).map((t) => ({ code: t.Code, description: t.Description }));
}

type FortnoxPriceListResponse = {
  PriceLists: { Code: string; Description: string }[];
};

// List the account's price-list register from Fortnox so the customer form can
// offer valid codes instead of free text. Requires the `price` scope.
export async function listFortnoxPriceLists(): Promise<{ code: string; description: string }[]> {
  const response = await fortnoxGet<FortnoxPriceListResponse>('/pricelists');
  return (response.PriceLists ?? []).map((p) => ({ code: p.Code, description: p.Description }));
}
