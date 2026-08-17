import type { SupabaseClient } from '@supabase/supabase-js';
import { convertProspectToCustomer, setAccountManagerIfUnset } from './customers';

export const crmQuoteSelect = `
  id,
  quote_number,
  prospect_id,
  customer_id,
  customer_name,
  quote_type,
  customer_source,
  customer_snapshot,
  pricing_summary,
  line_items,
  rot_details,
  internal_handoff,
  project_name,
  description,
  amount,
  currency_code,
  vat_percent,
  valid_until,
  work_order_id,
  work_order_number,
  converted_to_work_order_at,
  fortnox_offer_number,
  fortnox_sync_status,
  fortnox_synced_at,
  status,
  quote_date,
  follow_up_date,
  notes,
  created_by,
  assigned_to,
  created_at,
  updated_at,
  prospect:crm_customers!prospect_id(
    id,
    company_name,
    customer_stage
  )
`;

type CrmQuoteStatus = 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
type CrmQuoteType = 'private' | 'business';

type CustomerSource = {
  kind?: 'prospect' | 'local' | 'fortnox' | null;
  sync_intent?: 'local_only' | 'on_work_order' | 'linked' | null;
  fortnox_customer_id?: string | null;
  fortnox_customer_name?: string | null;
};

type CustomerSnapshot = {
  customer_name?: string | null;
  company_name?: string | null;
  organization_number?: string | null;
  personal_number?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  visit_address?: string | null;
  // Work address (where the job is performed): delivery_address = street line,
  // plus structured postal/city. Only set when it differs from the customer address.
  delivery_address?: string | null;
  delivery_postal_code?: string | null;
  delivery_city?: string | null;
  invoice_address?: string | null;
};

type PricingSummary = {
  subtotal?: number;
  vat?: number;
  total?: number;
};

type QuoteLineItem = {
  id: string;
  construction?: 'vagg' | 'snedtak' | 'vind' | '';
  m2?: string;
  thickness_mm?: string;
  auto_price?: boolean;
  unit_price?: string;
  pricing_mode?: 'm3' | 'item';
  quantity?: string;
  article_id?: string | null;
  article_name?: string | null;
  article_number?: string | null;
  article_price?: number | null;
  article_unit_name?: string | null;
  discount_percent?: string;
  line_note?: string;
};

type RotDetails = {
  enabled?: boolean;
  applicant_name?: string | null;
  personal_number?: string | null;
  property_designation?: string | null;
  rot_percent?: number;
};

type InternalHandoff = {
  desired_installation_date?: string | null;
  handoff_notes?: string | null;
  work_scope?: string | null;
};

type CreateCrmQuoteInput = {
  prospect_id: string | null;
  customer_id?: string | null;
  customer_name: string | null;
  quote_type: CrmQuoteType;
  customer_source: CustomerSource;
  customer_snapshot: CustomerSnapshot;
  pricing_summary: PricingSummary;
  line_items: QuoteLineItem[];
  rot_details: RotDetails;
  internal_handoff: InternalHandoff;
  project_name: string;
  description: string | null;
  amount: number;
  currency_code: string;
  vat_percent: number;
  valid_until: string | null;
  status: CrmQuoteStatus;
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  created_by: string;
  assigned_to: string;
};

// created_by är oföränderligt (vem som skrev offerten är ett historiskt faktum), men
// assigned_to går att ändra: ansvarig säljare kan lämnas över, t.ex. när en chef gör
// offerten åt en säljare. Vem som FÅR göra det avgörs i rutten (crm.admin) — kolumnen
// öppnas här bara typmässigt.
export type UpdateCrmQuoteInput = Omit<CreateCrmQuoteInput, 'created_by'>;

// Sort orders, named after the leading key. Default is the offer list's working order: open
// statuses first (status sorts draft → follow_up → lost → sent → won), then the nearest
// follow-up. 'updated_desc' is for callers that want the most recently touched quotes — the
// default sort would hand them drafts and lost quotes first and truncate won/sent ones at the
// row cap, since the cap cuts server-side before the browser can reorder anything.
export type CrmQuoteSort = 'status_asc' | 'updated_desc';

type ListCrmQuotesOptions = {
  search?: string;
  status?: CrmQuoteStatus;
  prospectId?: string;
  customerId?: string;
  limit?: number;
  sort?: CrmQuoteSort;
};

export async function listCrmQuotesWithFilters(supabase: SupabaseClient, options: ListCrmQuotesOptions) {
  const selected = supabase.from('crm_quotes').select(crmQuoteSelect);
  let query = (options.sort === 'updated_desc'
    ? selected.order('updated_at', { ascending: false })
    : selected
      .order('status', { ascending: true })
      .order('follow_up_date', { ascending: true, nullsFirst: false })
      .order('quote_date', { ascending: false })
  ).limit(options.limit ?? 100);

  if (options.search) {
    query = query.or(
      `project_name.ilike.%${options.search}%,customer_name.ilike.%${options.search}%,description.ilike.%${options.search}%,notes.ilike.%${options.search}%`
    );
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.prospectId) {
    query = query.eq('prospect_id', options.prospectId);
  }

  if (options.customerId) {
    query = query.eq('customer_id', options.customerId);
  }

  return query;
}

export async function getCrmQuote(supabase: SupabaseClient, id: string) {
  return supabase
    .from('crm_quotes')
    .select(crmQuoteSelect)
    .eq('id', id)
    .single();
}

