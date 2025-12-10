export type DayNote = {
  id: string;
  note_day: string; // YYYY-MM-DD
  text: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export async function listDayNotes(startISO: string, endISO: string): Promise<DayNote[]> {
  const res = await fetch(`/api/planning/day-notes?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  const json = await res.json();
  return (json?.notes ?? []) as DayNote[];
}

export async function upsertDayNote(payload: {
  id?: string;
  note_day: string; // YYYY-MM-DD
  text: string;
  created_by?: string;
  created_by_name?: string;
}): Promise<DayNote> {
  const res = await fetch('/api/planning/day-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to upsert note: ${res.status}`);
  const json = await res.json();
  return json?.note as DayNote;
}

export async function deleteDayNoteById(id: string): Promise<void> {
  const res = await fetch(`/api/planning/day-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete note: ${res.status}`);
}

export async function deleteDayNoteByDay(note_day: string): Promise<void> {
  const res = await fetch(`/api/planning/day-notes?note_day=${encodeURIComponent(note_day)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete note: ${res.status}`);
}
