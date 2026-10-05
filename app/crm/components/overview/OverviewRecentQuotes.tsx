"use client";

import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { documentRef } from '@/app/crm/lib/format';
import { quoteCustomerName } from '@/app/crm/lib/quoteDisplay';
import { netAmount } from '@/lib/domains/crm/pricing';
import { formatCurrency, stockholmDay } from './overviewFormat';
import { RecentCard, RecentCell, RecentTable, recentColumn } from './OverviewStates';
import type { QuoteItem } from './overviewTypes';

const HEADERS = [
  { label: 'Offertnr', className: recentColumn.number },
  { label: 'Företag', className: recentColumn.name },
  { label: 'Exkl. moms', className: recentColumn.amount },
  // Listan är sorterad på senaste ändring (updated_desc), så datumet är ändringens — en kolumn
  // "Datum" med offertdatumet hade sett osorterad ut.
  { label: 'Ändrad', className: recentColumn.date },
  { label: 'Status', className: recentColumn.status },
];

export default function OverviewRecentQuotes({ loading, failed, quotes }: {
  loading: boolean;
  failed: boolean;
  quotes: QuoteItem[];
}) {
  return (
    <RecentCard title="Senaste offerter" href="/crm/offerter" loading={loading} failed={failed}>
      {quotes.length === 0 ? <EmptyState description="Inga offerter ännu." /> : (
        <RecentTable label="Senaste offerter" headers={HEADERS}>
          {quotes.map((quote) => {
            // CHECK-villkoret i 20260526095837_crm_quotes.sql och ruttens Zod-enum gör en
            // okänd status omöjlig i dag. Men en oguardad uppslagning kastar under render
            // och släcker HELA översikten den dag någon lägger till en sjätte status utan
            // att unionen följer med. Samma försiktighet som CustomerDetailClient.tsx:669.
            const status = quoteStatusMeta[quote.status];
            return (
              <tr key={quote.id}>
                {/* Numret via documentRef: Fortnox-numret först, det interna bara som reserv. */}
                <RecentCell className={cn(recentColumn.number, 'truncate tabular-nums text-slate-500')}>
                  {documentRef(quote.fortnox_offer_number, quote.quote_number)}
                </RecentCell>
                {/* Namnet djuplänkar till offerten (?quote_id=), som raderna gjorde förut — ett klick
                    ska landa på posten, inte i en lista där man får leta upp den igen. */}
                <RecentCell className={recentColumn.name}>
                  <Link href={`/crm/offerter?quote_id=${quote.id}`} className={cn('font-semibold', crm.link)}>
                    {quoteCustomerName(quote)}
                  </Link>
                </RecentCell>
                {/* Netto, som resten av översikten. `amount` är bruttot (subtotal + moms). */}
                <RecentCell className={cn(recentColumn.amount, 'whitespace-nowrap tabular-nums')}>
                  {formatCurrency(netAmount(quote), quote.currency_code)}
                </RecentCell>
                <RecentCell className={cn(recentColumn.date, 'whitespace-nowrap tabular-nums text-slate-500')}>
                  {stockholmDay(quote.updated_at)}
                </RecentCell>
                <RecentCell className={recentColumn.status}>
                  <span className={cn(crm.badge, status?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{status?.label ?? quote.status}</span>
                </RecentCell>
              </tr>
            );
          })}
        </RecentTable>
      )}
    </RecentCard>
  );
}
