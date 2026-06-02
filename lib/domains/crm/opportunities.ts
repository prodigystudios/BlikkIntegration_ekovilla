import type { SupabaseClient } from '@supabase/supabase-js';

export type CrmOpportunityStatus = 'qualified' | 'quoted' | 'won' | 'lost';

export const crmOpportunitySelect = `
  id,
  prospect_id,
  title,
  status,
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
    source
  )
`;

type CreateCrmOpportunityInput = {
  prospect_id: string | null;
  title: string;
  status: CrmOpportunityStatus;
  notes: string | null;
  created_by: string;
  assigned_to: string;
};

type UpdateCrmOpportunityInput = {
  prospect_id: string | null;
  title: string;
  status: CrmOpportunityStatus;
  notes: string | null;
};

type ListCrmOpportunitiesOptions = {
  search?: string;
  status?: CrmOpportunityStatus;
  prospectId?: string;
};

export async function listCrmOpportunities(supabase: SupabaseClient, options: ListCrmOpportunitiesOptions = {}) {
  let query = supabase
    .from('crm_opportunities')
    .select(crmOpportunitySelect)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (options.search) {
    query = query.or(
      `title.ilike.%${options.search}%,notes.ilike.%${options.search}%,crm_prospects.company_name.ilike.%${options.search}%`
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

export async function createCrmOpportunity(supabase: SupabaseClient, input: CreateCrmOpportunityInput) {
  return supabase.from('crm_opportunities').insert(input).select(crmOpportunitySelect).single();
}

export async function updateCrmOpportunity(supabase: SupabaseClient, id: string, input: UpdateCrmOpportunityInput) {
  return supabase.from('crm_opportunities').update(input).eq('id', id).select(crmOpportunitySelect).single();
}

export async function getCrmOpportunity(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_opportunities').select(crmOpportunitySelect).eq('id', id).single();
}
