"use client";

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import Badge from '@/components/ui/Badge';
import type { SalesReport } from '@/lib/domains/crm/reports';
import type { PeriodMetricKey } from '@/lib/domains/crm/reportGoals';
import { goalPercent, previousPercentChange } from '@/lib/domains/crm/reportGoals';
import {
  ExportButton,
  KpiCard,
  KpiNote,
  MetricComparison,
  MetricGoal,
  PERIOD_METRIC_LABELS,
  ScopeChip,
  SectionCard,
  Unavailable,
  downloadCsv,
  formatCount,
  formatCurrency,
  formatMonthLong,
  formatPercent,
  formatRangeLabel,
  comparisonSubtitle,
  goalSubtitle,
  goalsApply,
} from '../reportUi';
import SalesTrendChart from './SalesTrendChart';

// Översikt: "Hur går det?" Sex nyckeltal, trenden och det som väntar på en åtgärd (spec 2026-10-07).
// Ersätter dagens "Perioden i korthet" och "Försäljning över tid".
//
// ⚠️ KORT MÄRKTA "NU" FÖLJER INTE PERIODEN. Orderstocken och de öppna offerterna är läget just nu, och
// står på samma rad som periodens tal — utan märket hade de lästs som periodens.

function dayLabel(day: string) {
  return formatRangeLabel(day, day);
}

