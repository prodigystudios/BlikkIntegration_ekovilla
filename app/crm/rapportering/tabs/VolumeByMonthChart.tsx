"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';
import type { VolumeMonth } from '@/lib/domains/crm/reportProduct';
import {
  COLOR_BAR,
  COLOR_PERIOD_BAND,
  formatCount,
  formatCurrency,
  formatM3,
  formatMonth,
  formatMonthLong,
  formatRangeLabel,
  PartialMonthsNote,
  PeriodBandLegend,
} from '../reportUi';

// Sålda m³ per månad — de senaste tolv månaderna eller sedan start, samma fönster som trenden.
// ⚠️ FÖLJER INTE PERIODVÄLJAREN, som de tre andra månadsdiagrammen; den valda perioden markeras med
// samma band.
//
// En serie, i fördelningarnas gröna (COLOR_BAR, som hit rate per månad) — färgen bär ingen identitet
// här, bara längden gör. Kr/m³ står i tooltipen och tabellen, INTE som en andra axel: två skalor i
// samma diagram hade gjort det omöjligt att läsa någon av dem.

type MonthDatum = VolumeMonth & { label: string };

function VolumeTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const datum = active ? (payload?.[0]?.payload as MonthDatum | undefined) : undefined;
  if (!datum) return null;
  return (
    <div className="grid min-w-[200px] gap-1 rounded-xl border border-[#dde6d9] bg-[#f9fbf7] px-3 py-2 text-[12px] text-slate-600 shadow-[0_10px_24px_rgba(20,44,27,0.14)]">
      <b className="font-semibold text-slate-900">
        {formatMonthLong(datum.period)}
        {datum.partial ? <span className="font-normal text-slate-500"> ({formatRangeLabel(datum.partial.from, datum.partial.to)})</span> : null}
      </b>
      {datum.m3 > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-slate-900">{formatM3(datum.m3)}</span>
          <span className="tabular-nums">
            {formatCurrency(datum.value)}
            {datum.pricePerM3 != null ? <> · {formatCurrency(datum.pricePerM3)}/m³</> : null}
          </span>
        </>
      ) : (
        <span>Inga m³ sålda</span>
      )}
    </div>
  );
}

export default function VolumeByMonthChart({ months }: { months: VolumeMonth[] }) {
  const data: MonthDatum[] = months.map((month) => ({ ...month, label: `${formatMonth(month.period)}${month.partial ? '*' : ''}` }));
  const inPeriod = data.filter((d) => d.inPeriod);

  return (
    <div className="grid gap-3">
      {inPeriod.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
          <PeriodBandLegend />
        </div>
      ) : null}

      <div
        className="h-64 w-full"
        role="img"
        aria-label={`Sålda kubikmeter per månad, ${formatMonthLong(data[0]?.period ?? '')} till ${formatMonthLong(data.at(-1)?.period ?? '')}. Siffrorna finns i tabellen under diagrammet.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cfdcc9' }} />
            <YAxis tickFormatter={(v) => formatCount(Number(v))} tick={{ fontSize: 12, fill: '#64748b' }} width={52} tickLine={false} axisLine={false} />
            {inPeriod.length > 0 ? (
              <ReferenceArea x1={inPeriod[0].label} x2={inPeriod[inPeriod.length - 1].label} fill={COLOR_PERIOD_BAND} fillOpacity={1} />
            ) : null}
            <Tooltip content={(props) => <VolumeTooltip active={props.active} payload={props.payload} />} cursor={{ fill: 'rgba(26,63,38,0.06)' }} />
            <Bar dataKey="m3" name="Sålda m³" fill={COLOR_BAR} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
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
                <th className="py-2 px-3 text-right">m³</th>
                <th className="py-2 px-3 text-right">Värde</th>
                <th className="py-2 pl-3 text-right">kr/m³</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-slate-100 last:border-b-0">
                  <td className="py-1.5 pr-3 text-slate-800">{formatMonthLong(d.period)}{d.partial ? '*' : ''}</td>
                  <td className="py-1.5 px-3 text-right font-semibold tabular-nums text-slate-800">{formatCount(Math.round(d.m3))}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatCurrency(d.value)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-slate-700">{d.pricePerM3 != null ? formatCurrency(d.pricePerM3) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
