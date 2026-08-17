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
 * Tre tillstånd, för de är tre olika saker:
 *   • otilldelad            → "Ej tilldelad"
 *   • tilldelad, namn känt  → namnet
 *   • tilldelad, namn okänt → dämpat streck
 *
 * Det tredje är inte en petitess. Namnen slås upp mot en katalog som hämtas i en EGEN request,
 * så det finns alltid ett fönster där raderna är på plats men katalogen inte är det — och den
 * kan dessutom fallera helt, eller sakna någon vars roll ändrats. Att då skriva "Okänd" vore
 * att påstå något falskt om en rad som är korrekt tilldelad, och att skriva "Ej tilldelad" vore
 * ännu värre. Strecket säger bara att vi inte vet ännu, och löses upp när katalogen landar.
 *
 * Två renderingar, ömsesidigt uteslutande via brytpunkten: `RowAssignee` i den egna
 * rutnätskolumnen, `RowAssigneeChip` i radens chip-rad därunder. Samma uppgift, olika plats —
 * aldrig båda samtidigt.
 */

export function initialsOf(name: string | null | undefined) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function RowAssignee({ name, assigned }: { name: string | null; assigned: boolean }) {
  const label = name ?? (assigned ? '—' : 'Ej tilldelad');
  const title = name ?? (assigned ? 'Ansvarig kunde inte hämtas' : 'Ej tilldelad');

  return (
    <div className="hidden min-w-0 items-center gap-1.5 sm:flex" title={title}>
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          name ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400',
        )}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      {/* Namnet först från md. Mellan sm och md är raden som trängst — identitetskolumnen är den
          som får betala för varje pixel här — så där står brickan ensam kvar precis som förut,
          och title bär namnet. */}
      <span
        className={cn(
          'hidden truncate text-[11px] font-medium md:inline',
          name ? 'text-slate-600' : 'text-slate-400',
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Mobilvarianten. Renderas bara när namnet är känt: en chip som säger "—" är brus, och kolumnen
 * ovan täcker de andra två tillstånden där det finns plats att förklara dem.
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
