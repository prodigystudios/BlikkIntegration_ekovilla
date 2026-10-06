'use client';

import { cn } from '@/lib/shared/cn';

/**
 * Ansvarig person i offert- och orderlistans tabell, i kolumnen Ansvarig.
 *
 * Listorna visade tidigare bara en initialbricka med namnet i `title` — man fick hovra för att
 * få svar på en fråga raden redan hade plats att besvara. Här står namnet skrivet. Brickan är kvar
 * som visuellt ankare och som signalen för tilldelad kontra otilldelad; det är den enda
 * färgkodningen i cellen.
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
 * Synligheten styrs av tabellkolumnen (dold på smala skärmar, där listans ansvarigfilter redan
 * står på "Mina" från start), inte här.
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
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          name ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400',
        )}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      <span className={cn('truncate', name ? 'text-slate-700' : 'text-slate-400')}>{label}</span>
    </div>
  );
}
