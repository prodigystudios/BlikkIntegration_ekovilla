import type { SupabaseClient } from '@supabase/supabase-js';

// Planning job types + their card colour. Admin-editable (ops_job_types); ops_segments.job_type
// stores the stable `key`. The runtime list is fetched from the DB; DEFAULT_JOB_TYPES is both the
// seed set and the fallback before the list loads. Pure helpers are unit-tested.

export type JobType = { key: string; label: string; color: string };
export type JobTypeRow = JobType & { id: string; sort_index: number; active: boolean };

export const DEFAULT_JOB_TYPES: JobType[] = [
  { key: 'ekovilla', label: 'Ekovilla', color: '#059669' }, // emerald
  { key: 'vitull', label: 'Vitull', color: '#0284c7' }, // sky
  { key: 'leverans', label: 'Leverans', color: '#0d9488' }, // teal
  { key: 'utsugning', label: 'Utsugning', color: '#d97706' }, // amber
  { key: 'snickerier', label: 'Snickerier', color: '#7c3aed' }, // violet
  { key: 'ovrigt', label: 'Övrigt', color: '#64748b' }, // slate
];

// Resolve a stored job_type key against a list. Empty → null (the caller falls back to the material
// inferred from the work order). An unknown key still renders, in a neutral colour, labelled by the
// raw key (e.g. a type that was later deleted).
export function resolveJobTypeFrom(types: JobType[], jobType: string | null | undefined): JobType | null {
  const raw = (jobType ?? '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  return types.find((t) => t.key.toLowerCase() === key) ?? { key, label: raw, color: '#64748b' };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Pure validation for a job type.
export function validateJobType(label: string, color: string): 'label_required' | 'label_too_long' | 'bad_color' | null {
  const l = label.trim();
  if (!l) return 'label_required';
  if (l.length > 40) return 'label_too_long';
  if (!HEX_RE.test(color)) return 'bad_color';
  return null;
}

// A stable key derived from a label (lowercase ascii slug). Used when creating a new type; the key
// is never edited afterwards so existing ops_segments keep resolving.
export function slugifyJobType(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'typ';
}

const SELECT = 'id, key, label, color, sort_index, active';

// All job types (incl inactive) ordered for the picker + admin panel. RLS (schedule.read) applies.
export async function listJobTypes(supabase: SupabaseClient) {
  return supabase.from('ops_job_types').select(SELECT).order('sort_index', { ascending: true }).order('label', { ascending: true });
}

export async function createJobType(
  supabase: SupabaseClient,
  input: { label: string; color: string },
): Promise<{ data: JobTypeRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_job_types')
    .insert({ key: slugifyJobType(input.label), label: input.label.trim(), color: input.color })
    .select(SELECT)
    .single();
  return { data: (data as JobTypeRow) ?? null, error };
}

export type UpdateJobTypeInput = {
  label?: string;
  color?: string;
  active?: boolean;
  sortIndex?: number;
};

// key is never updated (stable identity for ops_segments.job_type).
export async function updateJobType(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateJobTypeInput,
): Promise<{ data: JobTypeRow | null; error: { message: string } | null }> {
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.sortIndex !== undefined) update.sort_index = patch.sortIndex;

  const { data, error } = await supabase.from('ops_job_types').update(update).eq('id', id).select(SELECT).single();
  return { data: (data as JobTypeRow) ?? null, error };
}

// Delete a job type. Segments still carrying its key keep the key and resolve to a neutral chip.
export async function deleteJobType(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_job_types').delete().eq('id', id);
}
