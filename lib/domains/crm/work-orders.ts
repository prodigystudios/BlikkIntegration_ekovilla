import type { SupabaseClient } from '@supabase/supabase-js';
import { crmQuoteSelect } from './quotes';
import { resolveCrmContact, type CrmContactSource } from './contacts';
import { computePricing, type PricingLineItem } from './pricing';
import { activeLineItems, computeInvoiceState } from '@/lib/domains/fortnox/partialInvoices';

export const crmWorkOrderSelect = `
  id,
  quote_id,
  prospect_id,
  customer_id,
  order_number,
  project_name,
  client_name,
  quote_type,
  customer_snapshot,
  work_address,
  pricing_summary,
  line_items,
  rot_details,
  internal_handoff,
  currency_code,
  amount,
  vat_percent,
  desired_installation_date,
  source_status,
  status,
  notes,
  fortnox_order_number,
  fortnox_order_sync_status,
  fortnox_order_synced_at,
  fortnox_invoice_number,
  fortnox_invoice_sync_status,
  fortnox_invoiced_at,
  partial_invoicing_started_at,
  created_by,
  assigned_to,
  created_at,
  updated_at,
  assignee:profiles!assigned_to(id, full_name)
`;

export const crmWorkOrderTimeEntrySelect = `
  id,
  work_order_id,
  user_id,
  work_date,
  hours,
  note,
  created_at,
  updated_at,
  user:profiles(
    id,
    full_name
  )
`;

export const crmWorkOrderCommentSelect = `
  id,
  work_order_id,
  created_by,
  body,
  created_at,
  author:profiles(
    id,
    full_name
  )
`;

export type CrmWorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';

type WorkOrderAddress = {
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  delivery_address?: string | null;
  invoice_address?: string | null;
};

type WorkOrderUpdateInput = {
  status: CrmWorkOrderStatus;
  desired_installation_date: string | null;
  notes: string | null;
  internal_handoff: Record<string, any>;
  work_address: WorkOrderAddress;
  assigned_to?: string | null;
};

type CreateWorkOrderTimeEntryInput = {
  work_order_id: string;
  user_id: string;
  work_date: string;
  hours: number;
  note: string | null;
};

type CreateWorkOrderCommentInput = {
  work_order_id: string;
  created_by: string;
  body: string;
};

type QuoteSource = {
  id: string;
  prospect_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, any> | null;
  pricing_summary: Record<string, any> | null;
  line_items: Array<Record<string, any>> | null;
  rot_details: Record<string, any> | null;
  internal_handoff: Record<string, any> | null;
  project_name: string;
  description: string | null;
  amount: number;
  currency_code: string;
  vat_percent: number;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  notes: string | null;
  created_by: string;
  assigned_to: string;
  work_order_id: string | null;
  work_order_number: string | null;
};

