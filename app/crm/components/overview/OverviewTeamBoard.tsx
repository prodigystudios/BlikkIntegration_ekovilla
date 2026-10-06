"use client";

import Link from 'next/link';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { MetricProgress, ScoreboardMetric, WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { StarIcon } from './OverviewIcons';
import OverviewWeekNav, { type WeekNavProps } from './OverviewWeekNav';
import { SectionError, TruncatedNote } from './OverviewStates';
import {
  BOARD_METRICS,
  METRIC_LABEL,
  countGoals,
  formatMetricValue,
  goalsCaption,
  progressPercent,
} from './scoreboardView';

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Ringen räknar mål, inte kronor: hur många av lagets veckomål som är nådda. Grön som staplarna —
// guldet är stjärnans, och ringen är en summering av framsteg, inte ett nått mål.
function GoalsRing({ reached, set }: { reached: number; set: number }) {
  const share = set > 0 ? reached / set : 0;
  return (
    <div className="relative h-28 w-28 shrink-0 md:h-36 md:w-36">
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
        <span className={cn(crm.display, 'md:text-2xl')}>{set > 0 ? `${reached} av ${set}` : '–'}</span>
        <span className={crm.micro}>mål nådda</span>
      </div>
    </div>
  );
}

// Ett mått: namnet (och stjärnan) till vänster, utfallet mot målet till höger, stapeln under.
// Stapeln går över hela listans bredd i varje rad, så samma mål ritas alltid med samma skala.
function MetricRow({ metric, progress }: { metric: ScoreboardMetric; progress: MetricProgress }) {
  const percent = progressPercent(progress);
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="flex items-center gap-1.5 text-sm text-slate-700">
          {METRIC_LABEL[metric]}
          {progress.reached ? (
            <span title="Veckomålet är nått">
              <StarIcon className="h-4 w-4 text-[color:var(--ek-star)]" />
              <span className="sr-only">Veckomålet är nått</span>
            </span>
          ) : null}
        </span>
        <span className="text-sm leading-6 tabular-nums">
          <strong className="whitespace-nowrap text-lg font-bold leading-6 text-slate-900">{formatMetricValue(metric, progress.done)}</strong>
          {progress.target != null ? (
            <>{' '}<span className="whitespace-nowrap text-slate-500">/ {formatMetricValue(metric, progress.target)}</span></>
          ) : null}
        </span>
      </div>
      {/* Ingen stapel utan mål, inte ens spåret — en tom stapel hade sett ut som "noll av något".
          Platsen hålls ändå, så att raderna står med samma avstånd. */}
      <div className={cn('mt-1.5 h-2 rounded-full', percent != null && 'bg-[color:var(--crm-track)]')} aria-hidden="true">
        {percent != null && percent > 0 ? (
          <div className="h-full rounded-full bg-[color:var(--crm-flow-3)]" style={{ width: `${percent}%` }} />
        ) : null}
      </div>
    </li>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {BOARD_METRICS.map((metric) => (
        <div key={metric} className="animate-pulse">
          <div className="flex h-6 items-center justify-between">
            <div className="h-4 w-20 rounded bg-[#e6ece2]" />
            <div className="h-5 w-24 rounded bg-[#dfe6da]" />
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#e6ece2]" />
        </div>
      ))}
    </div>
  );
}

// Hela företagets vecka mot summan av säljarnas veckomål. Samma siffror för alla läsare —
// tavlan läses förbi RLS (se weeklyScoreboard.ts) — så rubriken får säga "hela företaget".
//
// Veckobytet sitter här, i tavlans rubrik där veckan redan stod, men styr också topplistan och
// raderna per säljare (CrmOverview).
export default function OverviewTeamBoard({ loading, scoreboardFailed, scoreboard, week, isPastWeek }: {
  loading: boolean;
  scoreboardFailed: boolean;
  scoreboard: WeeklyScoreboard | null;
  week: WeekNavProps;
  /** En vecka som redan passerat — ringen säger då hur den slutade, inte vad som är kvar. */
  isPastWeek: boolean;
}) {
  // Samma nyckel som /crm/installningar kräver — länken ska inte skicka någon till en spärrad sida.
  const canAdjustGoals = useCan('crm.settings.manage');
  const team = scoreboard?.team ?? null;
  const goals = team ? countGoals(team) : { reached: 0, set: 0 };

  return (
    // flex-col: bredvid topplistan sträcks kortet till dess höjd, och listan fyller den i stället
    // för att lämna en tom tredjedel i botten. Staplat (under xl) är höjden innehållets egen.
    <section aria-labelledby="overview-team-board" className={cn(crm.cardInner, 'flex min-w-0 flex-col p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="overview-team-board" className={cn('m-0', crm.cardTitle)}>Veckans tavla</h2>
        <OverviewWeekNav {...week} />
      </div>
      <p className={cn('m-0 mt-0.5', crm.meta)}>Hela företaget</p>

      <div className="mt-4 flex grow flex-col">
        {loading ? <BoardSkeleton /> : scoreboardFailed || !team ? <SectionError /> : (
          <>
            <div className="grid grow gap-x-8 gap-y-5 md:grid-cols-[minmax(0,1fr)_auto]">
              {/* justify-between: höjden som blir över delas mellan raderna, gap-3 är golvet. */}
              <ul className="m-0 flex list-none flex-col justify-between gap-3 p-0">
                {BOARD_METRICS.map((metric) => <MetricRow key={metric} metric={metric} progress={team[metric]} />)}
              </ul>
              <div className="flex items-center gap-4 md:flex-col md:justify-center md:gap-3 md:border-l md:border-[#e0e8dc] md:pl-8">
                <GoalsRing reached={goals.reached} set={goals.set} />
                <div className="grid gap-1 md:text-center">
                  <p className={cn('m-0', crm.metaStrong)}>{goalsCaption(goals, isPastWeek)}</p>
                  {/* Bara denna vecka: en länk till Inställningar för en månad som redan passerat
                      hade lovat något den inte kan hålla. */}
                  {goals.set === 0 && canAdjustGoals && week.isCurrent ? (
                    <Link href="/crm/installningar" className={cn('text-xs', crm.link)}>Sätt veckomål</Link>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Tavlans kapning gäller också raderna per säljare och topplistan — samma läsning. */}
            <TruncatedNote queries={scoreboard?.truncated ?? []} className="mt-3" />
          </>
        )}
      </div>
    </section>
  );
}
