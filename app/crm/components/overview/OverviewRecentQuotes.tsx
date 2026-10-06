"use client";

import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { documentRef, formatDate } from '@/app/crm/lib/format';
import { quoteCustomerName } from '@/app/crm/lib/quoteDisplay';
import { netAmount } from '@/lib/domains/crm/pricing';
import { formatCurrency, stockholmDateISO } from './overviewFormat';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { recentWidth } from './OverviewRecentTable';
import { RecentCard } from './OverviewStates';
import type { QuoteItem } from './overviewTypes';

// Postens adress — kundlänken och radklicket går dit, så den står en gång.
const quoteHref = (quote: QuoteItem) => `/crm/offerter?quote_id=${quote.id}`;

const COLUMNS: Array<CrmTableColumn<QuoteItem>> = [
  // Numret via documentRef: Fortnox-numret först, det interna bara som reserv.
  { header: 'Offertnr', className: recentWidth.number, cell: (quote) => documentRef(quote.fortnox_offer_number, quote.quote_number) },
  // "Kund", inte mockupens "Företag": privatkunder står här också, och i CRM:et betyder Företag
  // kundtypen. Djuplänkar till offerten (?quote_id=) — ett klick ska landa på posten.
  {
    header: 'Kund',
    className: recentWidth.name,
    cell: (quote) => <CustomerCell href={quoteHref(quote)} customer={quoteCustomerName(quote)} project={quote.project_name} />,
  },
  // Netto, som resten av översikten. `amount` är bruttot (subtotal + moms).
  { header: 'Exkl. moms', className: recentWidth.amount, cell: (quote) => formatCurrency(netAmount(quote), quote.currency_code) },
  // Listan är sorterad på senaste ändring (updated_desc), så datumet är ändringens — offertdatumet
  // hade sett osorterat ut. Svensk kalenderdag, i CRM:ets datumformat.
  { header: 'Ändrad', className: recentWidth.date, cell: (quote) => formatDate(stockholmDateISO(quote.updated_at)) },
  {
    header: 'Status',
    className: recentWidth.status,
    cell: (quote) => {
      // CHECK-villkoret i 20260526095837_crm_quotes.sql och ruttens Zod-enum gör en okänd status
      // omöjlig i dag. Men en oguardad uppslagning kastar under render och släcker HELA översikten
      // den dag någon lägger till en sjätte status utan att unionen följer med.
      const status = quoteStatusMeta[quote.status];
      return <span className={cn(crm.badge, status?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{status?.label ?? quote.status}</span>;
    },
  },
];

export default function OverviewRecentQuotes({ loading, failed, quotes }: {
  loading: boolean;
  failed: boolean;
  quotes: QuoteItem[];
}) {
  return (
    <RecentCard title="Senaste offerter" href="/crm/offerter" loading={loading} failed={failed}>
      {quotes.length === 0 ? <EmptyState description="Inga offerter ännu." /> : (
        <CrmTable size="compact" label="Senaste offerter" columns={COLUMNS} rows={quotes} rowHref={quoteHref} />
      )}
    </RecentCard>
  );
}
