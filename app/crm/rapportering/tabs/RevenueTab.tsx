"use client";

import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@/lib/shared/cn';
import type { SalesReport } from '@/lib/domains/crm/reports';
// Bara typer ur domänen: reportRevenue.ts drar in serverkod, och en körtidsimport hade tagit med den i
// klientpaketet. Allt räknas i rutten.
import type { CustomerSegment, StockStageKey } from '@/lib/domains/crm/reportRevenue';
import {
  BarList,
  BarRow,
  COLOR_INVOICED,
  COLOR_ORDER,
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
  formatDecimal,
  formatMonth,
  formatMonthLong,
  formatPercent,
  formatRangeLabel,
  comparisonSubtitle,
  goalSubtitle,
  goalsApply,
} from '../reportUi';
import InvoicedByMonthChart from './InvoicedByMonthChart';

// Omsättning: "Vad kommer in, vad ligger kvar?" (spec 2026-10-07, 4.4). Nyckeltalen, fakturerat per
// månad, orderstocken efter läge, ordervärdet per kundsegment och kunderna — sedan topplistan per kund
// och lönsamheten, som flyttade hit oförändrade.

const STAGE_LABELS: Record<StockStageKey, { label: string; sub?: string }> = {
  draft: { label: 'Ej planerad' },
  scheduled: { label: 'Planerad' },
  in_progress: { label: 'Pågår' },
  partially_invoiced: { label: 'Delfakturerad', sub: 'det som är kvar' },
  completed: { label: 'Klar att fakturera' },
};

const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  private: 'Privatkunder',
  construction: 'Byggföretag',
  real_estate: 'Fastighetsbolag',
  builders_merchant: 'Bygghandel',
  house_manufacturer: 'Hustillverkare',
  other: 'Övriga branscher',
  unknown: 'Bransch okänd',
};

// Lönsamhetens två serier. Egna hues, inte återbruk av försäljningens tre: teal betyder offertvärde
// på samma sida, och samma färg för två olika saker i samma vy är hur man bygger in en felläsning.
// Paret är kontrollerat mot kortytan (#f9fbf7) — ΔE 19,7 i deuteranopi, 20,7 i normalseende, båda
// över 3:1 i kontrast.
const COLOR_TG1 = '#0284c7'; // sky — täckningsgrad efter material
const COLOR_TG2 = '#15803d'; // green — täckningsgrad efter arbete

/**
 * Periodens täckningsgrad som ett tal, med kronorna och täckningen under.
 *
 * ⚠️ TÄCKNINGEN STÅR ALLTID UTSKRIVEN ("14 av 19 fakturerade jobb"). Ett procenttal utan den raden
 * läses som hela perioden, och de jobb som saknar underlag försvinner tyst ur bedömningen. TG1 och
 * TG2 har dessutom olika täckning — materialet är ofta klart medan tiden inte är rapporterad — så
 * de två raderna säger sällan samma sak.
 *
 * ⚠️ INGA TRÖSKLAR, av samma skäl som på arbetsordern: offertens 25/40 gäller förkalkylen och TG2
 * ligger per definition lägre. Bara ett negativt tal färgas.
 */
function MarginStat({ label, percent, amount, jobs, total, color }: {
  label: string; percent: number | null; amount: number; jobs: number; total: number; color: string;
}) {
  return (
    <div className="rounded-xl border border-[#e0e8dc] bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      </div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', percent == null ? 'text-slate-400' : percent < 0 ? 'text-rose-700' : 'text-slate-900')}>
        {percent == null ? '–' : `${percent.toFixed(1).replace('.', ',')} %`}
      </div>
      {/* ⚠️ KRONORNA BARA NÄR DET FINNS EN PROCENT. Utan villkoret stod "0 kr" under strecket på en
          period där ingen tid rapporterats — ett påstående om att täckningsbidraget VAR noll, när
          sanningen är att det inte går att räkna. Samma fel som "ej rapporterat" kontra "0 st". */}
      {percent == null ? null : (
        <div className="mt-0.5 text-sm tabular-nums text-slate-600">{formatCurrency(amount)}</div>
      )}
      <div className="mt-1 text-[11px] text-slate-500">
        {jobs} av {total} fakturerade jobb
      </div>
    </div>
  );
}

