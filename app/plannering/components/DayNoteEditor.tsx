"use client";
import React, { useState } from 'react';
import { upsertDayNote, deleteDayNoteByDay, type DayNote } from '@/lib/dayNotes';

export default function DayNoteEditor({
  day,
  note,
  currentUserId,
  currentUserName,
  onSaved,
  readOnly,
}: {
  day: string; // YYYY-MM-DD
  note?: DayNote | undefined;
  currentUserId?: string | null;
  currentUserName?: string | null;
  onSaved?: (note: DayNote | null) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>(note?.text ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setText(note?.text ?? '');
    setOpen(true);
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
  };

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text.trim()) return; // ignore empty saves
    try {
      setStatus('saving');
      const saved = await upsertDayNote({
        id: note?.id,
        note_day: day,
        text: text.trim(),
        created_by: currentUserId || undefined,
        created_by_name: currentUserName || undefined,
      });
      setStatus('idle');
      setOpen(false);
      onSaved?.(saved);
    } catch (err) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 1500);
    }
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setStatus('saving');
      await deleteDayNoteByDay(day);
      setStatus('idle');
      setOpen(false);
      onSaved?.(null);
    } catch (err) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 1500);
    }
  };

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {note?.text ? (
          <div style={{ fontSize: 11, color: '#374151', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', maxHeight: 56, overflow: 'hidden', textOverflow: 'ellipsis' }} title={note.text}>
            {note.text}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#64748b' }}>&nbsp;</span>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={startEdit}
            className="btn--plain btn--xs"
            title={note?.text ? 'Redigera anteckning' : 'Lägg till anteckning'}
            style={{ fontSize: 10, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}
          >
            {note?.text ? 'Ändra' : 'Anteckning'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 6, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Skriv anteckning för dagen…"
        style={{ width: '100%', fontSize: 12, padding: 6, border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={save}
            disabled={status === 'saving' || !text.trim()}
            className="btn--plain btn--xs"
            style={{ fontSize: 11, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857', borderRadius: 6, padding: '3px 10px' }}
          >
            {status === 'saving' ? 'Sparar…' : 'Spara'}
          </button>
          {note?.id && (
            <button
              type="button"
              onClick={remove}
              disabled={status === 'saving'}
              className="btn--plain btn--xs"
              style={{ fontSize: 11, background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 6, padding: '3px 10px' }}
            >
              Ta bort
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={cancel}
          className="btn--plain btn--xs"
          style={{ fontSize: 11, background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 6, padding: '3px 10px' }}
        >
          Avbryt
        </button>
      </div>
    </div>
  );
}
