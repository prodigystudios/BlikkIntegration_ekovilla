'use client';

import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import type { DayNote } from '@/lib/domains/planning/dayNotes';

// One day's notes column in the week board's notes strip: amber note chips (removable) + an inline
// "+ notering" add affordance that becomes a small input.
export default function DayNotesCell({
  dayISO,
  notes,
  canWrite,
  isWeekend,
  isToday,
  onAdd,
  onRemove,
}: {
  dayISO: string;
  notes: DayNote[];
  canWrite: boolean;
  isWeekend: boolean;
  isToday: boolean;
  onAdd: (dayISO: string, body: string) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  function submit() {
    const body = text.trim();
    setText('');
    setAdding(false);
    if (body) onAdd(dayISO, body);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setText('');
      setAdding(false);
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-[30px] flex-col gap-1 border-l border-[#d3ddcb] px-1 py-1',
        isToday ? 'bg-emerald-50/50' : isWeekend ? 'bg-slate-400/[0.04]' : '',
      )}
    >
      {notes.map((n) => (
        <div key={n.id} className="group/note flex items-start gap-1 rounded-md border border-amber-200/70 bg-amber-50 px-1.5 py-0.5">
          <span className="flex-1 break-words text-[10px] leading-snug text-amber-800">{n.body}</span>
          {canWrite && (
            <button
              type="button"
              onClick={() => onRemove(n.id)}
              aria-label="Ta bort notering"
              className="mt-px hidden shrink-0 text-amber-400 transition hover:text-rose-500 group-hover/note:block"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}

      {canWrite &&
        (adding ? (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onBlur={submit}
            placeholder="Notering…"
            className="h-6 w-full rounded-md border border-emerald-300 bg-white px-1.5 text-[10px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-left text-[9.5px] font-semibold text-slate-300 transition hover:text-emerald-600"
          >
            + notering
          </button>
        ))}
    </div>
  );
}