export default function OverviewTab({ report, periodLabel }: { report: SalesReport; periodLabel: string }) {
  const summary = report.periodSummary;
  const metric = (key: PeriodMetricKey) => summary.metrics.find((m) => m.key === key)!;
  const invoiced = metric('invoicedValue');
  const orderValue = metric('orderValue');
  const orders = metric('orders');
  const quoteValue = metric('quoteValue');
  const quotes = metric('quotes');
  const apply = goalsApply(summary);
  const goalProps = { apply, daysCovered: summary.goalDaysCovered, daysTotal: summary.goalDaysTotal };

  const overview = report.overview;
  const hitRate = overview?.hitRate ?? null;
  const stock = overview?.orderStock ?? null;
  const open = overview?.openQuotes ?? null;
  const period = <ScopeChip>{periodLabel}</ScopeChip>;
  const now = <ScopeChip now>Nu</ScopeChip>;

  const exportCards = () => downloadCsv(
    `nyckeltal_${report.range.from}_${report.range.to}.csv`,
    ['Tal', 'Utfall', 'Föregående period', 'Förändring (%)', 'Mål', 'Måluppfyllnad (%)'],
    [
      ...summary.metrics.map((m) => {
        const change = previousPercentChange(m);
        const attainment = goalPercent(m);
        return [
          PERIOD_METRIC_LABELS[m.key],
          m.actual,
          // Tomt, inte 0: en nolla i exporten hade lästs som ett uppmätt värde.
          m.previous ?? '',
          change == null ? '' : Math.round(change),
          m.target ?? '',
          attainment == null ? '' : Math.round(attainment),
        ];
      }),
      ['Hit rate (%)', hitRate?.percent == null ? '' : Math.round(hitRate.percent), hitRate?.previous?.percent == null ? '' : Math.round(hitRate.previous.percent), '', '', ''],
      ['Orderstock, nu', stock ? Math.round(stock.value) : '', '', '', '', ''],
      ['Öppna offerter, nu', open ? Math.round(open.value) : '', '', '', '', ''],
    ],
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionCard
        title="Nyckeltal"
        subtitle={[
          comparisonSubtitle(summary),
          goalSubtitle(summary),
          'Kort märkta Nu visar läget just nu och följer inte perioden.',
        ].join(' ')}
        action={<ExportButton onClick={exportCards} />}
      >
        {/* Tre i bredd, inte sex: krontalen blir sexsiffriga och ett kort per kolumn hade brutit
            siffran över två rader på en vanlig laptop. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Fakturerat"
            scope={period}
            value={formatCurrency(invoiced.actual)}
            definition="Fakturor skapade i perioden, exklusive moms. En delfakturerad order räknas per runda, på rundans eget datum."
          >
            <MetricComparison metric={invoiced} />
            <MetricGoal metric={invoiced} {...goalProps} />
          </KpiCard>

          <KpiCard
            label="Orderingång"
            scope={period}
            value={formatCurrency(orderValue.actual)}
            definition="Värdet på order skapade i perioden, exklusive moms. Avbrutna order räknas inte."
          >
            <KpiNote>
              {orders.actual > 0
                ? `${formatCount(orders.actual)} order · snitt ${formatCurrency(orderValue.actual / orders.actual)}`
                : 'Inga order i perioden'}
            </KpiNote>
            <MetricComparison metric={orderValue} />
            <MetricGoal metric={orderValue} {...goalProps} extra={orders.target ? `mål ${formatCount(orders.target)} order` : null} />
          </KpiCard>

          <KpiCard
            label="Offerter"
            scope={period}
            value={formatCurrency(quoteValue.actual)}
            definition="Alla offerter daterade i perioden, oavsett status, exklusive moms. Utkast räknas med, eftersom status inte alltid ändras till Skickad."
          >
            <KpiNote>
              {formatCount(quotes.actual)} offerter
              {overview ? `, varav ${formatCount(overview.quoteDrafts)} utkast` : ''}
            </KpiNote>
            <MetricComparison metric={quoteValue} />
            <MetricGoal metric={quoteValue} {...goalProps} extra={quotes.target ? `mål ${formatCount(quotes.target)} offerter` : null} />
          </KpiCard>

          <KpiCard
            label="Hit rate"
            scope={period}
            value={hitRate ? formatPercent(hitRate.percent) : '–'}
            muted={!hitRate || hitRate.percent == null}
            definition={
              <>
                Andelen av periodens offerter som blivit order. Nämnaren är alla offerter, även utkast,
                förlorade och utgångna. Vunnen sätts automatiskt när en order skapas från offerten, så talet
                kan bli för lågt men aldrig för högt: order som skapats utan offert räknas inte. Talet är
                preliminärt tills periodens offerter är 30 dagar gamla — 98 % av vinsterna registreras inom
                30 dagar.
              </>
            }
          >
            {!hitRate ? (
              <Unavailable />
            ) : (
              <>
                <KpiNote>
                  {formatCount(hitRate.won)} av {formatCount(hitRate.quotes)} vunna
                  {hitRate.valuePercent != null ? ` · ${formatPercent(hitRate.valuePercent)} i kronor` : ''}
                </KpiNote>
                {hitRate.preliminary ? (
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-slate-600">
                    <Badge variant="info" className="px-1.5 py-0.5 text-[11px]">Preliminärt</Badge>
                    <span>offerter efter {dayLabel(hitRate.matureThrough)} är yngre än 30 dagar</span>
                  </div>
                ) : hitRate.previous?.percent != null && hitRate.percent != null ? (
                  <HitRateComparison current={hitRate.percent} previous={hitRate.previous.percent} />
                ) : (
                  <div className="text-[12px] text-slate-500">Ingen jämförelse</div>
                )}
              </>
            )}
          </KpiCard>

          <KpiCard
            label="Orderstock"
            scope={now}
            value={stock ? formatCurrency(stock.value) : '–'}
            muted={!stock}
            definition="Det som återstår att fakturera på alla order som varken är avbrutna eller helt fakturerade. På en delfakturerad order räknas bara det som är kvar. Veckotalet mäter mot förra hela månadens fakturering."
          >
            {!stock ? (
              <Unavailable />
            ) : (
              <>
                <KpiNote>{formatCount(stock.count)} order</KpiNote>
                <KpiNote>
                  {stock.weeks != null && stock.basis
                    ? `≈ ${formatCount(Math.round(stock.weeks))} veckor i faktureringstakten från ${formatMonthLong(stock.basis.range.from.slice(0, 7))}`
                    : stock.basis
                      ? `Inget fakturerat i ${formatMonthLong(stock.basis.range.from.slice(0, 7))}, så inget veckotal`
                      : 'Veckotalet kunde inte räknas'}
                </KpiNote>
              </>
            )}
          </KpiCard>

          <KpiCard
            label="Öppna offerter"
            scope={now}
            value={open ? formatCurrency(open.value) : '–'}
            muted={!open}
            definition="Offerter med status Utkast, Skickad eller Uppföljning, oavsett giltighetstid. En offert som passerat giltighetstiden är inte förlorad — statusen kan vara ouppdaterad, så den räknas som öppen tills säljaren ändrar den."
          >
            {!open ? (
              <Unavailable />
            ) : (
              <>
                <KpiNote>{formatCount(open.count)} offerter, varav {formatCount(open.drafts)} utkast</KpiNote>
                <KpiNote>
                  {open.expired.count > 0
                    ? `${formatCurrency(open.expired.value)} har passerat giltighetstiden`
                    : 'Ingen har passerat giltighetstiden'}
                </KpiNote>
              </>
            )}
          </KpiCard>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <SectionCard
            title="Offerter, orderingång och fakturerat per månad"
            subtitle={report.trend
              ? `${formatMonthLong(report.trend.points[0]?.period ?? '')} till ${formatMonthLong(report.trend.points.at(-1)?.period ?? '')}, oavsett vald period. Exklusive moms. Målet visas på hela månader med budget.`
              : undefined}
            action={report.trend ? (
              <ExportButton onClick={() => downloadCsv(
                `trend_${report.trend!.range.from}_${report.trend!.range.to}.csv`,
                ['Månad', 'Offerter (ex moms)', 'Orderingång (ex moms)', 'Fakturerat (ex moms)', 'Mål offerter', 'Mål orderingång', 'Mål fakturerat', 'Delmånad'],
                report.trend!.points.map((p) => [
                  p.period,
                  p.quoteValue,
                  p.orderValue,
                  p.invoicedValue,
                  p.goals.quoteValue ?? '',
                  p.goals.orderValue ?? '',
                  p.goals.invoicedValue ?? '',
                  p.partial ? `${p.partial.from} – ${p.partial.to}` : '',
                ]),
              )} />
            ) : undefined}
          >
            {report.trend ? <SalesTrendChart trend={report.trend} /> : <Unavailable />}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <ActionList report={report} />
        </div>
      </div>
    </div>
  );
}

/** Hit rate mot föregående period, i procentenheter — inte procent av procent. */
function HitRateComparison({ current, previous }: { current: number; previous: number }) {
  const diff = Math.round(current) - Math.round(previous);
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      {diff === 0 ? (
        <span className="font-semibold text-slate-600">Oförändrat</span>
      ) : (
        <span className={cn('font-semibold tabular-nums', diff < 0 ? 'text-rose-700' : 'text-emerald-700')}>
          {diff < 0 ? '↓' : '↑'} {Math.abs(diff)} procentenheter
        </span>
      )}
      <span className="text-slate-500">mot {formatPercent(previous)}</span>
    </div>
  );
}

// ── Kräver åtgärd ────────────────────────────────────────────────────────────
//
// ⚠️ PÅMINNELSER, INTE SLUTSATSER (Williams beslut 2026-10-07). Skickad, Förlorad, Utkast och passerad
// giltighetstid beror på att säljaren uppdaterar, och rapporten drar inga slutsatser av dem. Raderna
// ber om en statusändring; ingen av dem påstår att en affär är förlorad.
//
// Raderna leder till listorna utan filter: listorna tar inte emot statusfilter i adressen, och nya
// listfilter byggs inte i det här projektet utan att William fått frågan.

function ActionRow({ count, title, note, amount, href }: { count: number | null; title: string; note: string; amount: string | null; href: string }) {
  const quiet = count === 0;
  return (
    <li className="border-t border-[#dde6d9] first:border-t-0">
      <Link
        href={href}
        className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-2.5 transition hover:bg-[#f1f5ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]"
      >
        <span className={cn('text-right text-base font-bold tabular-nums', quiet ? 'text-slate-400' : 'text-slate-900')}>
          {count == null ? '–' : formatCount(count)}
        </span>
        <span className="min-w-0">
          <span className={cn('block text-[13px] font-semibold', quiet ? 'text-slate-500' : 'text-slate-800')}>{title}</span>
          <span className="block text-[12px] text-slate-500">{note}</span>
        </span>
        <span className={cn('whitespace-nowrap text-[13px] font-semibold tabular-nums', quiet ? 'text-slate-400' : 'text-slate-800')}>
          {amount ?? ''}
        </span>
      </Link>
    </li>
  );
}

function ActionList({ report }: { report: SalesReport }) {
  const open = report.overview?.openQuotes ?? null;
  const stock = report.overview?.orderStock ?? null;
  const unavailable = 'Kunde inte räknas.';

  const rows: ReactNode[] = [
    <ActionRow
      key="expired"
      count={open?.expired.count ?? null}
      title="Har passerat giltighetstiden"
      note={open
        ? `${formatCount(open.expired.sent)} skickade och ${formatCount(open.expired.drafts)} utkast. Uppdatera status: vunnen, förlorad eller förnyad.`
        : unavailable}
      amount={open ? formatCurrency(open.expired.value) : null}
      href="/crm/offerter"
    />,
    <ActionRow
      key="drafts"
      count={open?.draftsWithinValidity.count ?? null}
      title="Utkast inom giltighetstiden"
      note={open ? 'Har de skickats? Uppdatera status.' : unavailable}
      amount={open ? formatCurrency(open.draftsWithinValidity.value) : null}
      href="/crm/offerter"
    />,
    <ActionRow
      key="no-follow-up"
      count={open?.missingFollowUpDate.count ?? null}
      title="Saknar uppföljningsdatum"
      note={open ? `Av ${formatCount(open.missingFollowUpDate.of)} skickade eller markerade för uppföljning.` : unavailable}
      amount={null}
      href="/crm/offerter"
    />,
    <ActionRow
      key="overdue"
      count={open?.overdueFollowUps.count ?? null}
      title="Försenade uppföljningar"
      note={open ? 'Uppföljningsdatumet har passerat.' : unavailable}
      amount={open ? formatCurrency(open.overdueFollowUps.value) : null}
      href="/crm/offerter"
    />,
    <ActionRow
      key="completed"
      count={stock?.completed.count ?? null}
      title="Klara men inte fakturerade"
      note={stock ? 'Order med status Klar.' : unavailable}
      amount={stock ? formatCurrency(stock.completed.value) : null}
      href="/crm/arbetsorder"
    />,
  ];

  return (
    <SectionCard
      title="Kräver åtgärd"
      subtitle="Läget just nu, oavsett vald period. Påminnelser om att uppdatera status — inget här betyder att en affär är förlorad."
      action={<ScopeChip now>Nu</ScopeChip>}
    >
      <ul className="m-0 list-none p-0">{rows}</ul>
    </SectionCard>
  );
}
