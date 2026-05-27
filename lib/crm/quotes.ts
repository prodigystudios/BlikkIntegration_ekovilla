import type { SupabaseClient } from '@supabase/supabase-js';

export const crmQuoteSelect = `
  id,
  prospect_id,
  customer_name,
  project_name,
  description,
  amount,
  currency_code,
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

type CreateCrmQuoteInput = {
  prospect_id: string | null;
  customer_name: string | null;
  project_name: string;
  description: string | null;
  amount: number;
  currency_code: string;
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