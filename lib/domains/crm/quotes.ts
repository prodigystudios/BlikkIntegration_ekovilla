import type { SupabaseClient } from '@supabase/supabase-js';
import { convertProspectToCustomer } from './customers';

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

export type UpdateCrmQuoteInput = Omit<CreateCrmQuoteInput, 'created_by' | 'assigned_to'>;

type ListCrmQuotesOptions = {
  search?: string;
  status?: CrmQuoteStatus;
  prospectId?: string;
  customerId?: string;
};

export async function listCrmQuotesWithFilters(supabase: SupabaseClient, options: ListCrmQuotesOptions) {
  let query = supabase
    .from('crm_quotes')
    .select(crmQuoteSelect)
    .order('status', { ascending: true })
    .order('follow_up_date', { ascending: true, nullsFirst: false })
    .order('quote_date', { ascending: false })
    .limit(100);

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
    .select('id, status, prospect_id')
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
 * Handles the 'won' status transition for a quote.
 *
 * Separates the orchestration from the HTTP layer: if the quote has a prospect_id
 * and is not yet won, the prospect is converted to a customer before the quote is
 * updated. The two operations are sequential without a true DB transaction — if the
 * quote update fails after conversion, the error message identifies the partial state
 * so it can be reconciled manually.
 */
export async function markCrmQuoteWon(
  supabase: SupabaseClient,
  quoteId: string,
  assignedTo: string,
  createdBy: string,
  updateInput: Partial<UpdateCrmQuoteInput>
): Promise<WonResult> {
  const { data: current, error: fetchError } = await getCrmQuoteStatus(supabase, quoteId);
  if (fetchError || !current) {
    return { data: null, error: { code: 'crm_quote_not_found', message: fetchError?.message ?? 'Offert hittades inte' } };
  }

  // Already won, or no prospect to convert — just update
  if (current.status === 'won' || !current.prospect_id) {
    const { data, error } = await updateCrmQuote(supabase, quoteId, updateInput);
    if (error) return { data: null, error: { code: 'crm_quote_update_failed', message: error.message } };
    return { data, error: null };
  }

  // Transitioning to 'won' with a prospect: convert first
  const { customerId, error: conversionError } = await convertProspectToCustomer(
    supabase,
    current.prospect_id,
    assignedTo,
    createdBy
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

  return { data, error: null };
}