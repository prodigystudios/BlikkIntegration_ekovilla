"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';

// A self-contained date picker with a Swedish, Monday-first calendar. Built in-house so every
// browser renders the SAME control (the native <input type="date"> looks tiny/inconsistent,
// especially in Safari). Drop-in for a native date input: `value` is an ISO `YYYY-MM-DD` string
// (or '' when empty) and `onChange` hands back the same shape, so callers keep their existing state.

const WEEKDAYS = ['må', 'ti', 'on', 'to', 'fr', 'lö', 'sö'];
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' });
const DISPLAY_FMT = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });

// ISO ↔ local Date. Parse the parts rather than `new Date(iso)` — the latter interprets a bare
// date as UTC and shifts the day in negative-offset zones.
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Monday-first weekday index: JS getDay() is 0=Sun..6=Sat → 0=Mon..6=Sun.
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export type DatePickerProps = {
  /** ISO `YYYY-MM-DD`, or '' for no date. */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show the clear (×) affordance and a "Rensa" action. Off for always-required dates. */
  clearable?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
};

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Välj datum',
  disabled = false,
  clearable = true,
  id,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const selected = useMemo(() => parseIso(value), [value]);
  const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  // The month shown in the grid, and the day that owns keyboard focus (roving tabindex).
  const [view, setView] = useState<Date>(() => selected ?? today);
  const [focus, setFocus] = useState<Date>(() => selected ?? today);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Opening jumps the grid + keyboard focus to the selected day (or today).
  useEffect(() => {
    if (!open) return;
    const start = selected ?? today;
    setView(start);
    setFocus(start);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Move DOM focus to the roving day whenever it changes while open.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${toIso(focus)}"]`)?.focus();
  }, [open, focus]);

  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();

  // 6×7 grid starting on the Monday on/before the 1st of the shown month.
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const start = addDays(first, -mondayIndex(first));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [viewYear, viewMonth]);

  function commit(d: Date) {
    onChange(toIso(d));
    setOpen(false);
    triggerRef.current?.focus();
  }
  function shiftMonth(delta: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }
  function moveFocus(next: Date) {
    setFocus(next);
    if (next.getMonth() !== viewMonth || next.getFullYear() !== viewYear) {
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }
  function onGridKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveFocus(addDays(focus, -1)); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(addDays(focus, 1)); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(addDays(focus, -7)); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(addDays(focus, 7)); break;
      case 'Home': e.preventDefault(); moveFocus(addDays(focus, -mondayIndex(focus))); break;
      case 'End': e.preventDefault(); moveFocus(addDays(focus, 6 - mondayIndex(focus))); break;
      case 'PageUp': e.preventDefault(); moveFocus(new Date(focus.getFullYear(), focus.getMonth() - 1, focus.getDate())); break;
      case 'PageDown': e.preventDefault(); moveFocus(new Date(focus.getFullYear(), focus.getMonth() + 1, focus.getDate())); break;
      default: break;
    }
  }

  const label = selected ? DISPLAY_FMT.format(selected) : '';

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[#dce4d8] bg-white py-2 pl-3 text-left text-sm transition-colors hover:border-[#c8d4c3] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#eef1ec] disabled:text-slate-500',
          // Room on the right for the calendar icon (+ the clear button when shown).
          clearable && label && !disabled ? 'pr-14' : 'pr-9',
          open && 'border-emerald-500 ring-2 ring-emerald-500/20',
        )}
      >
        <span className={cn('truncate', label ? 'text-slate-900' : 'text-slate-400')}>{label || placeholder}</span>
      </button>

      {/* Calendar icon (decorative — the whole trigger opens the picker). */}
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
        <rect x="3" y="4.5" width="14" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      {/* Clear — a real sibling button (not nested in the trigger, which would be invalid HTML). */}
      {clearable && label && !disabled ? (
        <button
          type="button"
          aria-label="Rensa datum"
          onClick={() => { onChange(''); triggerRef.current?.focus(); }}
          className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-300 transition-colors hover:text-rose-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Välj datum"
          className="absolute left-0 top-full z-30 mt-1 w-[17.5rem] rounded-xl border border-[#e0e8dc] bg-white p-3 shadow-[0_18px_36px_-12px_rgba(20,44,27,0.28)]"
        >
          {/* Month navigation */}
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Föregående månad" onClick={() => shiftMonth(-1)} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-[#eef3ea] hover:text-slate-800">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="text-sm font-semibold capitalize text-slate-800">{MONTH_YEAR_FMT.format(view)}</span>
            <button type="button" aria-label="Nästa månad" onClick={() => shiftMonth(1)} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-[#eef3ea] hover:text-slate-800">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{w}</span>
            ))}
          </div>

          {/* Day grid (roving tabindex — one tab stop, arrow keys move between days) */}
          <div ref={gridRef} role="grid" onKeyDown={onGridKeyDown} className="grid grid-cols-7 gap-0.5">
            {cells.map((d) => {
              const inMonth = d.getMonth() === viewMonth;
              const isSelected = Boolean(selected && sameDay(d, selected));
              const isToday = sameDay(d, today);
              const isFocus = sameDay(d, focus);
              return (
                <button
                  key={toIso(d)}
                  data-iso={toIso(d)}
                  type="button"
                  tabIndex={isFocus ? 0 : -1}
                  onClick={() => commit(d)}
                  aria-label={DISPLAY_FMT.format(d)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/30',
                    !inMonth && 'text-slate-300',
                    inMonth && !isSelected && 'text-slate-700 hover:bg-[#eef3ea]',
                    isSelected && 'bg-emerald-600 font-semibold text-white hover:bg-emerald-600',
                    !isSelected && isToday && 'font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <button type="button" onClick={() => commit(today)} className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-[#eef3ea]">
              Idag
            </button>
            {clearable && label ? (
              <button type="button" onClick={() => { onChange(''); setOpen(false); triggerRef.current?.focus(); }} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-rose-500">
                Rensa
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
