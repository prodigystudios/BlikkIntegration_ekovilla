import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, fortnoxPut } from './client';
import type {
  FortnoxCustomerListResponse,
  FortnoxCustomer,
  FortnoxCustomerListItem,
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
// Hur långt före förra synken ändrade kunder köas för kortpasset. Fortnox filtrerar `lastmodified` på svensk tid med
// minutprecision; marginalen täcker minutavrundningen, klockskillnad mot Fortnox och timmen som går två gånger när
// sommartiden slutar. Den kostar bara att några kort hämtas en gång till.
const CHANGED_SINCE_MARGIN_MS = 2 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fortnox `lastmodified` för kundlistan: tidpunkten i SVENSK tid, "YYYY-MM-DD HH:MM". Uppmätt mot testbolaget
 * 2026-10-21: en kund ändrad 11:37 svensk tid (09:37 UTC) kom med för "11:36" men inte för "11:38", och appens
 * `+`-kodade mellanslag tolkas som `%20`. Zonen är explicit — processen kör i UTC på Vercel.
 */
export function fortnoxLastModifiedParam(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Från när ändrade kunder ska köas för kortpasset — eller null: ingen känd förra synk, köa alla. */
export function customersChangedSince(lastSyncedAt: string | null | undefined): Date | null {
  if (!lastSyncedAt) return null;
  const at = new Date(lastSyncedAt).getTime();
  return Number.isNaN(at) ? null : new Date(at - CHANGED_SINCE_MARGIN_MS);
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
  // Kunder som den här synken köade för kortpasset (nya + ändrade i Fortnox).
  queued: number;
  // Alla som väntar på kortpasset efteråt, även köade av en tidigare synk.
  pendingCards: number;
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

// Samma konvention som kundformuläret (`trim() || null`): tom sträng och blanksteg betyder "inget värde". Kortet
// svarar "" för tomma fält (TermsOfPayment, EmailInvoice, VATNumber …); sparat rakt av hade "" mött formulärets null
// och fortnoxCustomerFieldsChanged sett en ändring som inte finns.
function blankToNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

// En adress ur Fortnox med samma regel per del. buildFortnoxAddress själv lämnas orörd — offertflödet använder den också.
function fortnoxAddress(street: string | null | undefined, postalCode: string | null | undefined, city: string | null | undefined) {
  return buildFortnoxAddress(blankToNull(street), blankToNull(postalCode), blankToNull(city));
}

// Namn och org.nr/personnummer — samma två fält i listan och på kortet. Guards the identity constraint: a
// single-word/empty Fortnox Name must never produce an all-null-identity row.
function fortnoxIdentityColumns(
  c: Pick<FortnoxCustomerListItem, 'CustomerNumber' | 'Name' | 'OrganisationNumber'>,
  resolvedType: 'business' | 'private',
) {
  const isCompany = resolvedType === 'business';
  const name = splitSwedishName(c.Name);
  // Fortnox always has a Name, but stay defensive: fall back to a stable label so
  // company_name / first_name can never both be null (constraint violation).
  const fallbackName = (c.Name ?? '').trim() || `Fortnox-kund ${c.CustomerNumber}`;
  const orgOrPersonalNumber = blankToNull(c.OrganisationNumber);
  return {
    customer_type: resolvedType,
    company_name: isCompany ? fallbackName : null,
    first_name: isCompany ? null : (name.first ?? fallbackName),
    last_name: isCompany ? null : name.last,
    // OrganisationNumber holds a company's org.nr or a private person's personnummer.
    organization_number: isCompany ? orgOrPersonalNumber : null,
    personal_number: isCompany ? null : orgOrPersonalNumber,
  };
}

function fortnoxImportMetadata(customerNumber: string, now: string) {
  return {
    customer_stage: 'fortnox_customer' as const,
    fortnox_customer_id: customerNumber,
    sync_status: 'synced' as const,
    last_synced_at: now,
    status: 'active' as const,
    source: 'fortnox_import',
    updated_at: now,
  };
}

/**
 * Raden ur Fortnox kundlista: BARA kolumnerna listan bär (FortnoxCustomerListItem). Används av massynken, både för nya
 * kunder och för omsynken av dem vi redan har.
 *
 * 🧨 Omvänd moms, betalningsvillkor, prislista, rabatt, momsnummer, fakturamejl, mobil, besöks- och leveransadress
 * finns bara på kortet och skrivs bara av kortpasset (verifyCustomerTypesBatch). Att de UTELÄMNAS här är hela poängen:
 * en utelämnad kolumn rör inte det vi har, en null skriver över den. Före 2026-10-21 lästes listan som ett kort, och
 * varje omsynk satte `reverse_vat=false` och null på alla de fälten för samtliga kunder.
 */
export function buildFortnoxListCustomerRow(
  c: FortnoxCustomerListItem,
  resolvedType: 'business' | 'private',
  now: string,
) {
  return {
    ...fortnoxIdentityColumns(c, resolvedType),
    email: blankToNull(c.Email),
    // Listan kallar fältet Phone; det är kortets Phone1.
    phone: blankToNull(c.Phone),
    invoice_address: fortnoxAddress(c.Address1, c.ZipCode, c.City),
    ...fortnoxImportMetadata(c.CustomerNumber, now),
  };
}

// Maps a Fortnox customer CARD (GET /customers/{nr}) onto a crm_customers row. `resolvedType` is Fortnox's
// authoritative Type, and `verified` records that it is.
function mapFortnoxCustomerToRow(
  c: FortnoxCustomer,
  resolvedType: 'business' | 'private',
  verified: boolean,
  now: string,
) {
  return {
    ...fortnoxIdentityColumns(c, resolvedType),
    customer_type_verified: verified,
    email: blankToNull(c.Email),
    phone: blankToNull(c.Phone1),
    mobile: blankToNull(c.Mobile) ?? blankToNull(c.Phone2),
    visit_address: fortnoxAddress(c.VisitingAddress, c.VisitingZipCode, c.VisitingCity),
    delivery_address: fortnoxAddress(c.DeliveryAddress1, c.DeliveryZipCode, c.DeliveryCity),
    invoice_address: fortnoxAddress(c.Address1, c.ZipCode, c.City),
    invoice_email: blankToNull(c.EmailInvoice),
    payment_terms: blankToNull(c.TermsOfPayment),
    price_list: blankToNull(c.PriceList),
    discount: c.InvoiceDiscount ?? null,
    vat_number: blankToNull(c.VATNumber),
    reverse_vat: c.VATType === 'SEREVERSEDVAT',
    ...fortnoxImportMetadata(c.CustomerNumber, now),
  };
}

/**
 * Raden kortpasset skriver för en kund vi redan har. Skiljer sig från `mapFortnoxCustomerToRow` på en enda punkt: ett
 * tomt momsnummer från Fortnox utelämnas i stället för att skrivas som null.
 *
 * 🧨 Momsnumret härleds numera på VÅR sida ur org.numret (SE + tio siffror + 01, se
 * lib/domains/crm/orgNumber.ts) — och Fortnox saknar det för de allra flesta kunder. Ett kortpass
 * som skrev tomheten rakt av hade nollställt varje härlett nummer igen och tyst rullat tillbaka hela
 * backfillen i 20260902_crm_customers_backfill_vat_number.sql (587 länkade rader).
 *
 * ⚖️ Har Fortnox ett värde vinner det fortfarande — Fortnox äger fältet. Det är bara TOMHETEN
 * som slutar räknas som ett besked, för den betyder "vi vet inte", inte "det finns inget".
 */
export function buildFortnoxCustomerUpdateRow(
  c: FortnoxCustomer,
  resolvedType: 'business' | 'private',
  verified: boolean,
  now: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = mapFortnoxCustomerToRow(c, resolvedType, verified, now);
  if (row.vat_number === null) delete row.vat_number;
  return row;
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

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// När förra massynken startade (fortnox_integrations.customers_synced_at). Ett läsfel — t.ex. koden före migreringen —
// blir "okänt", vilket köar alla kunder: det kostar bara tid i kortpasset, inga data.
async function readCustomersSyncedAt(supabase: SupabaseAdmin): Promise<string | null> {
  const { data, error } = await supabase
    .from('fortnox_integrations')
    .select('customers_synced_at')
    .eq('provider', 'fortnox')
    .maybeSingle();
  if (error) {
    console.warn(`[Fortnox sync] Förra synkens tidpunkt gick inte att läsa (${error.message}) → köar alla kunder`);
    return null;
  }
  return data?.customers_synced_at ?? null;
}

async function saveCustomersSyncedAt(supabase: SupabaseAdmin, at: string): Promise<void> {
  const { error } = await supabase
    .from('fortnox_integrations')
    .update({ customers_synced_at: at })
    .eq('provider', 'fortnox');
  if (error) {
    console.warn(`[Fortnox sync] Synkens tidpunkt sparades inte (${error.message}) → nästa synk köar från förra tidpunkten`);
  }
}

// Kundnumren Fortnox ändrat sedan `since`, ur listan filtrerad på lastmodified.
async function listFortnoxCustomerNumbersChangedSince(since: Date): Promise<Set<string>> {
  const numbers = new Set<string>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fortnoxGet<FortnoxCustomerListResponse>('/customers', {
      lastmodified: fortnoxLastModifiedParam(since),
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    for (const c of response.Customers ?? []) numbers.add(c.CustomerNumber);
    totalPages = response.MetaInformation?.['@TotalPages'] ?? 1;
    page++;
  } while (page <= totalPages);
  return numbers;
}

async function countPendingCards(supabase: SupabaseAdmin): Promise<number> {
  const { count } = await supabase
    .from('crm_customers')
    .select('id', { count: 'exact', head: true })
    .eq('customer_type_verified', false)
    .not('fortnox_customer_id', 'is', null);
  return count ?? 0;
}

// Fetch all customers from Fortnox and upsert into crm_customers.
// Matches on fortnox_customer_id (unique) to update existing rows.
//
// The list endpoint returns only ten fields (FortnoxCustomerListItem) – no Type, so
// company-vs-private is decided by inferCustomerType() heuristic for a new row, and
// none of the card-only fields, so those are never written here
// (buildFortnoxListCustomerRow). We deliberately do NOT fetch each customer
// individually here – that fan-out (one GET per customer) blew past Fortnox's rate
// limit on real-size registers (thousands of customers → mass 429s → every row
// mis-classified as private).
//
// Instead the sync QUEUES customers for the card pass (customer_type_verified=false),
// and verifyCustomerTypesBatch() reads their cards afterwards, throttled: every new
// customer, and every customer Fortnox has changed since the previous sync
// (`lastmodified`). With no known previous sync – the first run, or after Fortnox was
// disconnected – every customer is queued, which is also what repairs the card fields
// the pre-2026-10-21 re-syncs wiped.
export async function syncFortnoxCustomers(triggeredByUserId: string): Promise<CustomerSyncResult> {
  const supabase = getSupabaseAdmin();
  let page = 1;
  let totalPages = 1;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalQueued = 0;
  // A queued customer whose UPDATE failed was not queued. Saving the timestamp would then lose
  // its change for good, so the next sync must look back from the previous timestamp again.
  let queueFailed = false;
  const now = new Date().toISOString();

  // Read before the list: a customer changed in Fortnox while this sync runs is picked up next time.
  const changedSince = customersChangedSince(await readCustomersSyncedAt(supabase));
  const changed = changedSince ? await listFortnoxCustomerNumbersChangedSince(changedSince) : null;

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
        .select('id, fortnox_customer_id, customer_type')
        .in('fortnox_customer_id', ids);

      const existingById = new Map((existing ?? []).map((r) => [r.fortnox_customer_id, r]));

      const toCreate = listCustomers.filter((c) => !existingById.has(c.CustomerNumber));
      const toUpdate = listCustomers.filter((c) => existingById.has(c.CustomerNumber));

      // Create new rows. Heuristic Type (the list has no VAT number to fall back on),
      // unverified until the card pass runs – which also fills the card-only fields.
      if (toCreate.length > 0) {
        const rows = toCreate.map((c) => ({
          ...buildFortnoxListCustomerRow(c, inferCustomerType(c.OrganisationNumber, null), now),
          customer_type_verified: false,
          assigned_to: triggeredByUserId,
          created_by: triggeredByUserId,
          created_at: now,
        }));
        const inserted = await insertCustomersResilient(supabase, rows);
        totalCreated += inserted;
        totalQueued += inserted;
      }

      // Update existing rows. An upsert would clobber assigned_to/created_by
      // ownership, so we UPDATE per customer (matched on unique fortnox_customer_id).
      // An existing row keeps its Type: the card pass owns it. Guessing again here
      // would regress a verified Type the moment the row is queued (unverified) and
      // re-synced before the card pass has run.
      if (toUpdate.length > 0) {
        await runInBatches(toUpdate, DB_CONCURRENCY, async (c) => {
          const prev = existingById.get(c.CustomerNumber)!;
          const type: 'business' | 'private' = prev.customer_type === 'business' ? 'business' : 'private';
          const queue = changed === null || changed.has(c.CustomerNumber);
          const row = buildFortnoxListCustomerRow(c, type, now);
          const { error } = await supabase
            .from('crm_customers')
            .update(queue ? { ...row, customer_type_verified: false } : row)
            .eq('fortnox_customer_id', c.CustomerNumber);
          if (error) {
            console.warn(`[Fortnox sync] Kunde inte uppdatera kund ${c.CustomerNumber} (${error.message})`);
            if (queue) queueFailed = true;
          } else if (queue) {
            totalQueued++;
          }
          return null;
        });
        totalUpdated += toUpdate.length;
      }
    }

    page++;
  } while (page <= totalPages);

  if (!queueFailed) await saveCustomersSyncedAt(supabase, now);

  return {
    created: totalCreated,
    updated: totalUpdated,
    pages: totalPages,
    queued: totalQueued,
    pendingCards: await countPendingCards(supabase),
  };
}

export type VerifyTypesResult = {
  processed: number;
  corrected: number;
  remaining: number;
};

// Confirm customer_type for rows imported via heuristic (customer_type_verified=false)
// by fetching each customer's card from Fortnox, throttled to stay under the rate
// limit. The card is also the only source of the fields the list lacks (reverse VAT,
// terms of payment, price list …), so this pass is what fills them.
// Resumable: processes one batch per call and reports how many still remain, so a
// UI/cron can loop until remaining === 0.
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
        .update(buildFortnoxCustomerUpdateRow(c, realType, true, now))
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

  return { processed: rows.length, corrected, remaining: await countPendingCards(supabase) };
}

/**
 * Kundkortets prislista i Fortnox (`PriceList`), läst direkt ur kortet. Portalens egna prislistor (återförsäljarportalen,
 * 10b) läser den här och inte `crm_customers.price_list`: Fortnox lista över kunder saknar fältet (uppmätt 2026-10-21),
 * så kolumnen fylls bara av kortpasset och är så färsk som det senast körda passet. Ett tomt fält ger null.
 */
export async function getFortnoxCustomerPriceList(customerNumber: string): Promise<string | null> {
  const detail = await fortnoxGet<FortnoxCustomerDetailResponse>(`/customers/${encodeURIComponent(customerNumber)}`);
  return blankToNull(detail.Customer?.PriceList);
}

// Search Fortnox customers live (for use in quote form, etc.)
export async function searchFortnoxCustomersLive(query: string): Promise<FortnoxCustomerListItem[]> {
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
    // Fortnox Customer har inget Mobile-fält (POST/PUT ger 400 "Felaktigt fältnamn (Mobile)",
    // kod 2001399). Mobil lagras i Phone2 – symmetriskt med importen som läser c.Phone2 → mobile.
    Phone2: customer.mobile ?? undefined,
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
