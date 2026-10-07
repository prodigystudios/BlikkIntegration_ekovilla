"use client";

import { useMemo, type ReactNode } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@/lib/shared/cn';
import Badge from '@/components/ui/Badge';
import type { SalesReport } from '@/lib/domains/crm/reports';
// Bara typer ur domänen: reportKpis.ts drar in serverkod, och en körtidsimport hade tagit med den i
// klientpaketet. Allt som ska räknas räknas i rutten — fotnoten bär säljarraden själv (lateEntry).
import type { HitRate, QuoteAgeKey, TypicalOrder } from '@/lib/domains/crm/reportKpis';
import {
  BarList,
  BarRow,
  COLOR_ORDER,
  COLOR_QUOTE,
  EmptyChart,
  ExportButton,
  KpiCard,
  KpiNote,
  MetricComparison,
  MetricGoal,
  MiniStat,
  ScopeChip,
  SectionCard,
  Unavailable,
  downloadCsv,
  formatCompact,
  formatCount,
  formatCurrency,
  formatMonthLong,
  formatPercent,
  formatRangeLabel,
  comparisonSubtitle,
  goalSubtitle,
  goalsApply,
} from '../reportUi';
import HitRateMonthChart from './HitRateMonthChart';

// Försäljning: "Hur säljer vi?" (spec 2026-10-07, 4.3). Nyckeltalen, hit rate per offertmånad och per
// kundtyp, de öppna offerternas ålder och säljartabellen med hit rate. Konverteringstratten är borta —
// hit rate ersätter den.
//
// Samtal, antal offerter och antal order stod i "Perioden i korthet", som Översikten ersätter. De står
// här med sin jämförelse och sina mål så att ingenting försvinner. Samtalen hör hemma här och inte
// bland Översiktens kort (beslut 4, 2026-10-07: för få loggas än för att vara ett huvudtal).
//
// ⚠️ HIT RATE BYGGER BARA PÅ VUNNEN, som systemet sätter när ordern skapas från offerten. Skickad,
// Förlorad och Utkast beror på säljaren, och fliken drar inga slutsatser av dem.

const AGE_LABELS: Record<QuoteAgeKey, string> = {
  '0-14': '0–14 dagar',
  '15-30': '15–30 dagar',
  '31-60': '31–60 dagar',
  'over-60': 'Över 60 dagar',
};

function dayLabel(day: string) {
  return formatRangeLabel(day, day);
}

/** "Preliminärt — offerter efter 7 sep är yngre än 30 dagar", på samma sätt som Översiktens hit rate. */
function PreliminaryNote({ matureThrough }: { matureThrough: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-slate-600">
      <Badge variant="info" className="px-1.5 py-0.5 text-[11px]">Preliminärt</Badge>
      <span>offerter efter {dayLabel(matureThrough)} är yngre än 30 dagar</span>
    </div>
  );
}

function TypicalOrderFigure({ label, typical }: { label: string; typical: TypicalOrder }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <span className="text-[12px] font-semibold text-slate-500">{label}</span>
      <span className={cn('text-2xl font-bold tabular-nums', typical.median == null ? 'text-slate-400' : 'text-slate-900')}>
        {typical.median == null ? '–' : formatCurrency(typical.median)}
      </span>
      <span className="text-[12px] font-normal text-slate-600">
        {typical.mean == null
          ? 'Inga order i perioden'
          : `snitt ${formatCurrency(typical.mean)} · ${formatCount(typical.count)} order`}
      </span>
    </div>
  );
}

function hitRateRow(key: string, label: ReactNode, rate: HitRate, striped: boolean) {
  return (
    <BarRow
      key={key}
      label={label}
      sub={rate.quotes > 0 ? `${formatCount(rate.won)} av ${formatCount(rate.quotes)} vunna` : 'Inga offerter'}
      share={rate.percent}
      value={formatPercent(rate.percent)}
      extra={rate.valuePercent != null ? `${formatPercent(rate.valuePercent)} i kr` : null}
      striped={striped}
    />
  );
}

