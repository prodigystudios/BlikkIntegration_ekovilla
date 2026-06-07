"use client";

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';

export type AssigneeOption = { id: string; full_name: string | null };
// Multi-select: each entry is a user id or the sentinel 'mine'. Empty array = everyone.
export type AssigneeFilterValue = string[];

export const MINE = 'mine';

// Shared "Ansvarig" filter for CRM list views (quotes, work orders). The list data is
// loaded in full (RLS lets CRM roles see all); this filters client-side by assigned_to.
// Multi-select so you can show e.g. seller 1 + 4 + 6 at once.
export default function AssigneeFilter({
  value,
  onChange,
  users,
  className,
}: {
  value: AssigneeFilterValue;
  onChange: (value: AssigneeFilterValue) => void;
  users: AssigneeOption[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = new Set(value);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  return (
    <div ref={ref} className={cn('relative', className ?? 'w-[200px]')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition',
          open ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-[#dce4d8] hover:border-[#c8d4c3]',
        )}
      >
        <span className="truncate">{summarizeAssigneeFilter(value, users)}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {value.length > 0 ? (
            <span className="rounded-full bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800">{value.length}</span>
          ) : null}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn('text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-[60] mt-2 max-h-72 w-[240px] overflow-y-auto rounded-xl border border-[#d6e1d0] bg-[#f9fbf7] p-1.5 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]"
        >
          <div className="flex items-center justify-between px-2 pb-1 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Ansvarig</span>
            {value.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="!p-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Rensa
              </button>
            ) : null}
          </div>

          <CheckRow label="Mina" checked={selected.has(MINE)} onToggle={() => toggle(MINE)} />

          <div className="my-1 border-t border-slate-100" />

          {users.length === 0 ? (
            <div className="px-2 py-2 text-xs text-slate-400">Inga säljare hittades</div>
          ) : (
            users.map((u) => (
              <CheckRow
                key={u.id}
                label={u.full_name || 'Namnlös'}
                checked={selected.has(u.id)}
                onToggle={() => toggle(u.id)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center justify-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition',
        checked ? 'bg-emerald-50 text-emerald-900' : 'text-slate-700 hover:bg-[#eef3ea]',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
          checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-[#9fb398] bg-white shadow-inner',
        )}
      >
        {checked ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : null}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// Human-readable summary for the trigger button.
export function summarizeAssigneeFilter(value: AssigneeFilterValue, users: AssigneeOption[]): string {
  if (value.length === 0) return 'Alla ansvariga';
  if (value.length === 1) {
    const only = value[0];
    if (only === MINE) return 'Mina';
    return users.find((u) => u.id === only)?.full_name || '1 vald';
  }
  return `${value.length} valda`;
}

// Does an item with this assigned_to pass the filter? Empty selection = show all.
export function matchesAssignee(
  assignedTo: string | null | undefined,
  value: AssigneeFilterValue,
  currentUserId: string | null,
): boolean {
  if (!value || value.length === 0) return true;
  for (const sel of value) {
    if (sel === MINE) {
      if (currentUserId && assignedTo === currentUserId) return true;
    } else if (assignedTo === sel) {
      return true;
    }
  }
  return false;
}
