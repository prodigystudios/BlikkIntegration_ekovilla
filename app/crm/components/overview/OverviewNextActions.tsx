"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import { buildOverviewActions } from './overviewActions';
import { OverviewLoadingRows, SectionError } from './OverviewStates';

export default function OverviewNextActions({ loading, summaryFailed, summary }: {
  loading: boolean;
  summaryFailed: boolean;
  summary: CrmOverviewSummary;
}) {
  const nextActions = buildOverviewActions({ overdueTasks: summary.overdueTasks, followUpCalls: summary.followUpCalls, newProspects: summary.newProspects, standaloneCalls: summary.standaloneCalls, quoteFollowUps: summary.quoteFollowUps });

  /* Next actions. Kortet är medvetet tight: det tar högst tre rader (buildOverviewActions
      kapar där) och allt som ligger under det — offert- och orderkorten — ska synas utan
      att man scrollar förbi en rubrik med luft omkring sig. */
  return (
    <div className={crm.cardInner}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className={cn('mb-0.5', crm.sectionTitle)}>Att agera på</p>
          <h2 className={cn('m-0', crm.cardTitle)}>Nästa fokus</h2>
        </div>
        {/* Räknaren är nextActions.length, och den listan räknas fram ur summeringen — utan
            summaryFailed här stod "0 prioriterade" ovanför felrutan, samma påstående som
            nyckeltalen och statusbilden döljs för. */}
        {/* Vanlig text, inget piller. Sidan bar 69 runda piller i fyra olika betydelser —
            status, antal, poäng och rang — alla i samma form och grad, så inget skilde dem
            åt. Pillret är nu reserverat för STATUS; antal och rang är text. */}
        {!loading && !summaryFailed && (
          <span className={cn('shrink-0', crm.meta)}>
            {nextActions.length} {nextActions.length === 1 ? 'prioriterad' : 'prioriterade'}
          </span>
        )}
      </div>
      {loading ? <OverviewLoadingRows /> : null}
      {/* "Läget är lugnt" räknas fram ur summeringens nollor. Fallerar den är listan tom av
          fel skäl, och lugnbeskedet blir sidans farligaste påstående. */}
      {!loading && summaryFailed ? <SectionError /> : null}
      {!loading && !summaryFailed && nextActions.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Läget är lugnt — inget blockerande i CRM-flödet just nu.
        </div>
      ) : null}
      {!loading && nextActions.length > 0 ? (
        <div className="grid gap-1.5">
          {nextActions.map((action) => (
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
          ))}
        </div>
      ) : null}
    </div>
  );
}
