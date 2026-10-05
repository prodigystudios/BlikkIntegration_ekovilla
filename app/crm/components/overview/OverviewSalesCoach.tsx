"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { quoteCustomerName } from '@/app/crm/lib/quoteDisplay';
import { getCrmOverviewWindow } from '@/lib/domains/crm/goals';
import type { WaitingQuote } from '@/lib/domains/crm/overviewSummary';
import { formatCurrency, formatQuoteDay } from './overviewFormat';
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
// Mockupen sa "som väntat 6 dagar". Det går inte att säga: ingen tidpunkt för när en offert
// skickades finns, och offertdatumet sätts när den skapas. Kortet säger därför "daterad".
//
// Visas bara för den som får skriva i CRM (anroparen avgör): coachens API kräver crm.write, och en
// konsult säljer inte.
export default function OverviewSalesCoach({ loading, failed, quote }: {
  loading: boolean;
  /** Summeringen ELLER bara tipsfrågan gick inte att läsa — i båda fallen vet kortet inget. */
  failed: boolean;
  quote: WaitingQuote | null;
}) {
  return (
    <section aria-labelledby="overview-sales-coach" className={cn(crm.cardInner, 'grid content-start gap-3')}>
      <h2 id="overview-sales-coach" className={cn('m-0', crm.cardTitle)}>Säljcoach</h2>
      {loading ? <TipSkeleton /> : failed ? <SectionError /> : quote ? (
        <p className="m-0 text-sm leading-relaxed text-slate-700">
          {/* Kundnamnet djuplänkar till offerten. Beloppet är netto, som resten av översikten, och
              säger det: kunden kan ha en offert inklusive moms framför sig. */}
          Offerten till{' '}
          <Link href={`/crm/offerter?quote_id=${quote.id}`} className={cn('font-semibold', crm.link)}>{quoteCustomerName(quote)}</Link>
          {' '}på {formatCurrency(quote.netAmount, quote.currencyCode)} exkl. moms, daterad{' '}
          {formatQuoteDay(quote.quoteDate, getCrmOverviewWindow().today)}, väntar fortfarande på svar. Ring i dag.
        </p>
      ) : (
        // Inte "ingen offert väntar": offerter från i dag, med uppföljning framåt eller som gått ut
        // räknas inte hit, och de kan finnas.
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Ingen offert att ringa om i dag. Säljcoachen hjälper dig förbereda nästa samtal.
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
