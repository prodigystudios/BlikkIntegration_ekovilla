"use client";

import Link from 'next/link';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { MetricProgress, ScoreboardMetric, ScoreboardSeller, WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import OverviewAvatar from './OverviewAvatar';
import { StarIcon } from './OverviewIcons';
import { SectionError } from './OverviewStates';
import { BOARD_METRICS, METRIC_LABEL, formatMetricValue, progressPercent } from './scoreboardView';

// Ett mått i en säljares rad: namnet och stjärnan överst, utfallet mot målet, stapeln. Mockupen
// hade dessutom "mål 10" under stapeln — det står redan i "9 / 10", och en tredje rad med samma
// tal gjorde cellen högre utan att säga något nytt.
function MetricCell({ metric, progress }: { metric: ScoreboardMetric; progress: MetricProgress }) {
  const percent = progressPercent(progress);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <span className={crm.micro}>{METRIC_LABEL[metric]}</span>
        {progress.reached ? (
          <>
            <StarIcon className="h-3.5 w-3.5 shrink-0 text-[color:var(--ek-star)]" />
            <span className="sr-only">veckomålet är nått</span>
          </>
        ) : null}
      </div>
      <p className="m-0 mt-0.5 truncate text-sm tabular-nums">
        <strong className="font-semibold text-slate-900">{formatMetricValue(metric, progress.done)}</strong>
        {progress.target != null ? (
          <span className="text-slate-500"> / {formatMetricValue(metric, progress.target)}</span>
        ) : null}
      </p>
      {/* Ingen stapel utan mål, inte ens spåret — ett tomt spår hade sett ut som "noll av något".
          Platsen hålls ändå, så att raderna står i linje. */}
      <div className={cn('mt-1.5 h-1 rounded-full', percent != null && 'bg-[color:var(--crm-track)]')} aria-hidden="true">
        {percent != null && percent > 0 ? (
          <div className="h-full rounded-full bg-[color:var(--crm-flow-3)]" style={{ width: `${percent}%` }} />
        ) : null}
      </div>
    </div>
  );
}

function SellerRow({ seller, isViewer }: { seller: ScoreboardSeller; isViewer: boolean }) {
  return (
    <li className="grid gap-3 rounded-xl border border-[#e8eee5] bg-white/60 px-3.5 py-3 lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-center lg:gap-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <OverviewAvatar name={seller.name} className="h-8 w-8" />
        <span className={cn('truncate', crm.bodyStrong)}>{seller.name}</span>
        {isViewer ? <span className={cn('shrink-0', crm.meta)}>du</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {BOARD_METRICS.map((metric) => (
          <MetricCell key={metric} metric={metric} progress={seller.metrics[metric]} />
        ))}
      </div>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div className="grid gap-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-[68px] animate-pulse rounded-xl border border-[#e0e8dc] bg-[#dfe6da]" />
      ))}
    </div>
  );
}

// Varje säljares vecka mot hens egna veckomål — samma sex mått som tavlan, i samma ordning på
// varje rad, så att kolumnerna går att läsa nedåt. Målen sitter i varje cell och inte i en
// gemensam kolumnrubrik (som i den täta mockupen): de är olika för varje säljare.
//
// Ordningen är tavlans: snittet av utfall mot mål. Topplistan bredvid rangordnar ett mått i taget.
//
// Dold under 640 px som resten av statistiken.
export default function OverviewSellerProgress({ loading, scoreboardFailed, scoreboard, userId }: {
  loading: boolean;
  scoreboardFailed: boolean;
  scoreboard: WeeklyScoreboard | null;
  userId: string | null;
}) {
  // Samma nyckel som /crm/installningar kräver — länken skickade förr en säljare till en sida hen
  // inte kommer in på.
  const canAdjustGoals = useCan('crm.settings.manage');
  const sellers = scoreboard?.sellers ?? [];

  return (
    <section aria-labelledby="overview-seller-progress" className={cn(crm.cardInner, 'hidden p-4 sm:block')}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="overview-seller-progress" className={cn('m-0', crm.cardTitle)}>Utveckling mot veckans mål</h2>
        {canAdjustGoals ? (
          <Link href="/crm/installningar" className={cn('shrink-0 text-xs', crm.link)}>Justera mål</Link>
        ) : null}
      </div>
      {loading ? <RowsSkeleton /> : scoreboardFailed || !scoreboard ? <SectionError /> : sellers.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Inga veckomål satta ännu. Lägg in mål i Inställningar för att följa upp veckan per säljare.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {sellers.map((seller) => (
            <SellerRow key={seller.userId} seller={seller} isViewer={seller.userId === userId} />
          ))}
        </ul>
      )}
    </section>
  );
}
