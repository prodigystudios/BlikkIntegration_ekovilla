"use client";

import { FilterCheckRow, FilterMenu, FilterMenuAction } from '@/app/crm/components/FilterMenu';
import { isStatusFilterChanged, summarizeStatusFilter } from '@/lib/domains/crm/listStatusFilter';

// Statusfiltret i offert- och orderlistan (William, 2026-10-06): kryssrutor i samma meny som
// ansvarigfiltret, i stället för flikarna. Valen, startvalet och knappens text bor i
// lib/domains/crm/listStatusFilter.ts. Valet går till servern som `?statuses=` — sidindelningen
// och räknarna sker där, så att ett urval aldrig räknas på en kapad sida.
//
// Antalet bredvid varje status räknas i samma sök- och ansvarigskop som listan men oberoende av
// statusvalet, så en urkryssad status säger fortfarande hur många rader den döljer.
export default function StatusFilter<T extends string>({
  value,
  onChange,
  options,
  defaultValue,
  labelOf,
  counts,
  className,
}: {
  value: readonly T[];
  onChange: (value: T[]) => void;
  /** Alla val, i menyns ordning. */
  options: readonly T[];
  /** Startvalet — "Återställ" går hit. */
  defaultValue: readonly T[];
  labelOf: (option: T) => string;
  /** Antal per val, eller null innan räknarna hämtats. */
  counts: Partial<Record<T, number>> | null;
  className?: string;
}) {
  const selected = new Set(value);
  const allSelected = options.every((option) => selected.has(option));
  const changed = isStatusFilterChanged(value, defaultValue);

  function toggle(option: T) {
    const next = new Set(selected);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(options.filter((o) => next.has(o)));
  }

  return (
    <FilterMenu
      summary={summarizeStatusFilter(value, options, labelOf)}
      heading="Status"
      headerAction={allSelected && !changed ? null : (
        <span className="flex items-center gap-3">
          {!allSelected ? <FilterMenuAction onClick={() => onChange([...options])}>Visa alla</FilterMenuAction> : null}
          {changed ? <FilterMenuAction onClick={() => onChange([...defaultValue])}>Återställ</FilterMenuAction> : null}
        </span>
      )}
      className={className}
    >
      {options.map((option) => (
        <FilterCheckRow
          key={option}
          label={labelOf(option)}
          checked={selected.has(option)}
          onToggle={() => toggle(option)}
          trailing={counts ? (counts[option] ?? 0) : undefined}
        />
      ))}
    </FilterMenu>
  );
}