export default function SalesTab({ report, periodLabel }: { report: SalesReport; periodLabel: string }) {
  const summary = report.periodSummary;
  const calls = summary.metrics.find((m) => m.key === 'calls')!;
  const quotes = summary.metrics.find((m) => m.key === 'quotes')!;
  const orders = summary.metrics.find((m) => m.key === 'orders')!;
  const goalProps = { apply: goalsApply(summary), daysCovered: summary.goalDaysCovered, daysTotal: summary.goalDaysTotal };

  const hitRate = report.overview?.hitRate ?? null;
  const open = report.overview?.openQuotes ?? null;
  const sales = report.sales;
  const months = sales?.hitRateByMonth ?? null;
  const byType = sales?.hitRateByCustomerType ?? null;
  const period = <ScopeChip>{periodLabel}</ScopeChip>;

  const sellerChartData = useMemo(
    () => report.perSeller.slice(0, 12).map((s) => ({ name: s.userName, Ordervärde: s.orderValue, Offertvärde: s.quoteValue })),
    [report],
  );
  const lateEntry = report.perSeller.some((s) => s.lateEntry);
  const ageMax = open ? Math.max(0, ...open.byAge.map((bucket) => bucket.value)) : 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionCard
        title="Nyckeltal"
        subtitle={[comparisonSubtitle(summary), goalSubtitle(summary)].join(' ')}
      >
        {/* Sex spalter: aktiviteten (tre antal med jämförelse och mål) på första raden, utfallet på
            andra. Den typiska ordern behöver bredden för sina två kundtyper. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="grid lg:col-span-2">
            <KpiCard
              label="Offerter"
              scope={period}
              value={`${formatCount(quotes.actual)} st`}
              definition="Alla offerter daterade i perioden, oavsett status. Utkast räknas med."
            >
              {report.overview ? <KpiNote>varav {formatCount(report.overview.quoteDrafts)} utkast</KpiNote> : null}
              <MetricComparison metric={quotes} />
              <MetricGoal metric={quotes} {...goalProps} />
            </KpiCard>
          </div>
          <div className="grid lg:col-span-2">
            <KpiCard
              label="Order"
              scope={period}
              value={`${formatCount(orders.actual)} st`}
              definition="Order skapade i perioden. Avbrutna order räknas inte."
            >
              <MetricComparison metric={orders} />
              <MetricGoal metric={orders} {...goalProps} />
            </KpiCard>
          </div>
          <div className="grid lg:col-span-2">
            <KpiCard
              label="Samtal"
              scope={period}
              value={`${formatCount(calls.actual)} st`}
              definition="Samtal loggade i CRM:et i perioden, mot lagets samtalsmål."
            >
              <MetricComparison metric={calls} />
              <MetricGoal metric={calls} {...goalProps} />
            </KpiCard>
          </div>
          <div className="grid lg:col-span-3">
            <KpiCard
              label="Vunna"
              scope={period}
              value={hitRate ? formatCurrency(hitRate.wonValue) : '–'}
              muted={!hitRate}
              definition="Periodens offerter som blivit order, exklusive moms. Vunnen sätts automatiskt när en order skapas från offerten — samma offerter som hit rate räknas på."
            >
              {!hitRate ? (
                <Unavailable />
              ) : (
                <>
                  <KpiNote>{formatCount(hitRate.won)} av {formatCount(hitRate.quotes)} offerter</KpiNote>
                  {hitRate.preliminary ? <PreliminaryNote matureThrough={hitRate.matureThrough} /> : null}
                </>
              )}
            </KpiCard>
          </div>
          <div className="grid sm:col-span-2 lg:col-span-3">
            <KpiCard
              label="Typisk order"
              scope={period}
              value={sales ? (
                <div className="grid grid-cols-2 gap-4">
                  <TypicalOrderFigure label="Företag" typical={sales.typicalOrder.business} />
                  <TypicalOrderFigure label="Privat" typical={sales.typicalOrder.private} />
                </div>
              ) : '–'}
              muted={!sales}
              definition="Medianen av ordervärdet för order skapade i perioden, per kundtyp och exklusive moms: hälften av ordrarna är större, hälften mindre. Snittet dras upp av några stora jobb och står därför under. Avbrutna order räknas inte."
            >
              {!sales ? <Unavailable /> : null}
            </KpiCard>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <SectionCard
            title="Hit rate per offertmånad"
            subtitle={months && months.length > 0
              ? `${formatMonthLong(months[0].period)} till ${formatMonthLong(months[months.length - 1].period)}, oavsett vald period. Andelen av månadens offerter som blivit order.`
              : undefined}
            action={months ? (
              <ExportButton onClick={() => downloadCsv(
                `hit-rate-per-manad_${months[0]?.period ?? ''}_${months.at(-1)?.period ?? ''}.csv`,
                ['Offertmånad', 'Offerter', 'Vunna', 'Hit rate (%)', 'Hit rate i kronor (%)', 'Preliminär', 'Delmånad'],
                months.map((m) => [
                  m.period,
                  m.quotes,
                  m.won,
                  // Tomt, inte 0: en månad utan offerter har ingen hit rate.
                  m.percent == null ? '' : Math.round(m.percent),
                  m.valuePercent == null ? '' : Math.round(m.valuePercent),
                  m.preliminary ? 'ja' : 'nej',
                  m.partial ? `${m.partial.from} – ${m.partial.to}` : '',
                ]),
              )} />
            ) : undefined}
          >
            {months ? <HitRateMonthChart months={months} /> : <Unavailable />}

            <div className="mt-5 grid gap-3 border-t border-[#dde6d9] pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 flex-1 text-[13px] font-semibold text-slate-800">Per kundtyp</p>
                {period}
              </div>
              {byType ? (
                <>
                  {byType.preliminary ? <PreliminaryNote matureThrough={byType.matureThrough} /> : null}
                  <BarList>
                    {hitRateRow('business', 'Företag', byType.business, byType.preliminary)}
                    {hitRateRow('private', 'Privat', byType.private, byType.preliminary)}
                    {hitRate ? hitRateRow('total', <span className="font-semibold text-slate-800">Alla</span>, hitRate, hitRate.preliminary) : null}
                  </BarList>
                </>
              ) : (
                <Unavailable />
              )}
              <p className="m-0 text-[12px] leading-relaxed text-slate-500">
                Hit rate är vunna delat med alla offerter, även utkast, förlorade och utgångna. Vunnen sätts
                automatiskt när en order skapas från offerten, så talet kan bli för lågt men aldrig för högt:
                order som skapats utan offert räknas inte. 98 % av vinsterna registreras inom 30 dagar.
              </p>
            </div>
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <SectionCard
            title="Öppna offerter efter ålder"
            subtitle="Dagar sedan offertdatumet, utkast inräknade. Läget just nu, oavsett vald period. Exklusive moms."
            action={<ScopeChip now>Nu</ScopeChip>}
          >
            {!open ? (
              <Unavailable />
            ) : (
              <div className="grid gap-4">
                <BarList>
                  {open.byAge.map((bucket) => (
                    <BarRow
                      key={bucket.key}
                      label={AGE_LABELS[bucket.key]}
                      share={ageMax > 0 ? (bucket.value / ageMax) * 100 : 0}
                      value={formatCurrency(bucket.value)}
                      extra={`${formatCount(bucket.count)} st`}
                    />
                  ))}
                </BarList>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <MiniStat value={`${formatCount(open.expired.count)} st`}>
                    har passerat giltighetstiden, {formatCurrency(open.expired.value)}. Uppdatera status: vunnen, förlorad eller förnyad.
                  </MiniStat>
                  <MiniStat value={`${formatCount(open.missingFollowUpDate.count)} st`}>
                    av {formatCount(open.missingFollowUpDate.of)} skickade eller markerade för uppföljning saknar uppföljningsdatum.
                  </MiniStat>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Per säljare"
        subtitle={[
          'Aktivitet och värde per säljare — ordervärde för det som skapades i perioden, fakturerat för det som fakturerades under den. Ex moms.',
          'Hit rate är säljarens vunna delat med alla säljarens offerter i perioden.',
          hitRate?.preliminary ? `Preliminär: offerter efter ${dayLabel(hitRate.matureThrough)} är yngre än 30 dagar.` : '',
        ].filter(Boolean).join(' ')}
        action={<ExportButton onClick={() => downloadCsv(
          `per-saljare_${report.range.from}_${report.range.to}.csv`,
          ['Säljare', 'Samtal', 'Offerter', 'Offertvärde (ex moms)', 'Vunna (antal)', 'Vunnet värde (ex moms)', 'Hit rate (%)', 'Antal order', 'Ordervärde (ex moms)', 'Fakturerat (ex moms)'],
          report.perSeller.map((s) => [
            s.userName, s.calls, s.quotes, s.quoteValue, s.won, s.wonValue,
            s.hitRate == null ? '' : Math.round(s.hitRate),
            s.orders, s.orderValue, s.invoicedValue,
          ]),
        )} />}
      >
        {report.perSeller.length === 0 ? <EmptyChart /> : (
          <div className="grid gap-5">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sellerChartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#64748b' }} width={56} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Offertvärde" fill={COLOR_QUOTE} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ordervärde" fill={COLOR_ORDER} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    <th className="py-2 pr-3">Säljare</th>
                    <th className="py-2 px-3 text-right">Samtal</th>
                    <th className="py-2 px-3 text-right">Offerter</th>
                    <th className="py-2 px-3 text-right">Offertvärde</th>
                    <th className="py-2 px-3 text-right">Hit rate</th>
                    <th className="py-2 px-3 text-right">Order</th>
                    <th className="py-2 px-3 text-right">Ordervärde</th>
                    <th className="py-2 pl-3 text-right">Fakturerat</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perSeller.map((s) => (
                    <tr key={s.userId} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 pr-3 font-medium text-slate-800">{s.userName}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{s.calls}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{s.quotes}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{formatCurrency(s.quoteValue)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                        {formatPercent(s.hitRate)}
                        {/* Platsen hålls på varje rad, så att talen står i linje med eller utan fotnot. */}
                        <span className="ml-0.5 inline-block w-1.5 text-left font-bold text-amber-800" aria-hidden="true">{s.lateEntry ? '*' : ''}</span>
                        {s.lateEntry ? <span className="sr-only">, se fotnoten</span> : null}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600">{s.orders}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{formatCurrency(s.orderValue)}</td>
                      <td className="py-2 pl-3 text-right font-semibold text-slate-800">{formatCurrency(s.invoicedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lateEntry ? (
              <p className="m-0 text-[12px] text-slate-500">
                <span className="font-bold text-amber-800">*</span> Hit rate 95 % eller mer: offerten läggs troligen in först när affären är klar.
              </p>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
