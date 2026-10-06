"use client";

import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import { MONEY_NOTE, formatCurrency } from './overviewFormat';
import type { OverviewFigures } from './useCrmOverviewData';

// De tre lagerstegen, i den ordning pengarna rör sig. Tonerna är varumärkets egen ramp
// (globals.css): djupast först, eftersom djupare läser som mer och steg ett bär mest.
const STOCK_CARDS: Array<{
  label: string;
  tone: string;
  value: (s: CrmOverviewSummary) => number;
  helper: (s: CrmOverviewSummary) => string;
}> = [
  { label: 'Offert', tone: 'var(--crm-flow-1)', value: (s) => s.activeQuoteValue, helper: (s) => `${s.activeQuotes} st` },
  { label: 'Order', tone: 'var(--crm-flow-2)', value: (s) => s.openOrderValue, helper: (s) => `${s.openWorkOrders} st` },
  { label: 'Att fakturera', tone: 'var(--crm-flow-3)', value: (s) => s.toInvoiceOrderValue, helper: (s) => `${s.workOrdersToInvoice} st` },
];

// Delad nämnare för de tre linjerna: den största av dem. Utan den mäter varje linje mot sig själv
// och fördelningen — att 3,8 Mkr står i offert medan 899 tkr blivit order — går inte att läsa.
function stockWidth(value: number, scale: number) {
  if (scale <= 0 || value <= 0) return 0;
  return Math.min(100, (value / scale) * 100);
}

const cardClass = cn(crm.cardInner, 'relative min-w-0 overflow-hidden px-4 pb-3.5 pt-3');

// Etikett och antal till vänster, beloppet till höger — två rader i stället för tre. Blir kortet
// för smalt för båda (xl med fäst meny) bryts beloppet till en egen rad i stället för att klippas.
function CardBody({ label, value, helper, loading }: { label: string; value: number; helper: string; loading: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div>
        <p className="m-0 whitespace-nowrap text-xs font-semibold text-slate-600">{label}</p>
        {/* Skeletten står på talens platser, så kortet har sin höjd redan under laddningen och
            ingenting hoppar när siffrorna landar. */}
        {loading ? (
          <div className="mt-1 h-3.5 w-10 animate-pulse rounded bg-[#e6ece2]" />
        ) : (
          <p className={cn('m-0 mt-0.5', crm.meta)}>{helper}</p>
        )}
      </div>
      {loading ? (
        <div className="h-6 w-28 animate-pulse rounded-md bg-[#dfe6da]" />
      ) : (
        <p className={cn('m-0 min-w-0 truncate', crm.display)}>{formatCurrency(value, 'SEK')}</p>
      )}
    </div>
  );
}

// Fyra kort som i VD:ns mockup, men fördelningen från "Var pengarna står" lever kvar: de tre
// lagren delar nämnare och visar den som en tunn linje i kortets fot, i stället för som staplar
// mitt i innehållet. Linjen är dekor (aria-hidden) — beloppet står i klartext ovanför.
//
// ⚠️ Fakturerat har ingen linje, med flit: de tre andra är LAGER (pengar som står någonstans just
// nu), fakturerat är ett FLÖDE över en vecka. Samma nämnare hade jämfört två olika sorters tal.
//
// Dolt under 640 px — på telefon går man in för att se en offert eller order, inte för att läsa
// statistik — och dolt när summeringen fallerat, eftersom EMPTY_SUMMARY:s nollor betyder "vi vet
// inte", inte "noll". Felrutan under sidhuvudet säger vad som hänt.
export default function OverviewKpiCards({ loading, summaryFailed, summary }: {
  loading: boolean;
  summaryFailed: boolean;
  summary: OverviewFigures;
}) {
  if (!loading && summaryFailed) return null;

  return (
    <div className="hidden sm:block">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STOCK_CARDS.map((card) => {
          const value = card.value(summary);
          return (
            <div key={card.label} className={cardClass}>
              <CardBody label={card.label} value={value} helper={card.helper(summary)} loading={loading} />
              <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[color:var(--crm-track)]" aria-hidden="true">
                {loading ? null : (
                  <div
                    className="h-full transition-[width] duration-500"
                    style={{ width: `${stockWidth(value, summary.flowScale)}%`, backgroundColor: card.tone }}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div className={cardClass}>
          <CardBody label="Fakturerat" value={summary.weekTeam.invoicedValue} helper="denna vecka" loading={loading} />
        </div>
      </div>
      <p className={cn('m-0 mt-2 text-right', crm.meta)}>{MONEY_NOTE}</p>
    </div>
  );
}
