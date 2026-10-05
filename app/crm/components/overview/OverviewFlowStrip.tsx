"use client";

import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';
import { MONEY_NOTE, formatCurrency } from './overviewFormat';
import type { OverviewFigures } from './useCrmOverviewData';

// De tre lagerstegen, i den ordning pengarna rör sig. Tonerna är varumärkets egen ramp
// (globals.css): djupast först, eftersom djupare läser som mer och steg ett bär mest.
const FLOW_STAGES: Array<{
  label: string;
  tone: string;
  value: (s: CrmOverviewSummary) => number;
  helper: (s: CrmOverviewSummary) => string;
}> = [
  { label: 'Offert', tone: 'var(--crm-flow-1)', value: (s) => s.activeQuoteValue, helper: (s) => `${s.activeQuotes} st` },
  { label: 'Order', tone: 'var(--crm-flow-2)', value: (s) => s.openOrderValue, helper: (s) => `${s.openWorkOrders} st` },
  { label: 'Att fakturera', tone: 'var(--crm-flow-3)', value: (s) => s.toInvoiceOrderValue, helper: (s) => `${s.workOrdersToInvoice} st` },
];

// Delad nämnare för de tre staplarna: den största av dem. Utan den mäter varje stapel mot sig
// själv och fördelningen — hela poängen med remsan — går inte att läsa.
function flowWidth(value: number, scale: number) {
  if (scale <= 0 || value <= 0) return 0;
  return Math.min(100, (value / scale) * 100);
}

export default function OverviewFlowStrip({ loading, summaryFailed, summary }: {
  loading: boolean;
  summaryFailed: boolean;
  summary: OverviewFigures;
}) {
  /* Signaturen: VAR PENGARNA STÅR.

      Här låg fyra frikopplade nyckeltalskort. Fyra tal bredvid varandra utan gemensam
      nämnare säger bara sina egna belopp — att 3,8 Mkr står i offert medan 899 tkr blivit
      order är det intressanta, och det gick inte att läsa. Statusbilden hade en gång den
      läsningen via flowScale; den försvann när lagerraderna flyttade hit i steg C, och det
      här är den tillbaka i en form som faktiskt syns.

      De tre stegen delar nämnare (den största av dem), så staplarna är jämförbara. Färgen
      kommer ur varumärkets egen ramp — samma gröna som sidoskenan — inte ur Tailwinds
      emerald/teal/sky, som inte hörde ihop med något.

      ⚠️ Fakturerat i veckan står AVSKILT och utan stapel, med flit: de tre till vänster är
      lager (pengar som står någonstans just nu), fakturerat är ett FLÖDE över en vecka. Att
      lägga det i samma nämnare hade jämfört två olika sorters tal.

      Dolt under 640 px — på telefon går man in för att se en offert eller order, inte för
      att läsa statistik — och dolt när summeringen fallerat, eftersom EMPTY_SUMMARY:s nollor
      betyder "vi vet inte", inte "noll". */
  /* Skelettets höjd är MÄTT mot det renderade kortet (135 px i Chrome). Gissade 116 gav ett
      19 px hopp vid varje laddning och varje Uppdatera. */
  return loading || !summaryFailed ? (
    <div className="hidden sm:block">
      {loading ? (
        <div className="h-[135px] animate-pulse rounded-2xl border border-[#e0e8dc] bg-[#dfe6da]" />
      ) : (
        <div className={crm.cardInner}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {/* Kortets namn ligger en nivå över kolumnetiketterna. Bar båda samma kicker-stil
                lästes de två nivåerna som en enda. */}
            <h2 className={cn('m-0', crm.cardTitle)}>Var pengarna står</h2>
            <p className={cn('m-0', crm.meta)}>{MONEY_NOTE}</p>
          </div>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            {FLOW_STAGES.map((stage) => {
              const value = stage.value(summary);
              return (
                <div key={stage.label} className="min-w-0">
                  <p className={cn('m-0', crm.sectionTitle)}>{stage.label}</p>
                  <p className={cn('m-0 mt-1 truncate', crm.display)}>{formatCurrency(value, 'SEK')}</p>
                  {/* Stapeln direkt under sitt tal. Låg den under hjälpraden lästes den som
                      kolumnens fot i stället för som beloppets mått. */}
                  <div className="mt-2 h-1 rounded-full" style={{ backgroundColor: 'var(--crm-track)' }} aria-hidden="true">
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{ width: `${flowWidth(value, summary.flowScale)}%`, backgroundColor: stage.tone }}
                    />
                  </div>
                  <p className={cn('m-0 mt-1', crm.meta)}>{stage.helper(summary)}</p>
                </div>
              );
            })}
            {/* Flödet, inte lagret — därför avskilt av en linje och utan stapel. */}
            <div className="min-w-0 xl:border-l xl:border-[#e0e8dc] xl:pl-6">
              <p className={cn('m-0', crm.sectionTitle)}>Fakturerat</p>
              <p className={cn('m-0 mt-1 truncate', crm.display)}>{formatCurrency(summary.weekTeam.invoicedValue, 'SEK')}</p>
              {/* Ingen stapel — se kommentaren ovan om lager mot flöde. Marginalen matchar
                  stegens stapelhöjd så baslinjerna ligger i linje. */}
              <p className={cn('m-0 mt-[16px]', crm.meta)}>denna vecka</p>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;
}
