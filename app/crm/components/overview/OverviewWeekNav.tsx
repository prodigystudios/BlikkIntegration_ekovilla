"use client";

import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { addDaysISO } from '@/lib/domains/planning/timezone';
import { ChevronIcon } from './OverviewIcons';
import { weekLabel } from './scoreboardView';

export type WeekNavProps = {
  /** Måndagen för veckan som visas. */
  weekStart: string;
  isCurrent: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCurrent: () => void;
};

// `p-0`: globala knappstilar lägger annars på egen utfyllnad (se project_global_button_padding).
const arrowClass = 'inline-flex h-7 w-7 items-center justify-center rounded-lg p-0 text-slate-600 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ek-accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';

// Bläddra mellan veckorna på tavlan. Framåt tar slut vid denna vecka — en kommande vecka har inget
// utfall att visa. Bakåt har ingen gräns: en URL som namnger en vecka ska öppna den.
export default function OverviewWeekNav({ weekStart, isCurrent, onPrev, onNext, onCurrent }: WeekNavProps) {
  // Etiketten räknas ur den valda måndagen, inte ur tavlans svar: medan en vecka laddas finns inget
  // svar, och rubriken ska redan säga vilken vecka som är på väg.
  const label = weekLabel(weekStart, addDaysISO(weekStart, 7));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {!isCurrent ? (
        <button type="button" onClick={onCurrent} className={cn('p-0 text-xs', crm.link)}>Denna vecka</button>
      ) : null}
      <div className="flex items-center gap-0.5" role="group" aria-label="Byt vecka">
        <button type="button" onClick={onPrev} className={arrowClass} aria-label="Föregående vecka">
          <ChevronIcon direction="left" className="h-4 w-4" />
        </button>
        {/* aria-live: den som bläddrar med tangentbordet får höra vilken vecka som visas nu. */}
        <p className={cn('m-0 min-w-[9.5rem] text-center tabular-nums', crm.meta)} aria-live="polite">{label}</p>
        <button type="button" onClick={onNext} disabled={isCurrent} className={arrowClass} aria-label="Nästa vecka">
          <ChevronIcon direction="right" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