function buildWorkOrderNumber(seed: string) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `AO-${datePart}-${seed.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

type StandaloneWorkOrderInput = {
  customerId: string;
  projectName: string;
  desiredInstallationDate: string | null;
  actorUserId: string;
};

// Create a work order WITHOUT an originating quote (standalone order). Pulls identity
// (name, snapshot, address) from the linked customer card; articles/notes are added
// afterwards on the work order detail page. quote_id is left null.
export async function createStandaloneCrmWorkOrder(supabase: SupabaseClient, input: StandaloneWorkOrderInput) {
  const { data: customer, error: custErr } = await supabase
    .from('crm_customers')
    .select('id, customer_type, company_name, organization_number, first_name, last_name, personal_number, email, phone, mobile, visit_address, delivery_address, invoice_address, reverse_vat, contacts:crm_customer_contacts(name, phone, email, is_primary)')
    .eq('id', input.customerId)
    .maybeSingle();

  if (custErr) return { data: null, error: custErr, reason: 'customer_fetch_failed' as const };
  if (!customer) return { data: null, error: { message: 'Kunden hittades inte' }, reason: 'customer_not_found' as const };

  // Fortnox needs a private customer's personnummer (its OrganisationNumber) to invoice the
  // order. It is optional at customer-create, so enforce it here: the caller collects it and
  // saves it on the customer card before the order is created.
  if (customer.customer_type === 'private' && !customer.personal_number) {
    return { data: null, error: { message: 'Personnummer krävs för privatkund innan order kan skapas' }, reason: 'missing_personal_number' as const };
  }

  const isBusiness = customer.customer_type === 'business';
  const clientName = isBusiness
    ? (customer.company_name || 'Okänd kund')
    : ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Okänd kund');
  // Shared rule (resolveCrmContact) so a standalone order lands on the same address as an
  // order created from a quote — the card alone used to decide here.
  const contact = resolveCrmContact(customer as CrmContactSource);
  const visit = (customer.visit_address || {}) as Record<string, string | null>;

  const customerSnapshot = {
    customer_name: clientName,
    company_name: isBusiness ? (customer.company_name || null) : null,
    organization_number: isBusiness ? (customer.organization_number || null) : null,
    personal_number: !isBusiness ? (customer.personal_number || null) : null,
    contact_name: contact.name || null,
    email: contact.email || null,
    phone: contact.phone || null,
    // "Er referens" — kundens formella referens, den som hamnar på Fortnox-dokumenten och styr
    // fakturan rätt hos kunden. SKILD från contact_name ovan: det fältet är kundkontakten, alltså
    // vem vi och installatörerna ringer, och den får ändras fritt utan att röra Fortnox. På en
    // standalone-order finns ingen offert att ärva referensen från, så den seedas från samma
    // kontakt och kan sedan sättas för hand i ordervyn.
    your_reference: contact.name || null,
    street_address: visit.street || visit.street_address || null,
    postal_code: visit.postal_code || null,
    city: visit.city || null,
    delivery_address: null,
    invoice_address: null,
    // Reverse charge (omvänd skattskyldighet / byggmoms) from the customer card — drives
    // vat_percent below and the Fortnox VATType on push (see lib/domains/fortnox/helpers.ts).
    reverse_vat: customer.reverse_vat === true,
  };

  const createResult = await supabase
    .from('crm_work_orders')
    .insert({
      quote_id: null,
      customer_id: customer.id,
      order_number: buildWorkOrderNumber(globalThis.crypto.randomUUID()),
      project_name: input.projectName,
      client_name: clientName,
      quote_type: customer.customer_type,
      customer_snapshot: customerSnapshot,
      work_address: {
        street_address: customerSnapshot.street_address,
        postal_code: customerSnapshot.postal_code,
        city: customerSnapshot.city,
        delivery_address: null,
        invoice_address: null,
      },
      pricing_summary: {},
      line_items: [],
      rot_details: {},
      internal_handoff: {},
      currency_code: 'SEK',
      amount: 0,
      // 0 % for reverse-charge (byggmoms) customers, else the standard 25 %. Mirrors the quote
      // form's auto-default so a standalone order's pricing/display matches the Fortnox document.
      vat_percent: customerSnapshot.reverse_vat ? 0 : 25,
      desired_installation_date: input.desiredInstallationDate,
      status: 'draft',
      notes: null,
      created_by: input.actorUserId,
      assigned_to: input.actorUserId,
    })
    .select(crmWorkOrderSelect)
    .single();

  return { data: createResult.data, error: createResult.error, reason: createResult.error ? ('create_failed' as const) : null };
}

function getClientName(source: QuoteSource) {
  return source.customer_snapshot?.customer_name
    || source.customer_snapshot?.company_name
    || source.customer_name
    || source.project_name;
}

function getWorkAddress(source: QuoteSource) {
  const s = source.customer_snapshot;
  // A separate work address (job site) is stored on the snapshot only when a street is set
  // and it differs from the customer address (buildCustomerSnapshot enforces this). The
  // street is the anchor: when present it IS the primary address installers navigate to
  // (postal/city taken as entered, blank if the seller left them); otherwise the whole
  // address falls back to the customer address (old quotes + the private case unchanged).
  const hasWorkAddress = Boolean(s?.delivery_address);
  return {
    street_address: (hasWorkAddress ? s?.delivery_address : (s?.visit_address || s?.street_address)) || null,
    postal_code: (hasWorkAddress ? s?.delivery_postal_code : s?.postal_code) || null,
    city: (hasWorkAddress ? s?.delivery_city : s?.city) || null,
    // Primary already holds the job site when one exists, so don't duplicate it as a
    // separate "Leverans:" line. Kept null here; the work-order detail page can still set one.
    delivery_address: null,
    invoice_address: s?.invoice_address || null,
  };
}

export async function createCrmWorkOrderFromQuote(supabase: SupabaseClient, quoteId: string, actorUserId: string) {
  const quoteResult = await supabase
    .from('crm_quotes')
    .select('id, prospect_id, customer_id, customer_name, quote_type, customer_snapshot, pricing_summary, line_items, rot_details, internal_handoff, project_name, description, amount, currency_code, vat_percent, status, notes, created_by, assigned_to, work_order_id, work_order_number')
    .eq('id', quoteId)
    .single<QuoteSource>();

  if (quoteResult.error) {
    return { data: null, error: quoteResult.error, reason: quoteResult.error.code === 'PGRST116' ? 'not_found' : 'quote_fetch_failed' as const };
  }

  const quote = quoteResult.data;

  if (!quote) {
    return { data: null, error: { message: 'Offerten hittades inte' }, reason: 'not_found' as const };
  }

  if (quote.status !== 'won') {
    return { data: null, error: { message: 'Arbetsorder kan bara skapas från vunnen offert' }, reason: 'quote_not_won' as const };
  }

  if (quote.work_order_id || quote.work_order_number) {
    return { data: null, error: { message: 'Arbetsorder finns redan för offerten' }, reason: 'already_created' as const };
  }

  // Fortnox needs a private customer's personnummer to invoice the order. The quote snapshot may
  // predate it (the quote was saved before the number was known), so fall back to the customer's
  // current value and bake it into the order snapshot. If neither has it, block — the caller
  // collects it and saves it on the customer before retrying.
  // "Er referens" blir ett EGET fält på arbetsordern. På offerten är den samma sak som
  // contact_name (fältet heter "Er referens (kontaktperson)" och är obligatoriskt där), men från
  // och med ordern skiljer sig de två: contact_name blir kundkontakten — vem vi ringer — och får
  // ändras fritt, medan your_reference är det som går till Fortnox YourReference. Utan den här
  // frysningen vid orderskapandet skulle en rättad kontaktperson skriva om kundens fakturareferens.
  let orderSnapshot = (quote.customer_snapshot || {}) as Record<string, unknown>;
  if (orderSnapshot.your_reference == null) {
    orderSnapshot = { ...orderSnapshot, your_reference: orderSnapshot.contact_name ?? null };
  }
  if (quote.quote_type === 'private' && !orderSnapshot.personal_number) {
    let personalNumber: string | null = null;
    if (quote.customer_id) {
      const { data: cust } = await supabase
        .from('crm_customers').select('personal_number').eq('id', quote.customer_id).maybeSingle();
      personalNumber = (cust as { personal_number?: string | null } | null)?.personal_number ?? null;
    }
    if (!personalNumber) {
      return { data: null, error: { message: 'Personnummer krävs för privatkund innan order kan skapas' }, reason: 'missing_personal_number' as const };
    }
    orderSnapshot = { ...orderSnapshot, personal_number: personalNumber };
  }

  // ROT can only be filed with the property identified: fastighetsbeteckning for a småhus, or the
  // BRF's org.nr for a bostadsrätt (Skatteverket takes either — never both). It is deliberately
  // OPTIONAL on the quote: nothing is approved yet and the seller often doesn't have it while
  // quoting. The order is where it becomes mandatory, because the order is the point of no return —
  // the route auto-pushes to Fortnox the moment the order exists, and Fortnox has NO API field for
  // the designation (whoever finalizes the invoice types it into the husarbete dialog, reading it
  // off the text row / YourOrderNumber we send). An order created without it therefore reaches the
  // invoice with nothing to type in, and the deduction can't be filed. This is the last point where
  // a human is still in the loop.
  const rot = (quote.rot_details || {}) as { enabled?: boolean | null; property_designation?: string | null; brf_org_number?: string | null };
  if (rot.enabled === true && !rot.property_designation?.trim() && !rot.brf_org_number?.trim()) {
    return {
      data: null,
      error: { message: 'Fastighetsbeteckning (eller BRF org.nr för bostadsrätt) krävs för ROT innan order kan skapas. Öppna offerten och fyll i den.' },
      reason: 'missing_rot_property' as const,
    };
  }

  const orderNumber = buildWorkOrderNumber(quote.id);

  const createResult = await supabase
    .from('crm_work_orders')
    .insert({
      quote_id: quote.id,
      prospect_id: quote.prospect_id,
      customer_id: quote.customer_id,
      order_number: orderNumber,
      project_name: quote.project_name,
      client_name: getClientName(quote),
      quote_type: quote.quote_type,
      customer_snapshot: orderSnapshot,
      work_address: getWorkAddress(quote),
      pricing_summary: quote.pricing_summary || {},
      line_items: quote.line_items || [],
      rot_details: quote.rot_details || {},
      internal_handoff: quote.internal_handoff || {},
      currency_code: quote.currency_code || 'SEK',
      amount: quote.amount || 0,
      // ?? not || — a reverse-charge (byggmoms) quote has vat_percent 0, and `0 || 25` would
      // wrongly store 25 on the work order (the document/pricing stay 0, only the column drifts).
      vat_percent: quote.vat_percent ?? 25,
      desired_installation_date: quote.internal_handoff?.desired_installation_date || null,
      source_status: quote.status,
      status: 'draft',
      // Orderns notes = "Interna anteckningar". Seedas från offertens egna notes (annars
      // description) — ALDRIG från handoff_notes: det blocket bor redan i internal_handoff
      // (rad ovan) och skulle annars dubbleras i både "Överlämningsnotering" och "Interna
      // anteckningar" i ordervyn.
      notes: quote.notes || quote.description || null,
      created_by: actorUserId,
      assigned_to: quote.assigned_to,
    })
    .select(crmWorkOrderSelect)
    .single();

  if (createResult.error) {
    return { data: null, error: createResult.error, reason: createResult.error.code === '23505' ? 'already_created' as const : 'work_order_create_failed' as const };
  }

  const workOrder = createResult.data;

  const quoteUpdateResult = await supabase
    .from('crm_quotes')
    .update({
      work_order_id: workOrder.id,
      work_order_number: workOrder.order_number,
      converted_to_work_order_at: new Date().toISOString(),
      converted_to_work_order_by: actorUserId,
    })
    .eq('id', quote.id)
    .select(crmQuoteSelect)
    .single();

  if (quoteUpdateResult.error) {
    return { data: null, error: quoteUpdateResult.error, reason: 'quote_update_failed' as const };
  }

  return {
    data: {
      item: quoteUpdateResult.data,
      workOrder,
    },
    error: null,
    reason: null,
  };
}

// Page size for the work-order board. The list is paginated server-side (range + exact
// count) instead of an unbounded `.limit()`, so it can never silently truncate past the
// PostgREST row cap once the company accumulates orders (see SUPABASE_CONVENTIONS.md).
export const CRM_WORK_ORDERS_PAGE_SIZE = 100;

// The board's composite status filters → the concrete statuses each one covers. Mirrors the
// client's matchesFilter so server-side filtering and the chip labels agree. `all` = no status
// filter (includes cancelled, exactly like the old client-side 'all'). Kept here so the list
// query and the per-filter counts can never diverge.
export type CrmWorkOrderBoardFilter = 'all' | 'draft' | 'scheduled' | 'active' | 'completed' | 'invoiced';
export const CRM_WORK_ORDER_BOARD_FILTERS: CrmWorkOrderBoardFilter[] = ['all', 'draft', 'scheduled', 'active', 'completed', 'invoiced'];
const BOARD_FILTER_STATUSES: Record<CrmWorkOrderBoardFilter, CrmWorkOrderStatus[] | null> = {
  all: null,
  draft: ['draft'],
  scheduled: ['scheduled', 'ready'],
  active: ['in_progress'],
  // 'Fakturera' covers orders still in the invoicing stage — completed AND mid-delfakturering.
  completed: ['completed', 'partially_invoiced'],
  invoiced: ['invoiced'],
};

type WorkOrderListFilters = {
  search?: string;
  filter?: CrmWorkOrderBoardFilter;
  status?: CrmWorkOrderStatus;
  assignedToIn?: string[];
  workOrderId?: string;
  customerId?: string;
};

// Apply the shared WHERE clauses so the paginated list and the per-filter counts always use
// the exact same predicates (search, status group, assignee, deep-link, customer scope).
function applyWorkOrderListFilters<Q extends {
  or: (f: string) => Q; eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q;
}>(query: Q, options: WorkOrderListFilters): Q {
  if (options.search) {
    query = query.or(
      `order_number.ilike.%${options.search}%,project_name.ilike.%${options.search}%,client_name.ilike.%${options.search}%,notes.ilike.%${options.search}%`,
    );
  }
  const statuses = options.filter ? BOARD_FILTER_STATUSES[options.filter] : null;
  if (statuses) query = query.in('status', statuses);
  if (options.status) query = query.eq('status', options.status);
  if (options.assignedToIn && options.assignedToIn.length > 0) query = query.in('assigned_to', options.assignedToIn);
  if (options.workOrderId) query = query.eq('id', options.workOrderId);
  if (options.customerId) query = query.eq('customer_id', options.customerId);
  return query;
}

export async function listCrmWorkOrdersWithFilters(
  supabase: SupabaseClient,
  options: WorkOrderListFilters & { limit?: number; offset?: number },
) {
  const limit = options.limit ?? CRM_WORK_ORDERS_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const query = supabase
    .from('crm_work_orders')
    .select(crmWorkOrderSelect, { count: 'exact' })
    .order('desired_installation_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return applyWorkOrderListFilters(query, options);
}

// Per-filter counts for the board chips. One head-count query per filter (count-only, no rows
// transferred) so the chips stay accurate at any table size — same pattern as the customer
// stage counts. The assignee/search scope is applied so the counts match the visible list.
export async function getCrmWorkOrderFilterCounts(
  supabase: SupabaseClient,
  options: { search?: string; assignedToIn?: string[] },
): Promise<Record<CrmWorkOrderBoardFilter, number>> {
  const entries = await Promise.all(
    CRM_WORK_ORDER_BOARD_FILTERS.map(async (filter) => {
      const query = applyWorkOrderListFilters(
        supabase.from('crm_work_orders').select('id', { count: 'exact', head: true }),
        { search: options.search, filter, assignedToIn: options.assignedToIn },
      );
      const { count } = await query;
      return [filter, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CrmWorkOrderBoardFilter, number>;
}

export async function updateCrmWorkOrder(supabase: SupabaseClient, id: string, input: Partial<WorkOrderUpdateInput>) {
  return supabase.from('crm_work_orders').update(input).eq('id', id).select(crmWorkOrderSelect).single();
}

export async function getCrmWorkOrder(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_work_orders').select(crmWorkOrderSelect).eq('id', id).single();
}

// Look a work order up by the number written on the job, for the egenkontroll's order search.
//
// Accepts either reference: the Fortnox number once the order is synced (what the customer
// paperwork shows, so what gets written down) or the internal AO number before that. Fortnox first.
//
// The projection is FIXED and minimal — see the route for why this runs elevated. line_items are
// reduced to geometry: an egenkontroll needs area, thickness, density and what the row is called,
// never unit_price / discount_percent / labor_cost.
const WORK_ORDER_LOOKUP_SELECT =
  'id, order_number, fortnox_order_number, project_name, client_name, desired_installation_date, work_address, customer_snapshot, internal_handoff, line_items';

const LOOKUP_ADDRESS_KEYS = [
  'street_address', 'postal_code', 'city',
  'delivery_address', 'delivery_postal_code', 'delivery_city',
] as const;

const LOOKUP_LINE_ITEM_KEYS = [
  'construction', 'm2', 'thickness_mm', 'density', 'article_name', 'line_note', 'pricing_mode', 'quantity',
] as const;

function narrowLookupRow(row: Record<string, unknown>): Record<string, unknown> {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  const items = Array.isArray(row.line_items) ? (row.line_items as Record<string, unknown>[]) : [];
  return {
    ...row,
    customer_snapshot: Object.fromEntries(LOOKUP_ADDRESS_KEYS.map((k) => [k, snapshot[k] ?? null])),
    line_items: items.map((item) => Object.fromEntries(LOOKUP_LINE_ITEM_KEYS.map((k) => [k, item[k] ?? null]))),
  };
}

export async function lookupCrmWorkOrderByNumber(supabase: SupabaseClient, orderNumber: string) {
  const byFortnox = await supabase
    .from('crm_work_orders')
    .select(WORK_ORDER_LOOKUP_SELECT)
    .eq('fortnox_order_number', orderNumber)
    .limit(1)
    .maybeSingle();
  if (byFortnox.error) return { data: null, error: byFortnox.error };

  let row = byFortnox.data as Record<string, unknown> | null;

  if (!row) {
    const byOrderNumber = await supabase
      .from('crm_work_orders')
      .select(WORK_ORDER_LOOKUP_SELECT)
      .eq('order_number', orderNumber)
      .limit(1)
      .maybeSingle();
    if (byOrderNumber.error) return { data: null, error: byOrderNumber.error };
    row = byOrderNumber.data as Record<string, unknown> | null;
  }

  if (!row) return { data: null, error: null };

  // The day the job is actually scheduled for — the egenkontroll dates itself from this rather
  // than from the order's desired date, which goes stale as soon as the planner moves the job.
  // Earliest segment that has not finished; falls back to the most recent one for past jobs.
  const { data: segment } = await supabase
    .from('ops_segments')
    .select('start_day')
    .eq('work_order_id', row.id as string)
    .order('start_day', { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    data: { ...narrowLookupRow(row), scheduled_day: (segment as { start_day?: string } | null)?.start_day ?? null },
    error: null,
  };
}

// Redact a work order down to what the field view needs.
//
// Since the crew RLS policy (20260810_crm_work_order_crew_access.sql) an installer can read their
// own work order — which is the point — but RLS is ROW level and cannot narrow columns, and
// crmWorkOrderSelect carries things a person on a roof has no business receiving. Two of them are
// personal data: customer_snapshot.personal_number and rot_details.personal_number (both written
// by quoteSerializers for ROT jobs). This is where the column-level line is drawn instead.
//
// KEPT: order refs, names, status, dates, work address, internal handoff, and line_items —
// article rows including prices, a deliberate decision (the field view's article tab shows them).
// DROPPED: personnummer, pricing_summary, amount — nothing in the field view renders them.
// rot_details is reduced to the three fields computePricing actually reads.
export function redactWorkOrderForField<T extends Record<string, unknown>>(row: T): T {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  const rot = (row.rot_details ?? {}) as Record<string, unknown>;

  const {
    pricing_summary: _pricingSummary,
    amount: _amount,
    ...rest
  } = row as Record<string, unknown>;

  return {
    ...rest,
    // Contact details only — the field view reads phone/email/contact_name and nothing else.
    customer_snapshot: {
      contact_name: snapshot.contact_name ?? null,
      email: snapshot.email ?? null,
      phone: snapshot.phone ?? null,
    },
    // Enough for the ROT line in the article tab's totals; no personnummer, no property designation.
    rot_details: {
      enabled: rot.enabled ?? false,
      rot_percent: rot.rot_percent ?? null,
      max_deduction: rot.max_deduction ?? null,
    },
  } as unknown as T;
}

// Invoice rounds (delfakturering) for a work order, oldest round first. Each row records the
// Fortnox invoice number + the per-line quantities billed that round; the app owns this state
// because Fortnox can't report per-article invoiced quantity back. Returns [] when none.
export async function listWorkOrderInvoiceRounds(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_invoices')
    .select('id, round_number, fortnox_invoice_number, fortnox_sync_status, amount, line_quantities, created_at')
    .eq('work_order_id', workOrderId)
    .order('round_number', { ascending: true });
}

// Resolve just the customer contact (name/phone/email) for a work order. Pass an ADMIN
// client: the field view (installers/member) needs to know who to call but has no CRM
// read access to the full customer record — this exposes only the three contact fields.
// Returns { data: null } when the work order has no linked customer.
export async function getWorkOrderCustomerContact(supabase: SupabaseClient, workOrderId: string) {
  const { data: wo, error: woError } = await supabase
    .from('crm_work_orders').select('customer_id, customer_snapshot').eq('id', workOrderId).maybeSingle();
  if (woError) return { data: null, error: woError };

  // A separate on-site contact (slutkund, captured outside the customer card) is who the
  // installer should reach at the job site — prefer it over the customer-card contact. Works
  // even for a standalone order with no linked customer.
  const snap = (wo?.customer_snapshot ?? null) as
    { end_contact_name?: string | null; end_contact_phone?: string | null; end_contact_email?: string | null } | null;
  if (snap && (snap.end_contact_name?.trim() || snap.end_contact_phone?.trim() || snap.end_contact_email?.trim())) {
    return {
      data: {
        contactName: snap.end_contact_name || null,
        phone: snap.end_contact_phone || null,
        email: snap.end_contact_email || null,
        isOnSiteContact: true,
      },
      error: null,
    };
  }

  if (!wo?.customer_id) return { data: null, error: null };

  const { data: c, error } = await supabase
    .from('crm_customers')
    .select('phone, mobile, email, contacts:crm_customer_contacts(name, phone, email, is_primary)')
    .eq('id', wo.customer_id)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!c) return { data: null, error: null };

  // Shared rule (resolveCrmContact): the named contact person wins, the card fills the gaps.
  // This used to read the card first, which meant a customer with both could get the offer at
  // one address and the order confirmation at another.
  const contact = resolveCrmContact(c as CrmContactSource);
  return {
    data: {
      contactName: contact.name || null,
      phone: contact.phone || null,
      email: contact.email || null,
      isOnSiteContact: false,
    },
    error: null,
  };
}

// Replace the work order's article rows + recomputed totals. Pricing is computed by the
// caller (shared computePricing) so DB, UI and the Fortnox order stay consistent.
export async function updateCrmWorkOrderLineItems(
  supabase: SupabaseClient,
  id: string,
  lineItems: Array<Record<string, any>>,
  pricing: { subtotal: number; vat: number; total: number },
) {
  return supabase
    .from('crm_work_orders')
    .update({
      line_items: lineItems,
      pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
      amount: pricing.total,
    })
    .eq('id', id)
    .select(crmWorkOrderSelect)
    .single();
}

// Avskriv (eller återställ) EN artikelrad på en arbetsorder — raden som såldes men aldrig utfördes.
//
// Raden RADERAS INTE. Varje delfakturarunda lagrar sina antal som {index, quantity} mot arrayindex
// i den frysta snapshoten; att ta bort en rad skulle förskjuta indexen och tyst peka om en redan
// utställd fakturas antal till fel artikel. Flaggan sätts därför på plats, och sätts på BÅDA
// listorna (live + snapshot) så att beräkningen av återstående — som alltid mäts mot snapshoten —
// ser samma sanning som ordervyn. De två är indexparallella: snapshoten är en kopia av line_items
// vid första rundan, och redigering har varit låst sedan dess.
//
// Effekten: radens återstående blir 0, ordersumman räknas om utan den, och Fortnox-ordern
// uppdateras av anroparen. Är allt fakturerat efteråt stängs ordern.
export async function writeOffWorkOrderLineItem(
  supabase: SupabaseClient,
  workOrderId: string,
  index: number,
  writtenOff: boolean,
) {
  const { data, error } = await supabase
    .from('crm_work_orders')
    .select('id, status, vat_percent, quote_type, rot_details, line_items, line_items_invoicing_snapshot, fortnox_invoice_number')
    .eq('id', workOrderId)
    .maybeSingle();

  if (error) return { data: null, error, reason: 'fetch_failed' as const };
  if (!data) return { data: null, error: { message: 'Arbetsordern hittades inte' }, reason: 'not_found' as const };

  const wo = data as {
    status: string;
    vat_percent: number | null;
    quote_type: string | null;
    rot_details: Record<string, unknown> | null;
    line_items: Array<Record<string, any>> | null;
    line_items_invoicing_snapshot: Array<Record<string, any>> | null;
    fortnox_invoice_number: string | null;
  };

  const lineItems = wo.line_items ?? [];
  if (index >= lineItems.length) {
    return { data: null, error: { message: 'Raden finns inte på arbetsordern' }, reason: 'line_not_found' as const };
  }

  // En färdigfakturerad order är avslutad — då finns inget kvar att skriva av, och att ändra
  // summan efter sista fakturan skulle bara få CRM och bokföringen att säga olika saker.
  if (wo.status === 'invoiced' || wo.fortnox_invoice_number) {
    return { data: null, error: { message: 'Ordern är färdigfakturerad och kan inte ändras.' }, reason: 'order_closed' as const };
  }

  // Redan fakturerat antal går inte att skriva av: fakturan är utställd, pengarna är krävda.
  // Delvis fakturerad rad likaså — det som återstår kan inte "inte utföras" utan att resten
  // också omprövas, och den bedömningen ska en människa göra i Fortnox, inte vi här.
  const { data: rounds } = await supabase
    .from('crm_work_order_invoices')
    .select('line_quantities')
    .eq('work_order_id', workOrderId);
  const invoicedOnLine = (rounds ?? []).reduce((sum, round) => {
    const match = ((round as { line_quantities: Array<{ index: number; quantity: number }> | null }).line_quantities ?? [])
      .find((q) => q.index === index);
    return sum + (match ? Math.max(0, match.quantity) : 0);
  }, 0);
  if (writtenOff && invoicedOnLine > 0) {
    return {
      data: null,
      error: { message: 'Raden är redan fakturerad och kan inte skrivas av.' },
      reason: 'already_invoiced' as const,
    };
  }

  const applyFlag = (items: Array<Record<string, any>> | null) =>
    (items ?? []).map((item, i) => (i === index ? { ...item, written_off: writtenOff } : item));

  const nextLineItems = applyFlag(lineItems);
  // Snapshoten finns bara när delfakturering har startat.
  const nextSnapshot = wo.line_items_invoicing_snapshot ? applyFlag(wo.line_items_invoicing_snapshot) : null;

  // Summan räknas om på de rader som fortfarande gäller, så ordervärdet följer det som levereras.
  const pricing = computePricing(activeLineItems(nextLineItems) as PricingLineItem[], wo.vat_percent, {
    isPrivate: wo.quote_type === 'private',
    rot: (wo.rot_details ?? null) as any,
  });

  // Stäng ordern när avskrivningen gör att inget återstår att fakturera — men BARA om systemet
  // fortfarande äger statusen. Har någon medvetet satt den till ett arbetsläge (ordern rullar
  // vidare) ska vi inte stampa över det; då sätter de den själva när jobbet är klart.
  const stateAfter = computeInvoiceState(nextSnapshot ?? nextLineItems, (rounds ?? []) as any);
  const nothingLeft = (rounds ?? []).length > 0 && stateAfter.every((s) => s.remaining <= 0);
  const closes = nothingLeft && wo.status === 'partially_invoiced';

  return supabase
    .from('crm_work_orders')
    .update({
      line_items: nextLineItems,
      ...(nextSnapshot ? { line_items_invoicing_snapshot: nextSnapshot } : {}),
      pricing_summary: { subtotal: pricing.subtotal, vat: pricing.vat, total: pricing.total },
      amount: pricing.total,
      ...(closes ? { status: 'invoiced', fortnox_invoiced_at: new Date().toISOString() } : {}),
    })
    .eq('id', workOrderId)
    .select(crmWorkOrderSelect)
    .single()
    .then((res) => ({ data: res.data, error: res.error, reason: res.error ? ('update_failed' as const) : null }));
}

// Tabellen heter `crm_time_entries` sedan fas 4 (20260811_time_entries_reshape.sql). Namnbytet är
// inte kosmetiskt: raden bär numera även frånvaro och interntid, som per definition inte har någon
// arbetsorder, och den är löneunderlag. Funktionerna här är kontorets arbetsordervy — de filtrerar
// alltid på en order och rör aldrig de andra sorterna.
export async function listCrmWorkOrderTimeEntries(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_time_entries')
    .select(crmWorkOrderTimeEntrySelect)
    .eq('work_order_id', workOrderId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderTimeEntry(supabase: SupabaseClient, input: CreateWorkOrderTimeEntryInput) {
  // `kind` är NOT NULL sedan omformningen och CHECK:en binder den till vilket mål som är ifyllt.
  // Den här vägen skapar per definition arbetsordertid, så den sätts här i stället för att läggas
  // på anroparen — kontorsfliken vet inget om diskriminatorn.
  return supabase
    .from('crm_time_entries')
    .insert({ ...input, kind: 'work_order' })
    .select(crmWorkOrderTimeEntrySelect)
    .single();
}

export async function listCrmWorkOrderComments(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('crm_work_order_comments')
    .select(crmWorkOrderCommentSelect)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export async function createCrmWorkOrderComment(supabase: SupabaseClient, input: CreateWorkOrderCommentInput) {
  return supabase.from('crm_work_order_comments').insert(input).select(crmWorkOrderCommentSelect).single();
}

// Edit/delete are owner-scoped (user_id / created_by) so a person can only change their
// own time rows and comments. A non-owner's id simply matches no row.
export async function updateCrmWorkOrderTimeEntry(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  input: { work_date: string; hours: number; note: string | null },
) {
  return supabase
    .from('crm_time_entries')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select(crmWorkOrderTimeEntrySelect)
    .maybeSingle();
}

export async function deleteCrmWorkOrderTimeEntry(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_time_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
}

export async function updateCrmWorkOrderComment(supabase: SupabaseClient, id: string, userId: string, body: string) {
  return supabase
    .from('crm_work_order_comments')
    .update({ body })
    .eq('id', id)
    .eq('created_by', userId)
    .select(crmWorkOrderCommentSelect)
    .maybeSingle();
}

// Profiles that can be @-mentioned in work order comments. Returns everyone with a
// name (installers included), not just CRM-assignable roles. Reads across all users,
// so it needs the admin client (session RLS limits profiles to the requester's own row).
export async function listMentionableProfiles(supabase: SupabaseClient) {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .not('full_name', 'is', null)
    .order('full_name', { ascending: true });
}

export async function deleteCrmWorkOrderComment(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_work_order_comments')
    .delete()
    .eq('id', id)
    .eq('created_by', userId)
    .select('id')
    .maybeSingle();
}