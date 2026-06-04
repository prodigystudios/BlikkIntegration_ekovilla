import type { SupabaseClient } from '@supabase/supabase-js';

export const crmCallSelect = `
  id,
  prospect_id,
  customer_id,
  opportunity_id,
  company_name,
  organization_number,
  contact_name,
  phone,
  email,
  city,
  source,
  user_id,
  outcome,
  summary,
  next_step,
  call_at,
  created_at,
  prospect:crm_prospects(
    id,
    company_name,
    contact_name,
    phone,
    email,
    city,
    source,
    status
  ),
  customer:crm_customers(
    id,
    customer_stage,
    customer_type,
    company_name,
    first_name,
    last_name,
    organization_number,
    contacts:crm_customer_contacts(name, phone, email, is_primary)
  )
`;

type CreateCrmCallInput = {
  prospect_id?: string | null;
  customer_id?: string | null;
  opportunity_id?: string | null;
  company_name: string | null;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  user_id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at?: string;
};

type UpdateCrmCallInput = {
  prospect_id?: string | null;
  customer_id?: string | null;
  opportunity_id?: string | null;
  company_name: string | null;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at?: string;
};

type ListCrmCallsOptions = {
  search?: string;
  prospectId?: string;
  customerId?: string;
  opportunityId?: string;
};

export async function listCrmCalls(supabase: SupabaseClient, search?: string) {
  let query = supabase.from('crm_calls').select(crmCallSelect).order('call_at', { ascending: false }).limit(50);

  if (search) {
    query = query.or(
      `summary.ilike.%${search}%,next_step.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%`
    );
  }

  return query;
}

export async function createCrmCall(supabase: SupabaseClient, input: CreateCrmCallInput) {
  return supabase.from('crm_calls').insert(input).select(crmCallSelect).single();
}

export async function listCrmCallsWithFilters(supabase: SupabaseClient, options: ListCrmCallsOptions) {
  let query = supabase.from('crm_calls').select(crmCallSelect).order('call_at', { ascending: false }).limit(50);

  if (options.search) {
    query = query.or(
      `summary.ilike.%${options.search}%,next_step.ilike.%${options.search}%,company_name.ilike.%${options.search}%,contact_name.ilike.%${options.search}%,phone.ilike.%${options.search}%,email.ilike.%${options.search}%,city.ilike.%${options.search}%`
    );
  }

  if (options.prospectId) {
    query = query.eq('prospect_id', options.prospectId);
  }

  if (options.customerId) {
    query = query.eq('customer_id', options.customerId);
  }

  if (options.opportunityId) {
    query = query.eq('opportunity_id', options.opportunityId);
  }

  return query;
}

export async function updateCrmCall(supabase: SupabaseClient, id: string, input: UpdateCrmCallInput) {
  return supabase.from('crm_calls').update(input).eq('id', id).select(crmCallSelect).single();
}
