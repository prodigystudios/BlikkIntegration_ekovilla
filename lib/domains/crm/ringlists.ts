import type { SupabaseClient } from '@supabase/supabase-js';
import { createCrmProspect } from './prospects';

export type AssignableCrmUser = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'konsult';
};

export async function listAssignableCrmUsers(supabase: SupabaseClient) {
  return supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['sales', 'admin', 'konsult'])
    .order('full_name', { ascending: true });
}

const assignProspectSelect = 'id, company_name, organization_number, assigned_to, source, notes, created_at, updated_at';

export async function assignCrmProspects(supabase: SupabaseClient, prospectIds: string[], assignedTo: string | null) {
  return supabase
    .from('crm_customers')
    .update({ assigned_to: assignedTo })
    .in('id', prospectIds)
    .eq('customer_stage', 'prospect')
    .select(assignProspectSelect);
}

type ImportCrmProspectRow = {
  row_number: number;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
};

type ExistingCustomerProspect = {
  id: string;
  company_name: string;
  organization_number: string | null;
  source: string | null;
  notes: string | null;
  assigned_to: string | null;
};

function normalizeValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeImportRow(row: ImportCrmProspectRow): ImportCrmProspectRow {
  return {
    row_number: row.row_number,
    company_name: row.company_name.trim(),
    organization_number: row.organization_number?.trim() || null,
    contact_name: row.contact_name?.trim() || null,
    phone: row.phone?.trim() || null,
    email: row.email?.trim() || null,
    city: row.city?.trim() || null,
    source: row.source?.trim() || null,
    notes: row.notes?.trim() || null,
  };
}

async function listExistingProspectsForImport(supabase: SupabaseClient, rows: ImportCrmProspectRow[]) {
  const orgNumbers = Array.from(new Set(rows.map((row) => row.organization_number).filter(Boolean))) as string[];
  const companyNames = Array.from(new Set(rows.map((row) => row.company_name.trim()).filter(Boolean)));
  const merged = new Map<string, ExistingCustomerProspect>();

  const existingSelect = 'id, company_name, organization_number, source, notes, assigned_to';

  if (orgNumbers.length > 0) {
    const { data, error } = await supabase
      .from('crm_customers')
      .select(existingSelect)
      .eq('customer_stage', 'prospect')
      .in('organization_number', orgNumbers);
    if (error) return { data: null, error };
    for (const item of (data || []) as ExistingCustomerProspect[]) {
      merged.set(item.id, item);
    }
  }

  if (companyNames.length > 0) {
    const { data, error } = await supabase
      .from('crm_customers')
      .select(existingSelect)
      .eq('customer_stage', 'prospect')
      .in('company_name', companyNames);
    if (error) return { data: null, error };
    for (const item of (data || []) as ExistingCustomerProspect[]) {
      merged.set(item.id, item);
    }
  }

  return { data: Array.from(merged.values()), error: null };
}

function findExistingProspect(row: ImportCrmProspectRow, existingItems: ExistingCustomerProspect[]) {
  const normalizedOrg = normalizeValue(row.organization_number);
  if (normalizedOrg) {
    const orgMatch = existingItems.find((item) => normalizeValue(item.organization_number) === normalizedOrg);
    if (orgMatch) return { item: orgMatch, matchReason: 'orgnummer' as const };
  }

  const normalizedCompany = normalizeValue(row.company_name);
  if (normalizedCompany) {
    const companyMatch = existingItems.find((item) => normalizeValue(item.company_name) === normalizedCompany) || null;
    if (companyMatch) return { item: companyMatch, matchReason: 'foretag' as const };
  }

  return null;
}

type ImportRowResult = {
  row_number: number;
  company_name: string;
  action: 'created' | 'updated';
  matched_on: 'orgnummer' | 'foretag' | null;
};

export async function importCrmProspects(
  supabase: SupabaseClient,
  rows: ImportCrmProspectRow[],
  currentUserId: string,
  assignedTo: string | null,
) {
  const normalizedRows = rows.map(normalizeImportRow).filter((row) => row.company_name.length > 0);
  if (normalizedRows.length === 0) {
    return { data: { created: 0, updated: 0, items: [] }, error: null };
  }

  const existingResult = await listExistingProspectsForImport(supabase, normalizedRows);
  if (existingResult.error) {
    return { data: null, error: existingResult.error };
  }

  const existingItems = existingResult.data || [];
  const toCreate: Array<ImportCrmProspectRow & { row_number: number }> = [];
  const toUpdate: Array<{ row: ImportCrmProspectRow; existing: ExistingCustomerProspect; matchReason: 'orgnummer' | 'foretag' }> = [];
  const rowResults: ImportRowResult[] = [];

  for (const row of normalizedRows) {
    const existing = findExistingProspect(row, existingItems);
    if (existing) {
      toUpdate.push({ row, existing: existing.item, matchReason: existing.matchReason });
    } else {
      toCreate.push(row);
    }
  }

  const createdItems: ExistingCustomerProspect[] = [];
  const updatedItems: ExistingCustomerProspect[] = [];

  for (const row of toCreate) {
    const { data, error } = await createCrmProspect(supabase, {
      company_name: row.company_name,
      organization_number: row.organization_number,
      contact_name: row.contact_name,
      phone: row.phone,
      email: row.email,
      city: row.city,
      source: row.source || 'excel-import',
      notes: row.notes,
      created_by: currentUserId,
      assigned_to: assignedTo ?? currentUserId,
      status: 'new',
    });

    if (error) return { data: null, error };
    if (data) {
      createdItems.push({
        id: data.id as string,
        company_name: data.company_name as string,
        organization_number: data.organization_number as string | null,
        source: data.source as string | null,
        notes: data.notes as string | null,
        assigned_to: data.assigned_to as string | null,
      });
    }
    rowResults.push({ row_number: row.row_number, company_name: row.company_name, action: 'created', matched_on: null });
  }

  for (const { row, existing, matchReason } of toUpdate) {
    const visitAddress =
      row.city
        ? { street: null, postal_code: null, city: row.city }
        : undefined;

    const { data, error } = await supabase
      .from('crm_customers')
      .update({
        company_name: row.company_name,
        organization_number: row.organization_number || existing.organization_number,
        ...(visitAddress ? { visit_address: visitAddress, invoice_address: visitAddress } : {}),
        source: row.source || existing.source || 'excel-import',
        notes: existing.notes || row.notes,
        assigned_to: assignedTo,
      })
      .eq('id', existing.id)
      .select('id, company_name, organization_number, source, notes, assigned_to')
      .single();

    if (error) return { data: null, error };
    if (data) updatedItems.push(data as ExistingCustomerProspect);
    rowResults.push({ row_number: row.row_number, company_name: row.company_name, action: 'updated', matched_on: matchReason });
  }

  return {
    data: {
      created: toCreate.length,
      updated: toUpdate.length,
      items: [...createdItems, ...updatedItems],
      results: rowResults.sort((a, b) => a.row_number - b.row_number),
    },
    error: null,
  };
}
