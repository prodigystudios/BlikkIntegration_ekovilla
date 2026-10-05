"use client";

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { CloseIcon, StarIcon } from './OverviewIcons';
import { achievementSentence, achievementSignature, listAchievements, moreAchievementsSentence } from './scoreboardView';

// Vad läsaren senast stängde. Per läsare och per webbläsare — en bekvämlighet, inget som måste
// överleva: tappas den kommer bannern bara tillbaka.
const DISMISSED_KEY = 'crm-overview-achievement-dismissed';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(signature: string) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, signature);
  } catch {
    // Privat läge eller blockerad lagring: bannern stängs ändå för den här visningen.
  }
}

// Veckans nådda mål, högst upp på sidan. Rubriken är EN händelse — läsarens egen om hen har en —
// och resten sammanfattas, så att bannern förblir en rad och inte blir en lista.
export default function OverviewAchievementBanner({ scoreboard, userId }: {
  scoreboard: WeeklyScoreboard | null;
  userId: string | null;
}) {
  const achievements = useMemo(
    () => (scoreboard ? listAchievements(scoreboard.sellers, userId) : []),
    [scoreboard, userId],
  );
  const signature = scoreboard ? achievementSignature(scoreboard.weekStart, achievements) : null;

  // undefined = ännu inte läst. localStorage finns inte under serverrenderingen, och en banner
  // som syns och sedan försvinner när lagringen lästs är värre än en som kommer en stund senare.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (!signature || achievements.length === 0 || dismissed === undefined || dismissed === signature) return null;

  const more = moreAchievementsSentence(achievements.length - 1);

  return (
    <section
      aria-label="Nådda veckomål"
      className="flex items-start gap-3 rounded-2xl border border-[color:var(--ek-star-border)] bg-[color:var(--ek-star-wash)] px-4 py-3"
    >
      <StarIcon className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--ek-star)]" />
      <div className="min-w-0 flex-1">
        <p className={cn('m-0', crm.bodyStrong)}>{achievementSentence(achievements[0], userId)}</p>
        <p className={cn('m-0', crm.meta)}>{more ? `Grattis! ${more}` : 'Grattis!'}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          writeDismissed(signature);
          setDismissed(signature);
        }}
        aria-label="Stäng"
        className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 transition hover:bg-white/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
