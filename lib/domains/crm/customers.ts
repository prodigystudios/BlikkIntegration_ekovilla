import type { SupabaseClient } from '@supabase/supabase-js';

export type CrmCustomerType = 'business' | 'private';
export type CrmCustomerStatus = 'active' | 'inactive' | 'churned';
export type CrmCustomerSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';
export type CrmCustomerStage = 'prospect' | 'customer' | 'fortnox_customer';

export type CrmAddress = {
  street: string | null;
  postal_code: string | null;
  city: string | null;
};

export const crmCustomerSelect = `
  id,
  customer_type,
  customer_stage,
  company_name,
  organization_number,
  first_name,
  last_name,
  personal_number,
  email,
  phone,
  mobile,
  visit_address,
  delivery_address,
  invoice_address,
  invoice_email,
  payment_terms,
  price_list,
  discount,
  vat_number,
  reverse_vat,
  fortnox_customer_id,
  sync_status,
  last_synced_at,
  status,
  source,
  notes,
  assigned_to,
  created_by,
  created_at,
  updated_at,
  contacts:crm_customer_contacts(
    id,
    name,
    role,
    phone,
    email,
    is_primary
  )
`;

const crmCustomerSearchSelect = `
  id,
  customer_type,
  customer_stage,
  company_name,
  first_name,
  last_name,
  organization_number,
  visit_address,
  contacts:crm_customer_contacts(name, phone, email, is_primary)
`;

export type CreateCrmCustomerInput = {
  customer_type: CrmCustomerType;
  customer_stage?: CrmCustomerStage;
  company_name?: string | null;
  organization_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  personal_number?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  visit_address?: CrmAddress | null;
  delivery_address?: CrmAddress | null;
  invoice_address?: CrmAddress | null;
  invoice_email?: string | null;
  payment_terms?: string | null;
  price_list?: string | null;
  discount?: number | null;
  vat_number?: string | null;
  reverse_vat?: boolean;
  fortnox_customer_id?: string | null;
  sync_status?: CrmCustomerSyncStatus;
  source?: string | null;
  notes?: string | null;
  assigned_to: string;
  created_by: string;
};

export type UpdateCrmCustomerInput = {
  customer_type?: CrmCustomerType;
  customer_stage?: CrmCustomerStage;
  company_name?: string | null;
  organization_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  personal_number?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  visit_address?: CrmAddress | null;
  delivery_address?: CrmAddress | null;
  invoice_address?: CrmAddress | null;
  invoice_email?: string | null;
  payment_terms?: string | null;
  price_list?: string | null;
  discount?: number | null;
  vat_number?: string | null;
  reverse_vat?: boolean;
  fortnox_customer_id?: string | null;
  sync_status?: CrmCustomerSyncStatus;
  last_synced_at?: string | null;
  status?: CrmCustomerStatus;
  source?: string | null;
  notes?: string | null;
  assigned_to?: string;
};

export type CreateCrmCustomerContactInput = {
  customer_id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean;
};

export type UpdateCrmCustomerContactInput = {
  name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean;
};

type ListCrmCustomersOptions = {
  search?: string;
  status?: CrmCustomerStatus;
  stage?: CrmCustomerStage;
  assignedTo?: string;
};

export async function listCrmCustomers(supabase: SupabaseClient, options: ListCrmCustomersOptions = {}) {
  let query = supabase
    .from('crm_customers')
    .select(crmCustomerSelect)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (options.search) {
    query = query.or(
      `company_name.ilike.%${options.search}%,first_name.ilike.%${options.search}%,last_name.ilike.%${options.search}%,organization_number.ilike.%${options.search}%`
    );
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.stage) {
    query = query.eq('customer_stage', options.stage);
  }

  if (options.assignedTo) {
    query = query.eq('assigned_to', options.assignedTo);
  }

  return query;
}

export async function searchCrmCustomers(supabase: SupabaseClient, query: string) {
  return supabase
    .from('crm_customers')
    .select(crmCustomerSearchSelect)
    .or(
      `company_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,organization_number.ilike.%${query}%`
    )
    .order('updated_at', { ascending: false })
    .limit(10);
}

export async function getCrmCustomer(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_customers').select(crmCustomerSelect).eq('id', id).single();
}

export async function createCrmCustomer(supabase: SupabaseClient, input: CreateCrmCustomerInput) {
  return supabase.from('crm_customers').insert(input).select(crmCustomerSelect).single();
}

export async function updateCrmCustomer(supabase: SupabaseClient, id: string, input: UpdateCrmCustomerInput) {
  return supabase.from('crm_customers').update(input).eq('id', id).select(crmCustomerSelect).single();
}

export async function createCrmCustomerContact(supabase: SupabaseClient, input: CreateCrmCustomerContactInput) {
  return supabase.from('crm_customer_contacts').insert(input).select('id, name, role, phone, email, is_primary').single();
}

export async function updateCrmCustomerContact(
  supabase: SupabaseClient,
  id: string,
  input: UpdateCrmCustomerContactInput
) {
  return supabase
    .from('crm_customer_contacts')
    .update(input)
    .eq('id', id)
    .select('id, name, role, phone, email, is_primary')
    .single();
}

export async function deleteCrmCustomerContact(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_customer_contacts').delete().eq('id', id);
}

export async function convertProspectToCustomer(
  supabase: SupabaseClient,
  prospectId: string,
  _assignedTo: string,
  _createdBy: string
): Promise<{ customerId: string | null; error: string | null }> {
  const { data: customer, error } = await supabase
    .from('crm_customers')
    .select('id, customer_stage')
    .eq('id', prospectId)
    .maybeSingle();

  if (error) {
    return { customerId: null, error: error.message };
  }

  if (!customer) {
    return { customerId: null, error: 'Prospekt hittades inte' };
  }

  if (customer.customer_stage !== 'prospect') {
    return { customerId: customer.id, error: null };
  }

  const { data: updated, error: updateError } = await supabase
    .from('crm_customers')
    .update({ customer_stage: 'customer', status: 'active' })
    .eq('id', prospectId)
    .select('id')
    .single();

  if (updateError || !updated) {
    return { customerId: null, error: updateError?.message || 'Kunde inte konvertera prospekt' };
  }

  return { customerId: updated.id, error: null };
}

export function getCrmCustomerDisplayName(customer: {
  customer_type: CrmCustomerType;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (customer.customer_type === 'business') {
    return customer.company_name ?? 'Okänt företag';
  }
  const parts = [customer.first_name, customer.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}
