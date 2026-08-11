import type { SupabaseClient } from '@supabase/supabase-js';

// Referensdatan för tidrapporteringen: tidkoder, internprojekt och frånvarotyper. Tre tabeller med
// samma form, så en uppsättning funktioner betjänar alla tre — `kind` väljer tabellen.
//
// Listorna bodde i Blikk fram till fas 4 och hämtades live vid varje modalöppning. Nu är de våra
// (supabase/sql/20260811_time_reference_tables.sql), fyllda en gång från Blikk och underhållna av
// admin. `payroll_code` är den enda kolumn som betyder något för lönebyrån, och den är fritext med
// flit: ingen sats, inget belopp och ingen avtalsregel får bo i koden.

export type TimeReferenceKind = 'time_code' | 'internal_project' | 'absence_type';

export const TIME_REFERENCE_TABLES: Record<TimeReferenceKind, string> = {
  time_code: 'crm_time_codes',
  internal_project: 'crm_internal_projects',
  absence_type: 'crm_absence_types',
};

export const TIME_REFERENCE_KINDS = Object.keys(TIME_REFERENCE_TABLES) as TimeReferenceKind[];

const BASE_SELECT = 'id, code, name, payroll_code, requires_note, sort_index, is_active, blikk_id, created_at, updated_at';

// Bara tidkoder bär `billable` — Blikks övriga listor har inget sådant begrepp, och att välja en
// kolumn som inte finns är ett fel från PostgREST, inte ett tomt fält.
export function timeReferenceSelect(kind: TimeReferenceKind): string {
  return kind === 'time_code' ? `${BASE_SELECT}, billable` : BASE_SELECT;
}

export type TimeReferenceItem = {
  id: string;
  code: string | null;
  name: string;
  payroll_code: string | null;
  requires_note: boolean;
  sort_index: number;
  is_active: boolean;
  blikk_id: string | null;
  billable?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type TimeReferenceInput = {
  code?: string | null;
  name?: string;
  payroll_code?: string | null;
  requires_note?: boolean;
  sort_index?: number;
  is_active?: boolean;
  billable?: boolean | null;
};

// Formuläret ska bara visa aktiva rader; adminvyn vill se allt (annars går en inaktiverad rad inte
// att återaktivera). Sorteringen matchar indexet (is_active, sort_index, name).
export async function listTimeReference(
  supabase: SupabaseClient,
  kind: TimeReferenceKind,
  opts?: { includeInactive?: boolean },
) {
  let query = supabase
    .from(TIME_REFERENCE_TABLES[kind])
    .select(timeReferenceSelect(kind))
    .order('sort_index', { ascending: true })
    .order('name', { ascending: true });

  if (!opts?.includeInactive) query = query.eq('is_active', true);

  return query;
}

export async function createTimeReference(
  supabase: SupabaseClient,
  kind: TimeReferenceKind,
  input: TimeReferenceInput & { name: string },
) {
  return supabase
    .from(TIME_REFERENCE_TABLES[kind])
    .insert(input)
    .select(timeReferenceSelect(kind))
    .single();
}

export async function updateTimeReference(
  supabase: SupabaseClient,
  kind: TimeReferenceKind,
  id: string,
  input: TimeReferenceInput,
) {
  return supabase
    .from(TIME_REFERENCE_TABLES[kind])
    .update(input)
    .eq('id', id)
    .select(timeReferenceSelect(kind))
    .maybeSingle();
}
