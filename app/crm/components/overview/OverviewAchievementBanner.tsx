"use client";

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { CloseIcon, StarIcon } from './OverviewIcons';
import {
  achievementSentence,
  dismissAchievements,
  listAchievements,
  moreAchievementsSentence,
  newAchievements,
  parseDismissedAchievements,
  type DismissedAchievements,
} from './scoreboardView';

// Vad läsaren har stängt. En bekvämlighet, inget som måste överleva: tappas den kommer bannern
// bara tillbaka. Läsarens id står i nyckeln — två säljare på samma dator ska inte stänga
// varandras "Du nådde …".
function dismissedKey(userId: string | null) {
  return `crm-overview-achievement-dismissed:${userId ?? 'okänd'}`;
}

function readDismissed(userId: string | null): DismissedAchievements | null {
  try {
    return parseDismissedAchievements(window.localStorage.getItem(dismissedKey(userId)));
  } catch {
    return null;
  }
}

function writeDismissed(userId: string | null, value: DismissedAchievements) {
  try {
    window.localStorage.setItem(dismissedKey(userId), JSON.stringify(value));
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

  // undefined = ännu inte läst. localStorage finns inte under serverrenderingen, och en banner
  // som syns och sedan försvinner när lagringen lästs är värre än en som kommer en stund senare.
  const [dismissed, setDismissed] = useState<DismissedAchievements | null | undefined>(undefined);
  useEffect(() => {
    setDismissed(readDismissed(userId));
  }, [userId]);

  if (!scoreboard || dismissed === undefined) return null;
  const weekStart = scoreboard.weekStart;
  const fresh = newAchievements(weekStart, achievements, dismissed);
  if (fresh.length === 0) return null;

  // Rubriken är det första NYA målet; meningen under räknar resten av veckans, stängda inräknade.
  const more = moreAchievementsSentence(achievements.length - 1);

  return (
    <section
      aria-label="Nådda veckomål"
      className="flex items-start gap-3 rounded-2xl border border-[color:var(--ek-star-border)] bg-[color:var(--ek-star-wash)] px-4 py-3"
    >
      <StarIcon className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--ek-star)]" />
      <div className="min-w-0 flex-1">
        <p className={cn('m-0', crm.bodyStrong)}>{achievementSentence(fresh[0], userId)}</p>
        <p className={cn('m-0', crm.meta)}>{more ? `Grattis! ${more}` : 'Grattis!'}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          const next = dismissAchievements(weekStart, achievements, dismissed);
          writeDismissed(userId, next);
          setDismissed(next);
        }}
        aria-label="Stäng"
        className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 transition hover:bg-white/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
