"use client";

import Link from 'next/link';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { StarIcon } from './OverviewIcons';
import { SectionError, TruncatedNote } from './OverviewStates';
import {
  BOARD_METRICS,
  METRIC_LABEL,
  countGoals,
  formatProgress,
  goalsCaption,
  progressPercent,
  weekLabel,
} from './scoreboardView';

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Ringen räknar mål, inte kronor: hur många av lagets veckomål som är nådda. Grön som staplarna —
// guldet är stjärnans, och ringen är en summering av framsteg, inte ett nått mål.
function GoalsRing({ reached, set }: { reached: number; set: number }) {
  const share = set > 0 ? reached / set : 0;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="9" className="stroke-[color:var(--crm-track)]" />
        {share > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - share)}
            className="stroke-[color:var(--crm-flow-3)] transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={crm.display}>{set > 0 ? `${reached} av ${set}` : '–'}</span>
        <span className={crm.micro}>mål nådda</span>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3">
      {BOARD_METRICS.map((metric) => (
        <div key={metric} className="h-5 animate-pulse rounded-md bg-[#dfe6da]" />
      ))}
    </div>
  );
}

// Hela företagets vecka mot summan av säljarnas veckomål. Samma siffror för alla läsare —
// tavlan läses förbi RLS (se weeklyScoreboard.ts) — så rubriken får säga "hela företaget".
export default function OverviewTeamBoard({ loading, scoreboardFailed, scoreboard }: {
  loading: boolean;
  scoreboardFailed: boolean;
  scoreboard: WeeklyScoreboard | null;
}) {
  // Samma nyckel som /crm/installningar kräver — länken ska inte skicka någon till en spärrad sida.
  const canAdjustGoals = useCan('crm.settings.manage');
  const team = scoreboard?.team ?? null;
  const goals = team ? countGoals(team) : { reached: 0, set: 0 };

  return (
    <section aria-labelledby="overview-team-board" className={cn(crm.cardInner, 'min-w-0 p-4')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="overview-team-board" className={cn('m-0', crm.cardTitle)}>Veckans tavla</h2>
        {scoreboard ? <p className={cn('m-0', crm.meta)}>{weekLabel(scoreboard.weekStart, scoreboard.weekEnd)}</p> : null}
      </div>
      <p className={cn('m-0 mt-0.5', crm.meta)}>Hela företaget</p>

      <div className="mt-4">
        {loading ? <BoardSkeleton /> : scoreboardFailed || !team ? <SectionError /> : (
          <div className="grid items-center gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_auto]">
            {/* Kolumnerna sitter på listan och raderna ärver dem (subgrid). Med ett rutnät per rad
                blev värdekolumnen olika bred på varje rad, och staplarna olika långa — samma
                mål ritades med olika skala. */}
            <ul className="m-0 grid list-none grid-cols-[6.5rem_minmax(0,1fr)_auto_1rem] gap-x-3 gap-y-2.5 p-0">
              {BOARD_METRICS.map((metric) => {
                const progress = team[metric];
                const percent = progressPercent(progress);
                return (
                  <li key={metric} className="col-span-4 grid grid-cols-subgrid items-center">
                    <span className="text-sm text-slate-700">{METRIC_LABEL[metric]}</span>
                    {/* Ingen stapel utan mål: en tom eller full stapel hade sagt något om ett mål
                        som inte finns. */}
                    {percent == null ? <span /> : (
                      <span className="h-1.5 rounded-full bg-[color:var(--crm-track)]" aria-hidden="true">
                        <span className="block h-full rounded-full bg-[color:var(--crm-flow-3)]" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                    <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{formatProgress(metric, progress)}</span>
                    {progress.reached ? (
                      <span title="Veckomålet är nått">
                        <StarIcon className="h-4 w-4 text-[color:var(--ek-star)]" />
                        <span className="sr-only">Veckomålet är nått</span>
                      </span>
                    ) : <span />}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-4 md:flex-col md:gap-2 md:border-l md:border-[#e0e8dc] md:pl-6">
              <GoalsRing reached={goals.reached} set={goals.set} />
              <div className="grid gap-1 md:text-center">
                <p className={cn('m-0', crm.metaStrong)}>{goalsCaption(goals)}</p>
                {goals.set === 0 && canAdjustGoals ? (
                  <Link href="/crm/installningar" className={cn('text-xs', crm.link)}>Sätt veckomål</Link>
                ) : null}
              </div>
            </div>
            {/* Tavlans kapning gäller också raderna per säljare och topplistan — samma läsning. */}
            <TruncatedNote queries={scoreboard?.truncated ?? []} className="md:col-span-2" />
          </div>
        )}
      </div>
    </section>
  );
}
