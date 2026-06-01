import type { SupabaseClient } from '@supabase/supabase-js';
import { createCrmProspect } from './prospects';

export const crmAiProspectSuggestionSelect =
  'id, company_name, organization_number, contact_name, phone, email, city, website, source, rationale, notes, status, created_by, reviewed_by, approved_prospect_id, review_note, reviewed_at, created_at, updated_at, approved_prospect:crm_prospects(id, company_name)';

type SuggestionStatus = 'pending' | 'approved' | 'rejected';

type ApprovedProspectRow = {
  id: string;
  company_name: string;
};

type CrmAiProspectSuggestionRow = {
  id: string;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  website: string | null;
  source: string | null;
  rationale: string | null;
  notes: string | null;
  status: SuggestionStatus;
  created_by: string;
  reviewed_by: string | null;
  approved_prospect_id: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  approved_prospect: ApprovedProspectRow | ApprovedProspectRow[] | null;
};

export type CrmAiProspectSuggestion = Omit<CrmAiProspectSuggestionRow, 'approved_prospect'> & {
  approved_prospect: ApprovedProspectRow | null;
};

type ListCrmAiProspectSuggestionsArgs = {
  search?: string;
  status?: SuggestionStatus | 'all';
};

type CreateCrmAiProspectSuggestionInput = {
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  website: string | null;
  source: string | null;
  rationale: string | null;
  notes: string | null;
  created_by: string;
};

type ReviewCrmAiProspectSuggestionInput = {
  status: 'approved' | 'rejected';
  reviewed_by: string;
  review_note: string | null;
  reviewed_at: string;
  approved_prospect_id?: string | null;
};

function getApprovedProspect(value: CrmAiProspectSuggestionRow['approved_prospect']) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export function mapCrmAiProspectSuggestionRow(
  row: CrmAiProspectSuggestionRow,
): CrmAiProspectSuggestion {
  return {
    ...row,
    approved_prospect: getApprovedProspect(row.approved_prospect),
  };
}

export function mapCrmAiProspectSuggestionRows(rows: CrmAiProspectSuggestionRow[] | null | undefined) {
  return (rows || []).map(mapCrmAiProspectSuggestionRow);
}

export async function listCrmAiProspectSuggestions(
  supabase: SupabaseClient,
  args: ListCrmAiProspectSuggestionsArgs,
) {
  let query = supabase
    .from('crm_ai_prospect_suggestions')
    .select(crmAiProspectSuggestionSelect)
    .order('created_at', { ascending: false });

  if (args.status && args.status !== 'all') {
    query = query.eq('status', args.status);
  }

  if (args.search) {
    query = query.or(
      `company_name.ilike.%${args.search}%,contact_name.ilike.%${args.search}%,email.ilike.%${args.search}%,city.ilike.%${args.search}%,organization_number.ilike.%${args.search}%,website.ilike.%${args.search}%`,
    );
  }

  return query;
}

export async function createCrmAiProspectSuggestion(
  supabase: SupabaseClient,
  input: CreateCrmAiProspectSuggestionInput,
) {
  return supabase
    .from('crm_ai_prospect_suggestions')
    .insert({
      ...input,
      status: 'pending',
    })
    .select(crmAiProspectSuggestionSelect)
    .single();
}

export async function getCrmAiProspectSuggestion(supabase: SupabaseClient, id: string) {
  return supabase
    .from('crm_ai_prospect_suggestions')
    .select(crmAiProspectSuggestionSelect)
    .eq('id', id)
    .single();
}

export async function reviewCrmAiProspectSuggestion(
  supabase: SupabaseClient,
  id: string,
  input: ReviewCrmAiProspectSuggestionInput,
) {
  return supabase
    .from('crm_ai_prospect_suggestions')
    .update({
      status: input.status,
      reviewed_by: input.reviewed_by,
      review_note: input.review_note,
      reviewed_at: input.reviewed_at,
      approved_prospect_id: input.approved_prospect_id ?? null,
    })
    .eq('id', id)
    .select(crmAiProspectSuggestionSelect)
    .single();
}

function compactText(parts: Array<string | null | undefined>) {
  return parts
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n\n') || null;
}

export async function approveCrmAiProspectSuggestion(
  supabase: SupabaseClient,
  suggestion: CrmAiProspectSuggestion,
  currentUserId: string,
) {
  const notes = compactText([
    suggestion.rationale ? `Motivering: ${suggestion.rationale}` : null,
    suggestion.notes,
  ]);

  return createCrmProspect(supabase, {
    company_name: suggestion.company_name,
    organization_number: suggestion.organization_number,
    contact_name: suggestion.contact_name,
    phone: suggestion.phone,
    email: suggestion.email,
    city: suggestion.city,
    source: suggestion.source || 'AI Prospekt',
    notes,
    created_by: currentUserId,
    assigned_to: currentUserId,
    status: 'new',
  });
}