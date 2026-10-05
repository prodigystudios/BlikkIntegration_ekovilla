"use client";

import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { formatCurrency } from './overviewFormat';
import { RecentCard } from './OverviewStates';
import type { QuoteItem } from './overviewTypes';

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getQuoteCustomerName(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name || item.customer_name || 'Okänd kund';
}

export default function OverviewRecentQuotes({ loading, failed, quotes }: {
  loading: boolean;
  failed: boolean;
  quotes: QuoteItem[];
}) {
  return (
    <RecentCard title="Senaste offertlägen" href="/crm/offerter" loading={loading} failed={failed}>
      {quotes.length === 0 ? <EmptyState description="Inga offertsteg registrerade ännu." /> : (
        <div className="grid gap-2">
          {quotes.map((quote) => {
            // CHECK-villkoret i 20260526095837_crm_quotes.sql och ruttens Zod-enum gör en
            // okänd status omöjlig i dag. Men en oguardad uppslagning kastar under render
            // och släcker HELA översikten den dag någon lägger till en sjätte status utan
            // att unionen följer med — och den här grenen finns för att sidan inte ska
            // släckas. Samma försiktighet som CustomerDetailClient.tsx:669.
            const status = quoteStatusMeta[quote.status];
            return (
              <Link key={quote.id} href={`/crm/offerter?quote_id=${quote.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                <div className="min-w-0">
                  <strong className={cn('block truncate', crm.bodyStrong)}>{quote.project_name}</strong>
                  <p className={cn('m-0 truncate', crm.meta)}>{getQuoteCustomerName(quote)} · {formatCurrency(quote.amount, quote.currency_code)}</p>
                </div>
                <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', status?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{status?.label ?? quote.status}</span>
              </Link>
            );
          })}
        </div>
      )}
    </RecentCard>
  );
}
