"use client";

import { useRef } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { ChevronIcon } from './OverviewIcons';
import { shiftWeek } from './overviewWeek';
import { weekLabel } from './scoreboardView';

export type WeekNavProps = {
  /** Måndagen för veckan som visas — null tills denna vecka laddats (etiketten ritas då inte). */
  weekStart: string | null;
  isCurrent: boolean;
  /** Framåt tar slut vid denna vecka. */
  canGoForward: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCurrent: () => void;
};

// `p-0`: globala knappstilar lägger annars på egen utfyllnad (se project_global_button_padding).
const arrowClass = 'inline-flex h-7 w-7 items-center justify-center rounded-lg p-0 text-slate-600 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ek-accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';

// Bläddra mellan veckorna på tavlan. Bakåt har ingen gräns: en URL som namnger en vecka ska öppna den.
export default function OverviewWeekNav({ weekStart, isCurrent, canGoForward, onPrev, onNext, onCurrent }: WeekNavProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);

  // Landar man på denna vecka stängs Nästa av, och "Denna vecka" försvinner — knappen som hade
  // fokus är borta eller avstängd, och fokus föll till <body>. Då flyttas det till Föregående, som
  // alltid finns. Safari låter en knapp som just stängts av behålla fokus en stund, så en avstängd
  // knapp räknas som tappat fokus.
  const keepFocus = (action: () => void) => () => {
    action();
    setTimeout(() => {
      const active = document.activeElement;
      const lost = !groupRef.current?.contains(active) || (active instanceof HTMLButtonElement && active.disabled);
      if (lost) prevRef.current?.focus();
    }, 0);
  };

  // Etiketten räknas ur den valda måndagen, inte ur tavlans svar: medan en vecka laddas finns inget
  // svar, och rubriken ska redan säga vilken vecka som är på väg.
  const label = weekStart ? weekLabel(weekStart, shiftWeek(weekStart, 1)) : null;
  return (
    <div ref={groupRef} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {!isCurrent ? (
        <button type="button" onClick={keepFocus(onCurrent)} className={cn('p-0 text-xs', crm.link)}>Denna vecka</button>
      ) : null}
      <div className="flex items-center gap-0.5" role="group" aria-label="Byt vecka">
        <button ref={prevRef} type="button" onClick={onPrev} className={arrowClass} aria-label="Föregående vecka">
          <ChevronIcon direction="left" className="h-4 w-4" />
        </button>
        {/* aria-live: den som bläddrar med tangentbordet får höra vilken vecka som visas nu. Platsen
            hålls medan veckan är okänd, så att pilarna inte hoppar när etiketten kommer. */}
        <p className={cn('m-0 min-w-[9.5rem] text-center tabular-nums', crm.meta)} aria-live="polite">{label ?? ' '}</p>
        <button type="button" onClick={keepFocus(onNext)} disabled={!canGoForward} className={arrowClass} aria-label="Nästa vecka">
          <ChevronIcon direction="right" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
