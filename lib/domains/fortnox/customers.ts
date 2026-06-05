import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet } from './client';
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
    visit_address: (c.Address1 || c.ZipCode || c.City)
      ? { street: c.Address1 ?? null, postal_code: c.ZipCode ?? null, city: c.City ?? null }
      : null,
    invoice_address: (c.Address1 || c.ZipCode || c.City)
      ? { street: c.Address1 ?? null, postal_code: c.ZipCode ?? null, city: c.City ?? null }
      : null,
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

      // Update existing rows in one bulk upsert.
      // mapFortnoxCustomerToRow does not include assigned_to/created_by so those are preserved.
      if (toUpdate.length > 0) {
        const rows = toUpdate.map((c) => mapFortnoxCustomerToRow(c, now));
        const { error } = await supabase
          .from('crm_customers')
          .upsert(rows, { onConflict: 'fortnox_customer_id' });
        if (error) throw new Error(`Kunde inte uppdatera Fortnox-kunder: ${error.message}`);
        totalUpdated += rows.length;
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
