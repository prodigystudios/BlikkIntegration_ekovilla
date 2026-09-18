"use client";

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { MINE, summarizeAssigneeFilter, type AssigneeFilterValue, type AssigneeOption } from '@/lib/domains/crm/assigneeFilter';

// Reglerna (startvärde, serverparameter, matchning, sammanfattning) bor i en ren modul — JSX går
// inte att importera i testkörningen, så logik här hade varit oprövbar. Återexporteras så att
// anropare kan importera allt från komponenten som förut.
export {
  MINE,
  defaultAssigneeFilter,
  assigneeQueryParam,
  summarizeAssigneeFilter,
  matchesAssignee,
} from '@/lib/domains/crm/assigneeFilter';
export type { AssigneeOption, AssigneeFilterValue } from '@/lib/domains/crm/assigneeFilter';

// Shared "Ansvarig" filter for CRM list views (quotes, work orders, säljtavlan).
// Multi-select so you can show e.g. seller 1 + 4 + 6 at once.
//
// ⚠️ I offert- och orderlistan är valet en WHERE-sats, inte en gallring i webbläsaren: det går ut
// som `?assignee=` och blir `in('assigned_to', …)` server-side — på raderna OCH på varje flikräknare
// på sidan. Två följder som inte syns i den här filen:
//   • `in(...)` matchar ALDRIG null, så rader utan ansvarig ("Ej tilldelad") faller bort. Menyn har
//     ingen egen rad för dem — enda vägen dit är att rensa filtret.
//   • Sökrutan är OCH:ad med filtret. En kollegas ordernummer ger därför noll träffar, vilket är
//     varför båda listornas tomma läge måste erbjuda "Visa alla ansvariga".
// Säljtavlan filtrerar däremot fortfarande i klienten (matchesAssignee) över sin egen laddade data.
export default function AssigneeFilter({
  value,
  onChange,
  users,
  className,
  showMine = true,
}: {
  value: AssigneeFilterValue;
  onChange: (value: AssigneeFilterValue) => void;
  users: AssigneeOption[];
  className?: string;
  /**
   * Visa valet "Mina"? False för den som aldrig kan stå som ansvarig — lönebyrån på
   * /ekonomi/arbetsorder. Ett val vars enda möjliga utfall är noll rader är inte ett val, det är
   * en fälla. Att däremot filtrera på en enskild SÄLJARE är fortfarande användbart för dem, så
   * resten av menyn står kvar. Se defaultAssigneeFilter, som bär samma regel för startvärdet.
   */
  showMine?: boolean;
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
                className="p-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Rensa
              </button>
            ) : null}
          </div>

          {showMine ? (
            <>
              <CheckRow label="Mina" checked={selected.has(MINE)} onToggle={() => toggle(MINE)} />
              <div className="my-1 border-t border-slate-100" />
            </>
          ) : null}

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
