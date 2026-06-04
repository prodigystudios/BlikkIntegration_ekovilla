import type { SupabaseClient } from '@supabase/supabase-js';

// Prospects är crm_customers med customer_stage = 'prospect'.
// Dessa funktioner proxar mot crm_customers och returnerar data i det gamla
// ProspectItem-formatet för bakåtkompatibilitet med befintliga API-rutter.

const prospectFromCustomerSelect = `
  id,
  company_name,
  organization_number,
  visit_address,
  source,
  notes,
  status,
  created_by,
  assigned_to,
  created_at,
  updated_at,
  contacts:crm_customer_contacts(name, phone, email, is_primary)
`;

function mapCustomerToProspect(customer: Record<string, unknown>) {
  const contacts = Array.isArray(customer.contacts) ? customer.contacts : [];
  const primary = contacts.find((c: Record<string, unknown>) => c.is_primary) || contacts[0] || null;
  const addr = customer.visit_address as Record<string, string | null> | null;
  return {
    id: customer.id,
    company_name: customer.company_name,
    organization_number: customer.organization_number,
    contact_name: primary?.name ?? null,
    phone: primary?.phone ?? null,
    email: primary?.email ?? null,
    street_address: addr?.street ?? null,
    postal_code: addr?.postal_code ?? null,
    city: addr?.city ?? null,
    source: customer.source,
    notes: customer.notes,
    status: customer.status,
    created_by: customer.created_by,
    assigned_to: customer.assigned_to,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
  };
}

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
  status?: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
};

export async function listCrmProspects(supabase: SupabaseClient, search?: string) {
  let query = supabase
    .from('crm_customers')
    .select(prospectFromCustomerSelect)
    .eq('customer_stage', 'prospect')
    .order('updated_at', { ascending: false });

  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,organization_number.ilike.%${search}%`
    );
  }

  const result = await query;
  if (result.error) return { data: null, error: result.error };
  return { data: (result.data ?? []).map(mapCustomerToProspect), error: null };
}

export async function createCrmProspect(supabase: SupabaseClient, input: CreateCrmProspectInput) {
  const visitAddress =
    input.street_address || input.postal_code || input.city
      ? { street: input.street_address ?? null, postal_code: input.postal_code ?? null, city: input.city ?? null }
      : null;

  const { data: customer, error } = await supabase
    .from('crm_customers')
    .insert({
      customer_type: 'business',
      customer_stage: 'prospect',
      company_name: input.company_name,
      organization_number: input.organization_number ?? null,
      visit_address: visitAddress,
      invoice_address: visitAddress,
      source: input.source ?? null,
      notes: input.notes ?? null,
      status: 'active',
      sync_status: 'not_synced',
      assigned_to: input.assigned_to,
      created_by: input.created_by,
    })
    .select(prospectFromCustomerSelect)
    .single();

  if (error || !customer) return { data: null, error };

  if (input.contact_name) {
    await supabase.from('crm_customer_contacts').insert({
      customer_id: customer.id,
      name: input.contact_name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      is_primary: true,
    });

    const { data: refetched } = await supabase
      .from('crm_customers')
      .select(prospectFromCustomerSelect)
      .eq('id', customer.id as string)
      .single();
    if (refetched) return { data: mapCustomerToProspect(refetched as Record<string, unknown>), error: null };
  }

  return { data: mapCustomerToProspect(customer as Record<string, unknown>), error: null };
}

export async function updateCrmProspect(supabase: SupabaseClient, id: string, input: UpdateCrmProspectInput) {
  const visitAddress =
    input.street_address || input.postal_code || input.city
      ? { street: input.street_address ?? null, postal_code: input.postal_code ?? null, city: input.city ?? null }
      : null;

  const { data: customer, error } = await supabase
    .from('crm_customers')
    .update({
      company_name: input.company_name,
      organization_number: input.organization_number ?? null,
      visit_address: visitAddress,
      invoice_address: visitAddress,
      source: input.source ?? null,
      notes: input.notes ?? null,
    })
    .eq('id', id)
    .select(prospectFromCustomerSelect)
    .single();

  if (error || !customer) return { data: null, error };
  return { data: mapCustomerToProspect(customer as Record<string, unknown>), error: null };
}
