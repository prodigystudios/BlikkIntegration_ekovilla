"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';
import type { InvoicedMonth } from '@/lib/domains/crm/reportRevenue';
import {
  COLOR_PERIOD_BAND,
  formatCompact,
  formatCurrency,
  formatMonth,
  formatMonthLong,
  formatPercent,
  formatRangeLabel,
  PartialMonthsNote,
  PeriodBandLegend,
} from '../reportUi';

// Fakturerat per månad, staplat på företag och privat — de senaste tolv månaderna eller sedan start,
// samma fönster som trenden. ⚠️ FÖLJER INTE PERIODVÄLJAREN (Williams beslut 2026-10-07); den valda
// perioden markeras med samma band som i trenden.
//
// Två toner av fakturerat-violetten (#8b5cf6 på resten av sidan): fakturerat är fortfarande en färg,
// kundtypen skiljs på ljushet. Paret är validerat mot kortytan (dataviz-skillens validator: ΔE 20 i
// protanopi, 23 i normalseende). Den ljusa tonen har 2,6:1 mot kortet, under 3:1 — därför tabellvyn
// och mellanrummet mellan de staplade delarna. Tailwind-klasserna nedan har samma värden; recharts
// behöver dem som värden.
const COLOR_BUSINESS = '#6d28d9';
const COLOR_PRIVATE = '#a78bfa';
const CARD_SURFACE = '#f9fbf7';

type MonthDatum = InvoicedMonth & { label: string; total: number };

function InvoicedTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const datum = active ? (payload?.[0]?.payload as MonthDatum | undefined) : undefined;
  if (!datum) return null;
  const privateShare = datum.total > 0 ? (datum.private / datum.total) * 100 : null;
  return (
    <div className="grid min-w-[220px] gap-1 rounded-xl border border-[#dde6d9] bg-[#f9fbf7] px-3 py-2 text-[12px] text-slate-600 shadow-[0_10px_24px_rgba(20,44,27,0.14)]">
      <b className="font-semibold text-slate-900">
        {formatMonthLong(datum.period)}
        {datum.partial ? <span className="font-normal text-slate-500"> ({formatRangeLabel(datum.partial.from, datum.partial.to)})</span> : null}
      </b>
      {([['Företag', 'business', 'bg-[#6d28d9]'], ['Privat', 'private', 'bg-[#a78bfa]']] as const).map(([label, key, swatch]) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} aria-hidden="true" />
            {label}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(datum[key])}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-[#dde6d9] pt-1">
        <span>Totalt</span>
        <span className="font-semibold tabular-nums text-slate-900">
          {formatCurrency(datum.total)}
          {privateShare != null ? <span className="font-normal text-slate-500"> · {formatPercent(privateShare)} privat</span> : null}
        </span>
      </div>
    </div>
  );
}

export default function InvoicedByMonthChart({ months }: { months: InvoicedMonth[] }) {
  const data: MonthDatum[] = months.map((month) => ({
    ...month,
    label: `${formatMonth(month.period)}${month.partial ? '*' : ''}`,
    total: month.business + month.private,
  }));
  const inPeriod = data.filter((d) => d.inPeriod);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#6d28d9]" aria-hidden="true" />
          Företag
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#a78bfa]" aria-hidden="true" />
          Privat
        </span>
        {inPeriod.length > 0 ? (
          <PeriodBandLegend />
        ) : null}
      </div>

      <div
        className="h-64 w-full"
        role="img"
        aria-label={`Fakturerat per månad, företag och privat, ${formatMonthLong(data[0]?.period ?? '')} till ${formatMonthLong(data.at(-1)?.period ?? '')}. Siffrorna finns i tabellen under diagrammet.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cfdcc9' }} />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#64748b' }} width={52} tickLine={false} axisLine={false} />
            {inPeriod.length > 0 ? (
              <ReferenceArea x1={inPeriod[0].label} x2={inPeriod[inPeriod.length - 1].label} fill={COLOR_PERIOD_BAND} fillOpacity={1} />
            ) : null}
            <Tooltip content={(props) => <InvoicedTooltip active={props.active} payload={props.payload} />} cursor={{ fill: 'rgba(26,63,38,0.06)' }} />
            {/* Kortets färg som kant ger 2 px mellanrum mellan de staplade delarna — två ljushetsnivåer av
                samma ton ska inte flyta ihop. */}
            <Bar dataKey="business" name="Företag" stackId="invoiced" fill={COLOR_BUSINESS} stroke={CARD_SURFACE} strokeWidth={2} maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="private" name="Privat" stackId="invoiced" fill={COLOR_PRIVATE} stroke={CARD_SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <PartialMonthsNote months={data} />

      <details className="group">
        <summary className="cursor-pointer text-[12px] font-semibold text-slate-600 hover:text-slate-900">Visa som tabell</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <th className="py-2 pr-3">Månad</th>
                <th className="py-2 px-3 text-right">Företag</th>
                <th className="py-2 px-3 text-right">Privat</th>
                <th className="py-2 pl-3 text-right">Totalt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-slate-100 last:border-b-0">
                  <td className="py-1.5 pr-3 text-slate-800">{formatMonthLong(d.period)}{d.partial ? '*' : ''}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatCurrency(d.business)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatCurrency(d.private)}</td>
                  <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-slate-800">{formatCurrency(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
