"use client";

import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { ScoreboardMetric, WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import OverviewAvatar from './OverviewAvatar';
import { TrophyIcon } from './OverviewIcons';
import { OverviewLoadingRows, SectionError } from './OverviewStates';
import {
  LEADERBOARD_METRICS,
  METRIC_LABEL,
  competitionRanks,
  formatMetricValue,
  leads,
  rankSellers,
} from './scoreboardView';

// Säljarnas topplista för veckan, ett mått i taget. Bara de som har en månadsbudget står med —
// samma urval som tavlan — så att en admin som loggat ett samtal inte dyker upp som säljare.
export default function OverviewLeaderboard({ loading, scoreboardFailed, scoreboard, userId, weekCaption, isCurrentWeek }: {
  loading: boolean;
  scoreboardFailed: boolean;
  scoreboard: WeeklyScoreboard | null;
  userId: string | null;
  /** "den här veckan" eller "vecka 40" — veckan som tavlan ovanför visar. */
  weekCaption: string;
  isCurrentWeek: boolean;
}) {
  const [metric, setMetric] = useState<ScoreboardMetric>('calls');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Pilarna flyttar mellan flikarna, som i en vanlig tablist; Home och End hoppar till ändarna.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = LEADERBOARD_METRICS.length - 1;
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (next == null) return;
    event.preventDefault();
    setMetric(LEADERBOARD_METRICS[next]);
    tabRefs.current[next]?.focus();
  }

  const sellers = scoreboard?.sellers ?? [];
  const ranked = rankSellers(sellers, metric);
  const ranks = competitionRanks(ranked, metric);

  return (
    <section aria-labelledby="overview-leaderboard" className={cn(crm.cardInner, 'min-w-0 p-4')}>
      <h2 id="overview-leaderboard" className={cn('m-0', crm.cardTitle)}>Säljarnas topplista</h2>

      <div role="tablist" aria-label="Sortera topplistan på" className="mt-3 flex flex-wrap gap-1">
        {LEADERBOARD_METRICS.map((item, index) => {
          const selected = item === metric;
          return (
            <button
              key={item}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              id={`overview-leaderboard-tab-${item}`}
              aria-selected={selected}
              aria-controls="overview-leaderboard-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setMetric(item)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]',
                selected
                  ? 'border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-green)]'
                  : 'border-transparent bg-transparent text-slate-600 hover:text-slate-900',
              )}
            >
              {METRIC_LABEL[item]}
            </button>
          );
        })}
      </div>

      <div
        id="overview-leaderboard-panel"
        role="tabpanel"
        aria-labelledby={`overview-leaderboard-tab-${metric}`}
        className="mt-3"
      >
        {loading ? <OverviewLoadingRows rows={3} /> : scoreboardFailed ? <SectionError /> : ranked.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {/* "ännu" bara om denna vecka — en vecka som passerat får inga mål i efterhand. */}
            {isCurrentWeek ? 'Ingen säljare har veckomål ännu.' : `Ingen säljare hade veckomål ${weekCaption}.`}
          </p>
        ) : (
          <>
            <ol className="m-0 grid list-none p-0">
              {ranked.map((seller, index) => {
                const progress = seller.metrics[metric];
                const isViewer = seller.userId === userId;
                return (
                  <li
                    key={seller.userId}
                    className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#eef2ec] py-2 last:border-b-0"
                  >
                    <span className="flex justify-center text-xs font-semibold tabular-nums text-slate-500">
                      {leads(ranks[index], progress) ? (
                        <>
                          <TrophyIcon className="h-[18px] w-[18px] text-[color:var(--ek-green)]" />
                          <span className="sr-only">{ranks[index]}</span>
                        </>
                      ) : ranks[index]}
                    </span>
                    <OverviewAvatar name={seller.name} />
                    <span className={cn('truncate', isViewer ? crm.bodyStrong : 'text-sm text-slate-800')}>
                      {seller.name}
                      {isViewer ? <span className={cn('ml-1.5 font-normal', crm.meta)}>du</span> : null}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMetricValue(metric, progress.done)}</span>
                  </li>
                );
              })}
            </ol>
            <p className={cn('m-0 mt-2', crm.micro)}>Sorterat på {METRIC_LABEL[metric].toLocaleLowerCase('sv-SE')} {weekCaption}.</p>
          </>
        )}
      </div>
    </section>
  );
}
