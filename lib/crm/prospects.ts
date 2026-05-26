import type { SupabaseClient } from '@supabase/supabase-js';

export const crmProspectSelect =
  'id, company_name, organization_number, contact_name, phone, email, street_address, postal_code, city, status, source, notes, created_by, assigned_to, created_at, updated_at';

type CreateCrmProspectInput = {
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  created_by: string;
  assigned_to: string;
  status: 'new';
};

export async function listCrmProspects(supabase: SupabaseClient, search?: string) {
  let query = supabase.from('crm_prospects').select(crmProspectSelect).order('updated_at', { ascending: false });

  if (search) {
    query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%`);
  }

  return query;
}

export async function createCrmProspect(supabase: SupabaseClient, input: CreateCrmProspectInput) {
  return supabase.from('crm_prospects').insert(input).select(crmProspectSelect).single();
}

type UpdateCrmProspectInput = {
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
};

export async function updateCrmProspect(supabase: SupabaseClient, id: string, input: UpdateCrmProspectInput) {
  return supabase.from('crm_prospects').update(input).eq('id', id).select(crmProspectSelect).single();
}