export async function getCrmQuoteStatus(supabase: SupabaseClient, id: string) {
  return supabase
    .from('crm_quotes')
    .select('id, status, prospect_id, customer_id, assigned_to')
    .eq('id', id)
    .single();
}

export async function createCrmQuote(supabase: SupabaseClient, input: CreateCrmQuoteInput) {
  return supabase.from('crm_quotes').insert(input).select(crmQuoteSelect).single();
}

export async function updateCrmQuote(supabase: SupabaseClient, id: string, input: Partial<UpdateCrmQuoteInput>) {
  return supabase.from('crm_quotes').update(input).eq('id', id).select(crmQuoteSelect).single();
}

type WonResult = { data: unknown; error: { code: string; message: string } | null };

/**
 * Låter offertens ansvariga säljare bli kundansvarig när offerten vinns.
 *
 * Best-effort med flit: att offerten blir vunnen är den viktiga händelsen, och den ska inte
 * falla på att kundansvarig inte gick att sätta. Fyller bara ett TOMT fält — se
 * setAccountManagerIfUnset för varför övertagande inte sker tyst.
 *
 * Kundraden: prospekt och kund är samma rad i crm_customers (convertProspectToCustomer flippar
 * bara customer_stage), så prospect_id duger som kund-id när customer_id ännu inte hunnit sättas.
 */
async function applyQuoteAssigneeAsAccountManager(
  supabase: SupabaseClient,
  quoteId: string,
  customerId: string | null,
  sellerId: string | null
) {
  if (!customerId || !sellerId) return;
  const { error } = await setAccountManagerIfUnset(supabase, customerId, sellerId);
  if (error) {
    console.error(
      `[markCrmQuoteWon] Offert ${quoteId} vanns men kundansvarig kunde inte sättas på kund ${customerId}: ${error}`
    );
  }
}

/**
 * Handles the 'won' status transition for a quote.
 *
 * Separates the orchestration from the HTTP layer: if the quote has a prospect_id
 * and is not yet won, the prospect is converted to a customer before the quote is
 * updated. The two operations are sequential without a true DB transaction — if the
 * quote update fails after conversion, the error message identifies the partial state
 * so it can be reconciled manually.
 *
 * Efter en lyckad uppdatering får kunden offertens ansvariga som kundansvarig (om den saknas).
 */
export async function markCrmQuoteWon(
  supabase: SupabaseClient,
  quoteId: string,
  actorUserId: string,
  updateInput: Partial<UpdateCrmQuoteInput>
): Promise<WonResult> {
  const { data: current, error: fetchError } = await getCrmQuoteStatus(supabase, quoteId);
  if (fetchError || !current) {
    return { data: null, error: { code: 'crm_quote_not_found', message: fetchError?.message ?? 'Offert hittades inte' } };
  }

  // Ansvarig kan bytas i SAMMA sparning som offerten vinns — chefen sätter säljaren och
  // markerar vunnen på en gång. Den inkommande ändringen måste därför vinna över den sparade
  // raden, annars ärver kunden den ansvariga som just byttes bort.
  const effectiveAssignee = updateInput.assigned_to ?? current.assigned_to ?? null;

  // Already won, or no prospect to convert — just update
  if (current.status === 'won' || !current.prospect_id) {
    const { data, error } = await updateCrmQuote(supabase, quoteId, updateInput);
    // Preserve PGRST116 (0 rows) so the route can answer 403/404 for a non-owner instead of a
    // raw 500 (RLS scopes the UPDATE to the owner while SELECT is open) — mirrors the plain path.
    if (error) return { data: null, error: { code: error.code === 'PGRST116' ? 'PGRST116' : 'crm_quote_update_failed', message: error.message } };
    // Bara vid ÖVERGÅNGEN till vunnen, inte vid varje sparning av en redan vunnen offert.
    // Att medvetet sätta kundansvarig till "— Ingen —" på kundkortet är ett uttryckt val, och
    // en refill vid nästa beröring av offerten hade tagit tillbaka det utan att någon bad om det.
    if (current.status !== 'won') {
      await applyQuoteAssigneeAsAccountManager(
        supabase,
        quoteId,
        current.customer_id ?? current.prospect_id ?? null,
        effectiveAssignee
      );
    }
    return { data, error: null };
  }

  // Transitioning to 'won' with a prospect: convert first
  const { customerId, error: conversionError } = await convertProspectToCustomer(
    supabase,
    current.prospect_id,
    actorUserId,
    actorUserId
  );

  if (conversionError || !customerId) {
    return { data: null, error: { code: 'crm_customer_conversion_failed', message: conversionError ?? 'Konvertering misslyckades' } };
  }

  // Link the quote to the freshly-created customer — otherwise customer_id stays null and
  // the work order created from this quote (and its installer contact) has no customer.
  const { data, error: updateError } = await updateCrmQuote(supabase, quoteId, { ...updateInput, customer_id: customerId });
  if (updateError) {
    // Conversion succeeded but quote update failed — partial state, needs manual reconciliation
    console.error(
      `[markCrmQuoteWon] Quote ${quoteId} update failed after prospect ${current.prospect_id} was converted to customer ${customerId}.`
    );
    return {
      data: null,
      error: {
        code: 'crm_quote_update_after_conversion_failed',
        message: `Prospektet konverterades men offertuppdateringen misslyckades: ${updateError.message}`,
      },
    };
  }

  await applyQuoteAssigneeAsAccountManager(supabase, quoteId, customerId, effectiveAssignee);

  return { data, error: null };
}