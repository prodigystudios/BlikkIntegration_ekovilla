"use client";

import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { SalesReport } from '@/lib/domains/crm/reports';
import {
  COLOR_INVOICED,
  COLOR_ORDER,
  COLOR_QUOTE,
  EmptyChart,
  ExportButton,
  KpiCard,
  KpiNote,
  MetricComparison,
  MetricGoal,
  ScopeChip,
  SectionCard,
  downloadCsv,
  formatCompact,
  formatCount,
  formatCurrency,
  formatRangeLabel,
  goalSubtitle,
  goalsApply,
  percent,
} from '../reportUi';

// Försäljning: "Hur säljer vi?" Per säljare och konverteringen flyttade hit oförändrade (spec
// 2026-10-07). Försäljningens egna nyckeltal och hit rate kommer i nästa steg, då tratten tas bort.
//
// Samtal och antal offerter stod i "Perioden i korthet", som Översikten ersätter. De står här med sina
// mål så att ingenting försvinner — samtalen hör hemma under Försäljning och inte bland Översiktens
// kort (beslut 4, 2026-10-07: för få loggas än för att vara ett huvudtal).

export default function SalesTab({ report, periodLabel }: { report: SalesReport; periodLabel: string }) {
  const summary = report.periodSummary;
  const calls = summary.metrics.find((m) => m.key === 'calls')!;
  const quotes = summary.metrics.find((m) => m.key === 'quotes')!;
  const goalProps = { apply: goalsApply(summary), daysCovered: summary.goalDaysCovered, daysTotal: summary.goalDaysTotal };

const sellerChartData = useMemo(
  () => (report?.perSeller || []).slice(0, 12).map((s) => ({ name: s.userName, Ordervärde: s.orderValue, Offertvärde: s.quoteValue })),
  [report],
);
const funnelStages = useMemo(() => {
  if (!report) return [];
  const f = report.funnel;
  return [
    { key: 'quotes', label: 'Offerter', count: f.quotes.count, value: f.quotes.value, color: COLOR_QUOTE, conv: null as string | null },
    { key: 'won', label: 'Vunna offerter', count: f.won.count, value: f.won.value, color: '#10b981', conv: percent(f.won.count, f.quotes.count) },
    { key: 'orders', label: 'Arbetsorder', count: f.orders.count, value: f.orders.value, color: COLOR_ORDER, conv: percent(f.orders.count, f.won.count) },
    { key: 'invoiced', label: 'Fakturerat', count: f.invoiced.count, value: f.invoiced.value, color: COLOR_INVOICED, conv: percent(f.invoiced.count, f.orders.count) },
  ];
}, [report]);
const funnelMaxValue = useMemo(() => Math.max(1, ...funnelStages.map((s) => s.value)), [funnelStages]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionCard
        title="Aktivitet"
        subtitle={[
          summary.previousRange
            ? `Jämfört med lika lång period dessförinnan (${formatRangeLabel(summary.previousRange.from, summary.previousRange.to)}).`
            : 'Ingen jämförelseperiod kunde räknas fram.',
          goalSubtitle(summary),
        ].join(' ')}
      >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          label="Offerter"
          scope={<ScopeChip>{periodLabel}</ScopeChip>}
          value={`${formatCount(quotes.actual)} st`}
          definition="Alla offerter daterade i perioden, oavsett status. Utkast räknas med."
        >
          {report.overview ? <KpiNote>varav {formatCount(report.overview.quoteDrafts)} utkast</KpiNote> : null}
          <MetricComparison metric={quotes} />
          <MetricGoal metric={quotes} {...goalProps} />
        </KpiCard>
        <KpiCard
          label="Samtal"
          scope={<ScopeChip>{periodLabel}</ScopeChip>}
          value={`${formatCount(calls.actual)} st`}
          definition="Samtal loggade i CRM:et i perioden, mot lagets samtalsmål."
        >
          <MetricComparison metric={calls} />
          <MetricGoal metric={calls} {...goalProps} />
        </KpiCard>
      </div>
      </SectionCard>

      {/* 2. Per säljare */}
      <SectionCard
        title="Per säljare"
        subtitle="Aktivitet och värde per säljare — ordervärde för det som skapades i perioden, fakturerat för det som fakturerades under den. Ex moms."
        action={<ExportButton onClick={() => downloadCsv(
          `per-saljare_${report.range.from}_${report.range.to}.csv`,
          ['Säljare', 'Samtal', 'Offerter', 'Offertvärde (ex moms)', 'Vunnet värde (ex moms)', 'Antal order', 'Ordervärde (ex moms)', 'Fakturerat (ex moms)'],
          report.perSeller.map((s) => [s.userName, s.calls, s.quotes, s.quoteValue, s.wonValue, s.orders, s.orderValue, s.invoicedValue]),
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
              <table className="w-full min-w-[700px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    <th className="py-2 pr-3">Säljare</th>
                    <th className="py-2 px-3 text-right">Samtal</th>
                    <th className="py-2 px-3 text-right">Offerter</th>
                    <th className="py-2 px-3 text-right">Offertvärde</th>
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
                      <td className="py-2 px-3 text-right text-slate-600">{s.orders}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{formatCurrency(s.orderValue)}</td>
                      <td className="py-2 pl-3 text-right font-semibold text-slate-800">{formatCurrency(s.invoicedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* 3. Konvertering (funnel) */}
      <SectionCard
        title="Konvertering"
        subtitle="Offert → vunnen → arbetsorder → fakturerat, för det som skapades i perioden — faktureringen kan ha skett senare. Ex moms."
        action={<ExportButton onClick={() => downloadCsv(
          `konvertering_${report.range.from}_${report.range.to}.csv`,
          ['Steg', 'Antal', 'Värde (ex moms)', 'Konvertering'],
          funnelStages.map((s) => [s.label, s.count, s.value, s.conv ?? '']),
        )} />}
      >
        <div className="grid gap-3">
          {funnelStages.map((stage) => (
            <div key={stage.key} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800">{stage.label}</span>
                <span className="text-slate-500">
                  <strong className="text-slate-800">{stage.count}</strong> st · {formatCurrency(stage.value)}
                  {stage.conv ? <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{stage.conv}</span> : null}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full transition-all" style={{ width: `${Math.max(2, (stage.value / funnelMaxValue) * 100)}%`, backgroundColor: stage.color }} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
