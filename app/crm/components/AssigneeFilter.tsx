"use client";

import { FilterCheckRow, FilterMenu, FilterMenuAction } from '@/app/crm/components/FilterMenu';
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
  const selected = new Set(value);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  // Menyn, knappen och stängningen bor i FilterMenu (delas med statusfiltret).
  return (
    <FilterMenu
      summary={summarizeAssigneeFilter(value, users)}
      badge={value.length > 0 ? (
        <span className="rounded-full bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800">{value.length}</span>
      ) : null}
      heading="Ansvarig"
      headerAction={value.length > 0 ? <FilterMenuAction onClick={() => onChange([])}>Rensa</FilterMenuAction> : null}
      className={className}
    >
      {showMine ? (
        <>
          <FilterCheckRow label="Mina" checked={selected.has(MINE)} onToggle={() => toggle(MINE)} />
          <div className="my-1 border-t border-slate-100" />
        </>
      ) : null}

      {users.length === 0 ? (
        <div className="px-2 py-2 text-xs text-slate-400">Inga säljare hittades</div>
      ) : (
        users.map((u) => (
          <FilterCheckRow
            key={u.id}
            label={u.full_name || 'Namnlös'}
            checked={selected.has(u.id)}
            onToggle={() => toggle(u.id)}
          />
        ))
      )}
    </FilterMenu>
  );
}
