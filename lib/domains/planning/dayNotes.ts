import type { SupabaseClient } from '@supabase/supabase-js';

// Day notes (dagsanteckningar): free-text notes pinned to a calendar day on the board. Pure helpers
// here are unit-tested; the DB functions are thin RLS-scoped queries (planning.schedule.*).

export type DayNote = {
  id: string;
  note_day: string; // 'YYYY-MM-DD'
  body: string;
  created_by: string | null;
};

export const MAX_NOTE_LENGTH = 500;

// Pure validation for a note body.
export function validateNoteBody(body: string): 'empty' | 'too_long' | null {
  const trimmed = body.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_NOTE_LENGTH) return 'too_long';
  return null;
}

// Pure: group notes by their day (oldest first within a day, matching insert order).
export function groupNotesByDay(notes: DayNote[]): Map<string, DayNote[]> {
  const map = new Map<string, DayNote[]>();
  for (const n of notes) {
    const list = map.get(n.note_day) ?? [];
    list.push(n);
    map.set(n.note_day, list);
  }
  return map;
}

const NOTE_SELECT = 'id, note_day, body, created_by';

// Notes whose day falls in [from, to]. RLS (planning.schedule.read) applies.
export async function listDayNotes(
  supabase: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ data: DayNote[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_day_notes')
    .select(NOTE_SELECT)
    .gte('note_day', range.from)
    .lte('note_day', range.to)
    .order('note_day', { ascending: true })
    .order('created_at', { ascending: true });
  return { data: (data ?? []) as DayNote[], error };
}

export type CreateDayNoteInput = {
  noteDay: string;
  body: string;
  actorUserId: string;
};

// created_by must equal the caller (RLS insert policy checks created_by = auth.uid()).
export async function createDayNote(
  supabase: SupabaseClient,
  input: CreateDayNoteInput,
): Promise<{ data: DayNote | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_day_notes')
    .insert({ note_day: input.noteDay, body: input.body.trim(), created_by: input.actorUserId })
    .select(NOTE_SELECT)
    .single();
  return { data: (data as DayNote) ?? null, error };
}

export async function deleteDayNote(supabase: SupabaseClient, id: string) {
  return supabase.from('ops_day_notes').delete().eq('id', id);
}