export default function RevenueTab({ report, periodLabel }: { report: SalesReport; periodLabel: string }) {
  const summary = report.periodSummary;
  const invoiced = summary.metrics.find((m) => m.key === 'invoicedValue')!;
  const goalProps = { apply: goalsApply(summary), daysCovered: summary.goalDaysCovered, daysTotal: summary.goalDaysTotal };
  const revenue = report.revenue;
  const period = <ScopeChip>{periodLabel}</ScopeChip>;
  const now = <ScopeChip now>Nu</ScopeChip>;
  const stockMax = revenue?.stockByStage ? Math.max(0, ...revenue.stockByStage.map((s) => s.value)) : 0;
  const stockTotal = revenue?.stockByStage ? revenue.stockByStage.reduce((t, s) => t + s.value, 0) : 0;
  const stockCount = revenue?.stockByStage ? revenue.stockByStage.reduce((t, s) => t + s.count, 0) : 0;
  const segmentMax = revenue ? Math.max(0, ...revenue.segments.map((s) => s.orderValue)) : 0;

  // En period inom en kalendermånad blir en enda månadspunkt; den namnges då efter perioden.
  const singlePoint = report.profitability.overTime.length === 1;
  // Samma etikettregel som sidans övriga månadsserier, så kurvorna går att läsa mot varandra.
  const marginChartData = useMemo(
    () => (report?.profitability.overTime || []).map((p) => ({
      ...p,
      label: singlePoint
        ? formatRangeLabel(report.range.from, report.range.to)
        : formatMonth(p.period),
    })),
    [report, singlePoint],
  );
  // Both series, same as the per-seller chart: a customer billed this period on an older
  // order has no order value, and plotting order value alone would draw it as a labelled
  // empty bar.
  const customerChartData = useMemo(
    () => (report?.perCustomer || []).slice(0, 8).map((c) => ({
      name: c.customer,
      Ordervärde: c.orderValue,
      Fakturerat: c.invoicedValue,
    })),
    [report],
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionCard
        title="Nyckeltal"
        subtitle={[comparisonSubtitle(summary), goalSubtitle(summary), 'Exklusive moms. Avbrutna order räknas inte.'].join(' ')}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Fakturerat"
            scope={period}
            value={formatCurrency(invoiced.actual)}
            definition="Fakturor skapade i perioden, exklusive moms. En delfakturerad order räknas per runda, på rundans eget datum. Andelen privat följer orderns kundtyp."
          >
            {revenue?.invoiced.privateShare != null ? <KpiNote>{formatPercent(revenue.invoiced.privateShare)} till privatkunder</KpiNote> : null}
            <MetricComparison metric={invoiced} />
            <MetricGoal metric={invoiced} {...goalProps} />
          </KpiCard>

          <KpiCard
            label="Book-to-bill"
            scope={period}
            value={revenue?.bookToBill != null ? formatDecimal(revenue.bookToBill, 2) : '–'}
            muted={revenue?.bookToBill == null}
            definition="Orderingång delat med fakturerat i perioden. Över 1 kom det in mer än som fakturerades, under 1 fakturerades mer än som kom in."
          >
            {!revenue ? (
              <Unavailable />
            ) : revenue.bookToBill == null ? (
              <KpiNote>Inget fakturerat i perioden, så ingen kvot</KpiNote>
            ) : (
              <KpiNote>{revenue.bookToBill >= 1 ? 'Mer kom in än som fakturerades' : 'Mer fakturerades än som kom in'}</KpiNote>
            )}
            {revenue?.bookToBillPrevious != null ? (
              <div className="text-[12px] text-slate-500">Föregående period {formatDecimal(revenue.bookToBillPrevious, 2)}</div>
            ) : revenue ? (
              <div className="text-[12px] text-slate-500">Ingen jämförelse</div>
            ) : null}
          </KpiCard>

          <KpiCard
            label="Order till faktura"
            scope={period}
            value={revenue?.leadTime.median != null ? `${formatDecimal(revenue.leadTime.median, 1, 0)} dagar` : '–'}
            muted={revenue?.leadTime.median == null}
            definition="Dagar från att ordern skapades till att den slutfakturerades, median över order slutfakturerade i perioden. En delfakturerad order mäts till sista rundan. Räknat i svenska kalenderdagar."
          >
            {!revenue ? (
              <Unavailable />
            ) : revenue.leadTime.mean == null ? (
              <KpiNote>Inga order slutfakturerades i perioden</KpiNote>
            ) : (
              <KpiNote>median · snitt {formatDecimal(revenue.leadTime.mean, 1, 0)} dagar · {formatCount(revenue.leadTime.count)} order</KpiNote>
            )}
          </KpiCard>

          <KpiCard
            label="ROT-andel"
            scope={period}
            value={revenue?.rot.share != null ? formatPercent(revenue.rot.share) : '–'}
            muted={revenue?.rot.share == null}
            definition="Privatorder skapade i perioden med ROT-avdrag ikryssat, delat med alla privatorder skapade i perioden. Beloppet är ROT-ordrarnas ordervärde, exklusive moms."
          >
            {!revenue ? (
              <Unavailable />
            ) : revenue.rot.privateOrders === 0 ? (
              <KpiNote>Inga privatorder i perioden</KpiNote>
            ) : (
              <KpiNote>{formatCount(revenue.rot.withRot)} av {formatCount(revenue.rot.privateOrders)} privatorder · {formatCurrency(revenue.rot.value)}</KpiNote>
            )}
          </KpiCard>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <SectionCard
            title="Fakturerat per månad"
            subtitle={revenue?.invoicedByMonth && revenue.invoicedByMonth.length > 0
              ? `${formatMonthLong(revenue.invoicedByMonth[0].period)} till ${formatMonthLong(revenue.invoicedByMonth[revenue.invoicedByMonth.length - 1].period)}, oavsett vald period. Företag och privat efter orderns kundtyp. Exklusive moms.`
              : undefined}
            action={revenue?.invoicedByMonth ? (
              <ExportButton onClick={() => downloadCsv(
                `fakturerat-per-manad_${revenue.invoicedByMonth![0]?.period ?? ''}_${revenue.invoicedByMonth!.at(-1)?.period ?? ''}.csv`,
                ['Månad', 'Företag (ex moms)', 'Privat (ex moms)', 'Totalt (ex moms)', 'Delmånad'],
                revenue.invoicedByMonth!.map((m) => [
                  m.period, m.business, m.private, m.business + m.private,
                  m.partial ? `${m.partial.from} – ${m.partial.to}` : '',
                ]),
              )} />
            ) : undefined}
          >
            {revenue?.invoicedByMonth ? <InvoicedByMonthChart months={revenue.invoicedByMonth} /> : <Unavailable />}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <SectionCard
            title="Orderstock efter läge"
            subtitle="Det som återstår att fakturera, i arbetsflödets ordning. Läget just nu, oavsett vald period. Exklusive moms."
            action={now}
          >
            {!revenue?.stockByStage ? (
              <Unavailable />
            ) : (
              <div className="grid gap-3">
                <BarList>
                  {revenue.stockByStage.map((stage) => (
                    <BarRow
                      key={stage.key}
                      label={STAGE_LABELS[stage.key].label}
                      sub={STAGE_LABELS[stage.key].sub}
                      share={stockMax > 0 ? (stage.value / stockMax) * 100 : 0}
                      value={formatCurrency(stage.value)}
                      extra={`${formatCount(stage.count)} st`}
                    />
                  ))}
                </BarList>
                <p className="m-0 text-[12px] text-slate-500">
                  Totalt {formatCurrency(stockTotal)} på {formatCount(stockCount)} order — samma tal som Översiktens orderstock.
                </p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <SectionCard
            title="Ordervärde per kundsegment"
            subtitle="Order skapade i perioden. Företagens bransch kommer från kundkortets SNI-kod (kreditupplysningen). Exklusive moms."
            action={revenue ? (
              <ExportButton onClick={() => downloadCsv(
                `kundsegment_${report.range.from}_${report.range.to}.csv`,
                ['Segment', 'Ordervärde (ex moms)', 'Order', 'Kunder'],
                revenue.segments.map((s) => [SEGMENT_LABELS[s.segment], s.orderValue, s.orders, s.customers]),
              )} />
            ) : undefined}
          >
            {!revenue ? (
              <Unavailable />
            ) : revenue.segments.every((s) => s.orders === 0) ? (
              <EmptyChart />
            ) : (
              <BarList>
                {revenue.segments.map((segment) => (
                  <BarRow
                    key={segment.segment}
                    label={SEGMENT_LABELS[segment.segment]}
                    sub={`${formatCount(segment.orders)} order · ${formatCount(segment.customers)} kunder`}
                    share={segmentMax > 0 ? (segment.orderValue / segmentMax) * 100 : 0}
                    value={formatCurrency(segment.orderValue)}
                  />
                ))}
              </BarList>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <SectionCard
            title="Kunder"
            subtitle="Hur beroende perioden är av ett fåtal kunder. En kund är kundkortet, eller kundnamnet när ordern saknar kundkort."
            action={period}
          >
            {!revenue ? (
              <Unavailable />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <MiniStat value={formatCount(revenue.customers.customers)}>kunder har fått en order i perioden</MiniStat>
                <MiniStat value={revenue.customers.recurring == null ? '–' : formatCount(revenue.customers.recurring)}>
                  {revenue.customers.recurring == null
                    ? 'återkommande kunder kunde inte räknas'
                    : 'av dem är återkommande — minst två order sedan start'}
                </MiniStat>
                <MiniStat value={formatPercent(revenue.customers.top5Share)}>av ordervärdet kommer från de 5 största</MiniStat>
                <MiniStat value={formatPercent(revenue.customers.top10Share)}>från de 10 största</MiniStat>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Per kund"
        subtitle="Topplista kunder på ordervärde och fakturerat i perioden. Ex moms."
        action={<ExportButton onClick={() => downloadCsv(
          `per-kund_${report.range.from}_${report.range.to}.csv`,
          ['Kund', 'Antal order', 'Ordervärde (ex moms)', 'Fakturerat (ex moms)'],
          report.perCustomer.map((c) => [c.customer, c.orderCount, c.orderValue, c.invoicedValue]),
        )} />}
      >
        {report.perCustomer.length === 0 ? <EmptyChart /> : (
          <div className="grid gap-5">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={customerChartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" />
                  <XAxis type="number" tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={140} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Ordervärde" fill={COLOR_ORDER} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Fakturerat" fill={COLOR_INVOICED} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    <th className="py-2 pr-3">Kund</th>
                    <th className="py-2 px-3 text-right">Order</th>
                    <th className="py-2 px-3 text-right">Ordervärde</th>
                    <th className="py-2 pl-3 text-right">Fakturerat</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perCustomer.map((c) => (
                    <tr key={c.customer} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 pr-3 font-medium text-slate-800">{c.customer}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{c.orderCount}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{formatCurrency(c.orderValue)}</td>
                      <td className="py-2 pl-3 text-right font-semibold text-slate-800">{formatCurrency(c.invoicedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Lönsamhet — vad som blev kvar av det som fakturerades */}
      <SectionCard
        title="Lönsamhet"
        subtitle="Täckningsgrad på jobb som slutfakturerades i perioden, räknad på rapporterade säckar och rapporterad tid. Bara jobb med komplett underlag räknas."
        action={<ExportButton onClick={() => downloadCsv(
          `lonsamhet_${report.range.from}_${report.range.to}.csv`,
          [singlePoint ? 'Period' : 'Månad', 'TG1 efter material (%)', 'TG2 efter arbete (%)'],
          report.profitability.overTime.map((p) => [
            singlePoint ? `${report.range.from} – ${report.range.to}` : p.period,
            p.tg1 ?? '', p.tg2 ?? '',
          ]),
        )} />}
      >
        {/* Tre olika tomma lägen, med tre olika svar. Att slå ihop dem gör beskedet till ett
            påstående om personalen även när felet ligger i systemet eller när det helt enkelt
            inte fanns något att mäta. */}
        {report.profitability.unavailable ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-800">
            Täckningsgraden kunde inte räknas. Kontrollera att kalkylinställningarna finns —
            övriga siffror på sidan är opåverkade.
          </div>
        ) : report.profitability.jobs === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            Inga jobb slutfakturerades i perioden.
          </div>
        ) : report.profitability.jobsTb1 === 0 && report.profitability.jobsTb2 === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            Inget av periodens {report.profitability.jobs} fakturerade jobb har komplett underlag
            än. Täckningsgraden kräver att egenkontrollen är inlämnad och tiden rapporterad.
          </div>
        ) : (
          <div className="grid gap-5">
            {/* Talen först, kurvan sedan: det är periodens siffra man kommer hit för, och
                månadsserien är hur den blev till. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <MarginStat
                label="TG1 efter material"
                percent={report.profitability.tg1}
                amount={report.profitability.tb1}
                jobs={report.profitability.jobsTb1}
                total={report.profitability.jobs}
                color={COLOR_TG1}
              />
              <MarginStat
                label="TG2 efter arbete"
                percent={report.profitability.tg2}
                amount={report.profitability.tb2}
                jobs={report.profitability.jobsTb2}
                total={report.profitability.jobs}
                color={COLOR_TG2}
              />
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {/* EN axel, båda serierna i procent. Två y-skalor hade gjort det omöjligt att
                    se att TG2 alltid ligger under TG1 — vilket är hela poängen med att visa
                    dem tillsammans. */}
                <LineChart data={marginChartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tickFormatter={(v) => `${v} %`} tick={{ fontSize: 12, fill: '#64748b' }} width={56} />
                  <Tooltip
                    formatter={(value) => `${Number(value).toFixed(1).replace('.', ',')} %`}
                    labelStyle={{ color: '#0f172a' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* connectNulls={false}: en månad utan räknebara jobb ska bryta linjen, inte
                      dras rakt igenom som om täckningsgraden gick jämnt däremellan.

                      ⚠️ PUNKTER ALLTID, till skillnad från försäljningsserien som bara sätter
                      dem när hela intervallet är en månad. Här är luckorna normala — TG2 kan ha
                      data i EN månad av tolv — och en linje genom en ensam punkt ritar
                      ingenting. Serien fanns i legenden men syntes inte i diagrammet. */}
                  <Line type="monotone" dataKey="tg1" name="TG1 efter material" stroke={COLOR_TG1} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
                  <Line type="monotone" dataKey="tg2" name="TG2 efter arbete" stroke={COLOR_TG2} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
