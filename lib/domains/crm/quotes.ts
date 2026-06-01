import type { SupabaseClient } from '@supabase/supabase-js';

export const crmQuoteSelect = `
  id,
  prospect_id,
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
  status,
  quote_date,
  follow_up_date,
  notes,
  created_by,
  assigned_to,
  created_at,
  updated_at,
  prospect:crm_prospects(
    id,
    company_name,
    contact_name,
    city,
    status
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
  delivery_address?: string | null;
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

type UpdateCrmQuoteInput = Omit<CreateCrmQuoteInput, 'created_by' | 'assigned_to'>;

type ListCrmQuotesOptions = {
  search?: string;
  status?: CrmQuoteStatus;
  prospectId?: string;
};

function getProspectStatusFromQuoteStatus(status: CrmQuoteStatus) {
  switch (status) {
    case 'sent':
    case 'follow_up':
      return 'quoted' as const;
    case 'won':
      return 'won' as const;
    case 'lost':
      return 'lost' as const;
    default:
      return null;
  }
}

async function syncProspectStatusFromQuote(supabase: SupabaseClient, prospectId: string | null, status: CrmQuoteStatus) {
  const nextStatus = getProspectStatusFromQuoteStatus(status);

  if (!prospectId || !nextStatus) return;

  await supabase.from('crm_prospects').update({ status: nextStatus }).eq('id', prospectId);
}

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
      `project_name.ilike.%${options.search}%,customer_name.ilike.%${options.search}%,description.ilike.%${options.search}%,notes.ilike.%${options.search}%,crm_prospects.company_name.ilike.%${options.search}%`
    );
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.prospectId) {
    query = query.eq('prospect_id', options.prospectId);
  }

  return query;
}

export async function createCrmQuote(supabase: SupabaseClient, input: CreateCrmQuoteInput) {
  const result = await supabase.from('crm_quotes').insert(input).select(crmQuoteSelect).single();

  if (!result.error) {
    await syncProspectStatusFromQuote(supabase, input.prospect_id, input.status);
  }

  return result;
}

export async function updateCrmQuote(supabase: SupabaseClient, id: string, input: UpdateCrmQuoteInput) {
  const result = await supabase.from('crm_quotes').update(input).eq('id', id).select(crmQuoteSelect).single();

  if (!result.error) {
    await syncProspectStatusFromQuote(supabase, input.prospect_id, input.status);
  }

  return result;
}