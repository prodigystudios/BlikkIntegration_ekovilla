"use client";

import Link from 'next/link';
import { useState } from 'react';
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
//
// Kolumn med stapeln i botten (mt-auto): ett belopp som bryts på två rader gör cellen högre, och
// cellerna i en rad sträcks till samma höjd — så staplarna står ändå på samma linje.
function MetricCell({ metric, progress }: { metric: ScoreboardMetric; progress: MetricProgress }) {
  const percent = progressPercent(progress);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1">
        <span className={crm.micro}>{METRIC_LABEL[metric]}</span>
        {progress.reached ? (
          <>
            <StarIcon className="h-3.5 w-3.5 shrink-0 text-[color:var(--ek-star)]" />
            <span className="sr-only">veckomålet är nått</span>
          </>
        ) : null}
      </div>
      {/* Ingen truncate: vid 1280 px med fäst sidomeny är cellen runt 108 px, och "100 000 kr /
          200 000 kr" klipptes mitt i målet — som inte står någon annanstans. Utfall och mål bryts i
          stället var för sig; mellanslaget före "/" ligger utanför nowrap så att det är brytpunkten. */}
      <p className="m-0 mt-0.5 text-sm tabular-nums">
        <strong className="whitespace-nowrap font-semibold text-slate-900">{formatMetricValue(metric, progress.done)}</strong>
        {progress.target != null ? (
          <>{' '}<span className="whitespace-nowrap text-slate-500">/ {formatMetricValue(metric, progress.target)}</span></>
        ) : null}
      </p>
      {/* Ingen stapel utan mål, inte ens spåret — ett tomt spår hade sett ut som "noll av något".
          Platsen hålls ändå, så att raderna står i linje. */}
      <div className="mt-auto pt-1.5" aria-hidden="true">
        <div className={cn('h-1 rounded-full', percent != null && 'bg-[color:var(--crm-track)]')}>
          {percent != null && percent > 0 ? (
            <div className="h-full rounded-full bg-[color:var(--crm-flow-3)]" style={{ width: `${percent}%` }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Raden och måttens rutnät delas med skelettet, så att skelettet får radens höjd i varje bredd —
// en rad är en linje på xl men tre våningar under lg, och en fast skeletthöjd fick sidan att hoppa.
const ROW_CLASS = 'grid gap-3 rounded-xl border border-[#e0e8dc] bg-white/60 px-3.5 py-3 lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-center lg:gap-5';
const METRICS_GRID_CLASS = 'grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-6';

function SellerRow({ seller, isViewer }: { seller: ScoreboardSeller; isViewer: boolean }) {
  return (
    <li className={ROW_CLASS}>
      <div className="flex min-w-0 items-center gap-2.5">
        <OverviewAvatar name={seller.name} className="h-8 w-8" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className={cn('truncate', crm.bodyStrong)}>{seller.name}</span>
            {isViewer ? <span className={cn('shrink-0', crm.meta)}>du</span> : null}
          </div>
          {/* Snittet är det raderna sorteras på. Utan det kunde ordningen se fel ut: snittet är
              okapat, så 14 samtal mot målet 2 väger mer än sex mål nådda på pricken. Den gamla
              listan visade samma procent av samma skäl. */}
          <p className={cn('m-0', crm.micro)}>{Math.round(seller.progressScore * 100)} % av målen i snitt</p>
        </div>
      </div>
      <div className={METRICS_GRID_CLASS}>
        {BOARD_METRICS.map((metric) => (
          <MetricCell key={metric} metric={metric} progress={seller.metrics[metric]} />
        ))}
      </div>
    </li>
  );
}

function SkeletonRow() {
  return (
    <li className={cn(ROW_CLASS, 'animate-pulse')}>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 shrink-0 rounded-full bg-[#dfe6da]" />
        <div className="grid gap-1.5">
          <div className="h-4 w-28 rounded bg-[#dfe6da]" />
          <div className="h-3 w-20 rounded bg-[#e6ece2]" />
        </div>
      </div>
      <div className={METRICS_GRID_CLASS}>
        {BOARD_METRICS.map((metric) => (
          <div key={metric}>
            <div className="h-4 w-14 rounded bg-[#e6ece2]" />
            <div className="mt-0.5 h-5 w-20 rounded bg-[#dfe6da]" />
            <div className="mt-1.5 h-1 rounded-full bg-[#e6ece2]" />
          </div>
        ))}
      </div>
    </li>
  );
}

// Hur många säljare som syns innan man ber om resten — samma tak som listan i det gamla
// målkortet. Raderna går över hela bredden, och utan tak sköt ett stort lag ner Att agera på,
// sidans handlingskort, långt under skärmkanten.
const SELLER_PREVIEW_COUNT = 3;

// Varje säljares vecka mot hens egna veckomål — samma sex mått som tavlan, i samma ordning på
// varje rad, så att kolumnerna går att läsa nedåt. Målen sitter i varje cell och inte i en
// gemensam kolumnrubrik (som i den täta mockupen): de är olika för varje säljare.
//
// Ordningen är tavlans: snittet av utfall mot mål. Topplistan bredvid rangordnar ett mått i taget.
//
// Dold under 640 px som resten av statistiken, och helt borta när ingen har veckomål — tavlan
// säger det redan, med länken till Inställningar för den som får sätta mål.
export default function OverviewSellerProgress({ loading, scoreboardFailed, scoreboard, userId, pastWeekLabel, isPastWeek }: {
  loading: boolean;
  scoreboardFailed: boolean;
  scoreboard: WeeklyScoreboard | null;
  userId: string | null;
  /** "Vecka 40" när en annan vecka än denna är vald i tavlan — annars null. */
  pastWeekLabel: string | null;
  isPastWeek: boolean;
}) {
  // Samma nyckel som /crm/installningar kräver — länken skickade förr en säljare till en sida hen
  // inte kommer in på.
  const canAdjustGoals = useCan('crm.settings.manage');
  const [showAll, setShowAll] = useState(false);
  const sellers = scoreboard?.sellers ?? [];

  if (!loading && !scoreboardFailed && scoreboard && sellers.length === 0) return null;

  const visible = showAll ? sellers : sellers.slice(0, SELLER_PREVIEW_COUNT);

  return (
    <section aria-labelledby="overview-seller-progress" className={cn(crm.cardInner, 'hidden p-4 sm:block')}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id="overview-seller-progress" className={cn('m-0', crm.cardTitle)}>Utveckling mot veckans mål</h2>
          {pastWeekLabel ? <span className={crm.meta}>{pastWeekLabel}</span> : null}
        </div>
        {/* Inte för en vecka som passerat — samma skäl som tavlans "Sätt veckomål". */}
        {canAdjustGoals && !isPastWeek ? (
          <Link href="/crm/installningar" className={cn('shrink-0 text-xs', crm.link)}>Justera mål</Link>
        ) : null}
      </div>
      {loading ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-hidden="true">
          {Array.from({ length: SELLER_PREVIEW_COUNT }).map((_, row) => <SkeletonRow key={row} />)}
        </ul>
      ) : scoreboardFailed || !scoreboard ? <SectionError /> : (
        <>
          <ul className="m-0 grid list-none gap-2 p-0">
            {visible.map((seller) => (
              <SellerRow key={seller.userId} seller={seller} isViewer={seller.userId === userId} />
            ))}
          </ul>
          {sellers.length > SELLER_PREVIEW_COUNT ? (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className={cn('mt-2 p-0 text-xs', crm.link)}
            >
              {showAll ? 'Visa färre' : `Visa alla (${sellers.length})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
