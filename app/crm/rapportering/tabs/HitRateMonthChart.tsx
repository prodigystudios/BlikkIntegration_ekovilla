"use client";

import { useId } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, Cell,
} from 'recharts';
import Badge from '@/components/ui/Badge';
import type { HitRateMonth } from '@/lib/domains/crm/reportKpis';
import {
  COLOR_BAR,
  COLOR_BAR_STRIPE,
  COLOR_PERIOD_BAND,
  formatCount,
  formatMonth,
  formatMonthLong,
  formatPercent,
  formatRangeLabel,
} from '../reportUi';

// Hit rate per offertmånad — de senaste tolv månaderna eller sedan start, samma fönster som trenden.
//
// ⚠️ FÖLJER INTE PERIODVÄLJAREN (Williams beslut 2026-10-07): på "Denna månad" hade en serie över
// perioden varit en enda stapel som bara upprepar Hit rate-kortet. Den valda perioden markeras i stället.
//
// Randig stapel = preliminär: månadens offerter är inte alla 30 dagar gamla, och talet stiger sannolikt
// ännu. Ränderna är formen, inte färgen, som skiljer de två — de ska gå att se även i gråskala.

type MonthDatum = HitRateMonth & { label: string };

function HitRateTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const datum = active ? (payload?.[0]?.payload as MonthDatum | undefined) : undefined;
  if (!datum) return null;
  return (
    <div className="grid min-w-[200px] gap-1 rounded-xl border border-[#dde6d9] bg-[#f9fbf7] px-3 py-2 text-[12px] text-slate-600 shadow-[0_10px_24px_rgba(20,44,27,0.14)]">
      <b className="font-semibold text-slate-900">
        {formatMonthLong(datum.period)}
        {datum.partial ? <span className="font-normal text-slate-500"> ({formatRangeLabel(datum.partial.from, datum.partial.to)})</span> : null}
      </b>
      {datum.quotes === 0 ? (
        <span>Inga offerter</span>
      ) : (
        <>
          <span className="tabular-nums">
            <span className="font-semibold text-slate-900">{formatPercent(datum.percent)}</span>
            {' '}— {formatCount(datum.won)} av {formatCount(datum.quotes)} vunna
          </span>
          {datum.valuePercent != null ? <span className="tabular-nums">{formatPercent(datum.valuePercent)} i kronor</span> : null}
        </>
      )}
      {datum.preliminary ? <span className="text-slate-500">Preliminärt — kan stiga.</span> : null}
    </div>
  );
}

export default function HitRateMonthChart({ months }: { months: HitRateMonth[] }) {
  // Mönstrets id måste vara unikt på sidan och giltigt i url(#…); useId ger kolon, som inte är det.
  const patternId = `hit-rate-preliminary-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const data: MonthDatum[] = months.map((month) => ({ ...month, label: `${formatMonth(month.period)}${month.partial ? '*' : ''}` }));
  const inPeriod = data.filter((d) => d.inPeriod);
  const partials = data.filter((d) => d.partial);
  const anyPreliminary = data.some((d) => d.preliminary && d.quotes > 0);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#2f6b45]" aria-hidden="true" />
          Slutgiltig
        </span>
        {anyPreliminary ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,#2f6b45_0_2px,#b9d0bf_2px_4px)]" aria-hidden="true" />
            Preliminär, yngre än 30 dagar
          </span>
        ) : null}
        {inPeriod.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 rounded-sm border border-[#cfdcc9] bg-[#e3ece0]" aria-hidden="true" />
            Vald period
          </span>
        ) : null}
      </div>

      <div
        className="h-56 w-full"
        role="img"
        aria-label={`Hit rate per offertmånad, ${formatMonthLong(data[0]?.period ?? '')} till ${formatMonthLong(data.at(-1)?.period ?? '')}. Siffrorna finns i tabellen under diagrammet.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={COLOR_BAR_STRIPE} />
                <rect width="3.5" height="6" fill={COLOR_BAR} />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cfdcc9' }} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value} %`} tick={{ fontSize: 12, fill: '#64748b' }} width={52} tickLine={false} axisLine={false} />
            {inPeriod.length > 0 ? (
              <ReferenceArea x1={inPeriod[0].label} x2={inPeriod[inPeriod.length - 1].label} fill={COLOR_PERIOD_BAND} fillOpacity={1} />
            ) : null}
            <Tooltip content={(props) => <HitRateTooltip active={props.active} payload={props.payload} />} cursor={{ fill: 'rgba(26,63,38,0.06)' }} />
            <Bar dataKey="percent" name="Hit rate" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.period} fill={d.preliminary ? `url(#${patternId})` : COLOR_BAR} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {partials.length > 0 ? (
        <p className="m-0 text-[12px] text-slate-500">
          * Delmånad, bara de här dagarna räknas: {partials.map((d) => `${formatMonth(d.period)} (${formatRangeLabel(d.partial!.from, d.partial!.to)})`).join(', ')}.
        </p>
      ) : null}

      <details className="group">
        <summary className="cursor-pointer text-[12px] font-semibold text-slate-600 hover:text-slate-900">Visa som tabell</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <th className="py-2 pr-3">Offertmånad</th>
                <th className="py-2 px-3 text-right">Offerter</th>
                <th className="py-2 px-3 text-right">Vunna</th>
                <th className="py-2 px-3 text-right">Hit rate</th>
                <th className="py-2 pl-3 text-right">I kronor</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-slate-100 last:border-b-0">
                  <td className="py-1.5 pr-3 text-slate-800">
                    {formatMonthLong(d.period)}{d.partial ? '*' : ''}
                    {d.preliminary && d.quotes > 0 ? <Badge variant="info" className="ml-2 px-1.5 py-0.5 text-[11px]">Preliminärt</Badge> : null}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatCount(d.quotes)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{formatCount(d.won)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums font-semibold text-slate-800">{formatPercent(d.percent)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-slate-700">{formatPercent(d.valuePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
