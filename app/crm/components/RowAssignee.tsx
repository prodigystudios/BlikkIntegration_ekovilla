'use client';

import { cn } from '@/lib/shared/cn';

/**
 * Ansvarig person på en rad i offert- och orderlistan.
 *
 * Listorna visade tidigare bara en initialbricka med namnet i `title` — man fick hovra för att
 * få svar på en fråga raden redan hade plats att besvara, och på mobil var kolumnen helt dold.
 * Här står namnet skrivet. Brickan är kvar som visuellt ankare och som signalen för tilldelad
 * kontra otilldelad; det är den enda färgkodningen i cellen.
 *
 * Två renderingar, ömsesidigt uteslutande via brytpunkten: `RowAssignee` i den egna
 * rutnätskolumnen från `sm` och uppåt, `RowAssigneeChip` i radens chip-rad därunder. Samma
 * uppgift, olika plats — aldrig båda samtidigt.
 */

export function initialsOf(name: string | null | undefined) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function RowAssignee({ name }: { name: string | null }) {
  return (
    // title bär hela namnet: kolumnen rymmer de flesta, men ett långt namn kapas och då ska
    // hela finnas kvar att nå.
    <div className="hidden min-w-0 items-center gap-1.5 sm:flex" title={name ?? 'Ej tilldelad'}>
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          name ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400',
        )}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      <span className={cn('truncate text-[11px] font-medium', name ? 'text-slate-600' : 'text-slate-400')}>
        {name ?? 'Ej tilldelad'}
      </span>
    </div>
  );
}

/**
 * Mobilvarianten. Renderas bara för en tilldelad rad — "Ej tilldelad" är en tom uppgift som inte
 * är värd en chip på den trängsta ytan, och kolumnen ovan säger det redan där det finns plats.
 *
 * Rund bricka + namn skiljer den från radens övriga chips, som alla är platta statusetiketter.
 */
export function RowAssigneeChip({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 sm:hidden">
      <span
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 text-[8px] font-bold text-emerald-800"
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      {name}
    </span>
  );
}
