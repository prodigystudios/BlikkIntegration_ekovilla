"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { WaitingQuote } from '@/lib/domains/crm/overviewSummary';
import { formatCurrency } from './overviewFormat';
import { SectionError } from './OverviewStates';

function TipSkeleton() {
  return (
    <div className="grid gap-1.5" aria-hidden="true">
      <div className="h-4 w-11/12 animate-pulse rounded bg-[#dfe6da]" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-[#e6ece2]" />
    </div>
  );
}

// Säljcoachen på översikten. REGELSTYRD, med flit: inget AI-anrop när sidan laddas. Tipset räknas
// fram ur läsarens äldsta väntande offert (oldestWaitingQuote i summeringen) och kostar inget, syns
// direkt och märks därför "Säljcoach", inte "AI". Knappen leder till /crm/coach, där AI:n finns.
//
// Visas bara för den som får skriva i CRM (anroparen avgör): coachens API kräver crm.write, och en
// konsult säljer inte.
export default function OverviewSalesCoach({ loading, summaryFailed, quote }: {
  loading: boolean;
  summaryFailed: boolean;
  quote: WaitingQuote | null;
}) {
  return (
    <section aria-labelledby="overview-sales-coach" className={cn(crm.cardInner, 'grid content-start gap-3')}>
      <h2 id="overview-sales-coach" className={cn('m-0', crm.cardTitle)}>Säljcoach</h2>
      {loading ? <TipSkeleton /> : summaryFailed ? <SectionError /> : quote ? (
        <p className="m-0 text-sm leading-relaxed text-slate-700">
          {/* Kundnamnet djuplänkar till offerten, som raderna i offertlistan nedanför. */}
          <Link href={`/crm/offerter?quote_id=${quote.id}`} className={cn('font-semibold', crm.link)}>{quote.customerName}</Link>
          {' '}har en offert på {formatCurrency(quote.netAmount, quote.currencyCode)} som väntat{' '}
          {quote.waitingDays === 1 ? 'en dag' : `${quote.waitingDays} dagar`}. Ring i dag.
        </p>
      ) : (
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Ingen av dina offerter väntar på svar just nu. Säljcoachen hjälper dig förbereda nästa samtal.
        </p>
      )}
      <div>
        <Link href="/crm/coach" className={cn(crm.primaryButton, 'bg-[color:var(--ek-green)] no-underline')}>
          Öppna Säljcoach
        </Link>
      </div>
    </section>
  );
}
