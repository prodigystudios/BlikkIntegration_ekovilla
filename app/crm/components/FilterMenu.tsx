"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

// Skalet runt CRM-listornas flervalsfilter — Ansvarig och Status: knappen som sammanfattar valet,
// menyn med rubrik och kryssrader, och stängningen (klick utanför, Escape). Bröts ut ur
// AssigneeFilter när statusfiltret kom (2026-10-06), så att de två ser ut och beter sig likadant.

export function FilterMenu({
  summary,
  badge,
  heading,
  headerAction,
  className,
  children,
}: {
  /** Knappens text — valet i ord. */
  summary: string;
  /** Valfri bricka till höger i knappen, t.ex. antalet valda. */
  badge?: ReactNode;
  /** Menyns rubrik. */
  heading: string;
  /** Länkknappar till höger om rubriken (Rensa, Visa alla …). */
  headerAction?: ReactNode;
  className?: string;
  children: ReactNode;
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

  return (
    <div ref={ref} className={cn('relative', className ?? 'w-[200px]')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={summary}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition',
          open ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-[#dce4d8] hover:border-[#c8d4c3]',
        )}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {badge}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn('text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={heading}
          // Minst 240 px, annars knappens bredd (hela raden på mobilen). 320 px hög: statusfiltrets
          // sju rader ryms utan rullning.
          className="absolute right-0 z-[60] mt-2 max-h-80 w-full min-w-[240px] overflow-y-auto rounded-xl border border-[#d6e1d0] bg-[#f9fbf7] p-1.5 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]"
        >
          <div className="flex items-center justify-between px-2 pb-1 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{heading}</span>
            {headerAction}
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Länkknappen i menyns rubrikrad (Rensa, Visa alla, Återställ). */
export function FilterMenuAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
    >
      {children}
    </button>
  );
}

/** En kryssrad i menyn. `trailing` står längst till höger — statusfiltrets antal. */
export function FilterCheckRow({ label, checked, onToggle, trailing }: { label: string; checked: boolean; onToggle: () => void; trailing?: ReactNode }) {
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
      {trailing !== undefined ? <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-slate-500">{trailing}</span> : null}
    </button>
  );
}
