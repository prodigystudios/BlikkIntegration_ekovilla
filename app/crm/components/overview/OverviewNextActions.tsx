"use client";

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { buildOverviewActions, staleCalls } from './overviewActions';
import { StarOutlineIcon } from './OverviewIcons';
import { OverviewLoadingRows, SectionError } from './OverviewStates';
import { callsToStar, callsToStarSentence } from './scoreboardView';

// Läsarens egen väg till samtalsstjärnan, ur veckotavlan. Står ovanför åtgärdsraderna och räknas
// inte in i dem: det är ett mål att sträcka sig mot, inte något som har blivit liggande.
function CallsToStarNudge({ name, remaining }: { name: string | null; remaining: number }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-[color:var(--ek-star-border)] bg-[color:var(--ek-star-wash)] px-3.5 py-2.5">
      <StarOutlineIcon className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--ek-star)]" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <strong className={crm.bodyStrong}>{name ? `${name}, du` : 'Du'} är {remaining} samtal från stjärnan</strong>
        <p className="m-0 text-xs leading-snug text-slate-600">{callsToStarSentence(remaining)}</p>
      </div>
      <Link href="/crm/samtal" className={cn('mt-0.5 shrink-0 text-xs', crm.link)}>Till samtalen →</Link>
    </div>
  );
}

export default function OverviewNextActions({ loading, summaryFailed, summary, scoreboard, userId }: {
  loading: boolean;
  summaryFailed: boolean;
  summary: CrmOverviewSummary;
  scoreboard: WeeklyScoreboard | null;
  userId: string | null;
}) {
  // Admin ser hela lagets samtal, säljaren sina egna — samma nyckel (crm.admin) som styr vad API:t
  // lämnar ut.
  const seesWholeTeam = useCan('crm.admin');
  const nextActions = buildOverviewActions({
    overdueTasks: summary.overdueTasks,
    todayTasks: summary.todayTasks,
    followUpCalls: summary.followUpCalls,
    newProspects: summary.newProspects,
    standaloneCalls: summary.standaloneCalls,
    quoteFollowUps: summary.quoteFollowUps,
    staleCalls: staleCalls({
      callsLast7Days: summary.callsLast7Days,
      lastVisibleCallAt: summary.lastVisibleCallAt,
      lastOwnCallAt: summary.lastOwnCallAt,
      seesWholeTeam,
    }),
    seesWholeTeam,
  });
  // Ur tavlan, inte summeringen: den bär läsarens veckomål. Fallerar summeringen står den kvar.
  const toStar = callsToStar(scoreboard?.sellers ?? [], userId);
  // Räknaren är listan, och listan räknas ur summeringen — utan summaryFailed här stod en nolla
  // ovanför felrutan, samma påstående som nyckeltalen döljs för.
  const showCount = !loading && !summaryFailed && nextActions.length > 0;

  return (
    <section aria-labelledby="overview-next-actions" className={crm.cardInner}>
      {/* Rubriken är kortets enda rad ovanför innehållet. Den bar förut en kicker med versaler
          ("ATT AGERA PÅ") ovanför "Nästa fokus" — två rubriker för ett kort. */}
      <div className="mb-3 flex items-center gap-2">
        <h2 id="overview-next-actions" className={cn('m-0', crm.cardTitle)}>Att agera på</h2>
        {/* Antalet rader nedanför — alla visas, så siffran är det man ser. Badge:ns accent är
            repots antalsmarkör ("framhävning, inte status"); statuspillren bor i crmTokens. */}
        {showCount ? (
          <Badge variant="accent" className="py-0 tabular-nums">
            <span aria-hidden="true">{nextActions.length}</span>
            <span className="sr-only">{nextActions.length === 1 ? 'en sak att agera på' : `${nextActions.length} saker att agera på`}</span>
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        {!loading && toStar ? <CallsToStarNudge name={toStar.name} remaining={toStar.remaining} /> : null}
        {loading ? <OverviewLoadingRows /> : null}
        {/* "Läget är lugnt" räknas fram ur summeringens nollor. Fallerar den är listan tom av
            fel skäl, och lugnbeskedet blir sidans farligaste påstående. */}
        {!loading && summaryFailed ? <SectionError /> : null}
        {!loading && !summaryFailed && nextActions.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Läget är lugnt — inget blockerande i CRM-flödet just nu.
          </div>
        ) : null}
        {!loading && !summaryFailed ? nextActions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 no-underline transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="grid min-w-0 gap-0.5">
              <strong className={crm.bodyStrong}>{action.title}</strong>
              <p className="m-0 text-xs leading-snug text-slate-500">{action.description}</p>
            </div>
            <span className={cn('mt-0.5 shrink-0 text-xs', crm.link)}>Öppna →</span>
          </Link>
        )) : null}
      </div>
    </section>
  );
}
