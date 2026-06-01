import type { SupabaseClient } from '@supabase/supabase-js';
import { crmProspectSelect } from './prospects';

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

export async function assignCrmProspects(supabase: SupabaseClient, prospectIds: string[], assignedTo: string | null) {
  return supabase
    .from('crm_prospects')
    .update({ assigned_to: assignedTo })
    .in('id', prospectIds)
    .select(crmProspectSelect);
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

type ExistingProspect = {
  id: string;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  created_by: string;
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
  const emails = Array.from(new Set(rows.map((row) => row.email).filter(Boolean))) as string[];
  const merged = new Map<string, ExistingProspect>();

  if (orgNumbers.length > 0) {
    const { data, error } = await supabase.from('crm_prospects').select(crmProspectSelect).in('organization_number', orgNumbers);
    if (error) return { data: null, error };
    for (const item of (data || []) as ExistingProspect[]) {
      merged.set(item.id, item);
    }
  }

  if (companyNames.length > 0) {
    const { data, error } = await supabase.from('crm_prospects').select(crmProspectSelect).in('company_name', companyNames);
    if (error) return { data: null, error };
    for (const item of (data || []) as ExistingProspect[]) {
      merged.set(item.id, item);
    }
  }

  if (emails.length > 0) {
    const { data, error } = await supabase.from('crm_prospects').select(crmProspectSelect).in('email', emails);
    if (error) return { data: null, error };
    for (const item of (data || []) as ExistingProspect[]) {
      merged.set(item.id, item);
    }
  }

  return { data: Array.from(merged.values()), error: null };
}

function findExistingProspect(row: ImportCrmProspectRow, existingItems: ExistingProspect[]) {
  const normalizedOrg = normalizeValue(row.organization_number);
  if (normalizedOrg) {
    const orgMatch = existingItems.find((item) => normalizeValue(item.organization_number) === normalizedOrg);
    if (orgMatch) return { item: orgMatch, matchReason: 'orgnummer' as const };
  }

  const normalizedCompany = normalizeValue(row.company_name);
  const normalizedEmail = normalizeValue(row.email);
  const normalizedContact = normalizeValue(row.contact_name);

  if (normalizedCompany && normalizedEmail) {
    const companyEmailMatch = existingItems.find(
      (item) => normalizeValue(item.company_name) === normalizedCompany && normalizeValue(item.email) === normalizedEmail,
    );
    if (companyEmailMatch) return { item: companyEmailMatch, matchReason: 'foretag_epost' as const };
  }

  if (normalizedCompany && normalizedContact) {
    const companyContactMatch = existingItems.find(
      (item) => normalizeValue(item.company_name) === normalizedCompany && normalizeValue(item.contact_name) === normalizedContact,
    );
    if (companyContactMatch) return { item: companyContactMatch, matchReason: 'foretag_kontakt' as const };
  }

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
  matched_on: 'orgnummer' | 'foretag_epost' | 'foretag_kontakt' | 'foretag' | null;
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
  const createdPayload: Array<(ExistingProspect & { assigned_to: string | null }) & { row_number: number }> = [];
  const updatedPayload: Array<(ExistingProspect & { assigned_to: string | null }) & { row_number: number; matched_on: ImportRowResult['matched_on'] }> = [];
  const rowResults: ImportRowResult[] = [];

  for (const row of normalizedRows) {
    const existing = findExistingProspect(row, existingItems);
    if (existing) {
      updatedPayload.push({
        ...existing.item,
        row_number: row.row_number,
        matched_on: existing.matchReason,
        company_name: row.company_name,
        organization_number: row.organization_number || existing.item.organization_number,
        contact_name: row.contact_name || existing.item.contact_name,
        phone: row.phone || existing.item.phone,
        email: row.email || existing.item.email,
        city: row.city || existing.item.city,
        source: row.source || existing.item.source || 'excel-import',
        notes: existing.item.notes || row.notes,
        assigned_to: assignedTo,
      });
      continue;
    }

    createdPayload.push({
      row_number: row.row_number,
      id: '',
      company_name: row.company_name,
      organization_number: row.organization_number,
      contact_name: row.contact_name,
      phone: row.phone,
      email: row.email,
      city: row.city,
      source: row.source || 'excel-import',
      notes: row.notes,
      status: 'new',
      created_by: currentUserId,
      assigned_to: assignedTo,
    } as (ExistingProspect & { assigned_to: string | null }) & { row_number: number });
  }

  const changedItems: ExistingProspect[] = [];

  if (createdPayload.length > 0) {
    const { data, error } = await supabase
      .from('crm_prospects')
      .insert(
        createdPayload.map((item) => ({
          company_name: item.company_name,
          organization_number: item.organization_number,
          contact_name: item.contact_name,
          phone: item.phone,
          email: item.email,
          city: item.city,
          source: item.source,
          notes: item.notes,
          status: 'new',
          created_by: currentUserId,
          assigned_to: item.assigned_to,
        })),
      )
      .select(crmProspectSelect);

    if (error) return { data: null, error };
    changedItems.push(...((data || []) as ExistingProspect[]));
    rowResults.push(
      ...createdPayload.map((item) => ({
        row_number: item.row_number,
        company_name: item.company_name,
        action: 'created' as const,
        matched_on: null,
      })),
    );
  }

  for (const item of updatedPayload) {
    const { data, error } = await supabase
      .from('crm_prospects')
      .update({
        company_name: item.company_name,
        organization_number: item.organization_number,
        contact_name: item.contact_name,
        phone: item.phone,
        email: item.email,
        city: item.city,
        source: item.source,
        notes: item.notes,
        assigned_to: item.assigned_to,
      })
      .eq('id', item.id)
      .select(crmProspectSelect)
      .single();

    if (error) return { data: null, error };
    if (data) changedItems.push(data as ExistingProspect);
    rowResults.push({
      row_number: item.row_number,
      company_name: item.company_name,
      action: 'updated',
      matched_on: item.matched_on,
    });
  }

  return {
    data: {
      created: createdPayload.length,
      updated: updatedPayload.length,
      items: changedItems,
      results: rowResults.sort((a, b) => a.row_number - b.row_number),
    },
    error: null,
  };
}