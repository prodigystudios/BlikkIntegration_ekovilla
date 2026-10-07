"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';
import type { SalesTrend, TrendPoint, TrendSeriesKey } from '@/lib/domains/crm/reportKpis';
import {
  COLOR_INVOICED,
  COLOR_ORDER,
  COLOR_QUOTE,
  formatCompact,
  formatCurrency,
  formatMonth,
  formatMonthLong,
  formatRangeLabel,
} from '../reportUi';

// Offerter, orderingång och fakturerat per månad — de senaste tolv månaderna eller sedan start.
//
// ⚠️ FÖLJER INTE PERIODVÄLJAREN (Williams beslut 2026-10-07). Sidan öppnar på "Denna månad", och ett
// diagram som följde perioden hade då varit en enda stapel. Den valda perioden markeras i stället.
//
// Målet ritas som ett streck över respektive stapel, och bara på hela månader med budget: en pågående
// månad har några dagars utfall, och ställd mot hela månadens mål hade den sett ut att ligga efter
// varje gång någon tittade (se TrendPoint.goals).

const SERIES: Array<{ key: TrendSeriesKey; goalKey: GoalKey; label: string; color: string }> = [
  { key: 'quoteValue', goalKey: 'quoteGoal', label: 'Offerter', color: COLOR_QUOTE },
  { key: 'orderValue', goalKey: 'orderGoal', label: 'Orderingång', color: COLOR_ORDER },
  { key: 'invoicedValue', goalKey: 'invoicedGoal', label: 'Fakturerat', color: COLOR_INVOICED },
];

type GoalKey = 'quoteGoal' | 'orderGoal' | 'invoicedGoal';

type TrendDatum = TrendPoint & Record<GoalKey, number | null> & { label: string };

const GOAL_STROKE = '#1f2937';
const PERIOD_BAND = '#e3ece0';
// Samma mått för stapel och målstreck: de två x-axlarna lägger ut sina staplar var för sig, och
// strecken hamnar bara rakt över sin stapel när båda grupperna har exakt samma mått. En MAXbredd, inte
// en fast: tolv månader à tre staplar får inte plats på en telefon med 22 px var, och båda grupperna
// (tre staplar, samma tak) krymper då lika mycket.
const MAX_BAR_SIZE = 22;

/**
 * Målstrecket. Ritas av en egen stapelserie på en dold andra x-axel med samma kategorier — den lägger
 * ut sina tre "staplar" på samma platser som de riktiga, så strecket hamnar över rätt stapel i gruppen.
 * `y` är toppen av en stapel med målets höjd, alltså målets nivå.
 */
function GoalTick(props: { x?: number; y?: number; width?: number; value?: unknown }) {
  const { x, y, width, value } = props;
  if (value == null || x == null || y == null || width == null) return <g />;
  return <line x1={x - 3} x2={x + width + 3} y1={y} y2={y} stroke={GOAL_STROKE} strokeWidth={2} strokeLinecap="round" />;
}

function goalShare(value: number, goal: number | null): string | null {
  if (goal == null || goal <= 0) return null;
  return `${Math.round((value / goal) * 100)} % av målet`;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const datum = active ? (payload?.[0]?.payload as TrendDatum | undefined) : undefined;
  if (!datum) return null;
  const hasGoal = SERIES.some((s) => datum[s.goalKey] != null);
  return (
    <div className="grid min-w-[220px] gap-1 rounded-xl border border-[#dde6d9] bg-[#f9fbf7] px-3 py-2 text-[12px] text-slate-600 shadow-[0_10px_24px_rgba(20,44,27,0.14)]">
      <b className="font-semibold text-slate-900">
        {formatMonthLong(datum.period)}
        {datum.partial ? <span className="font-normal text-slate-500"> ({formatRangeLabel(datum.partial.from, datum.partial.to)})</span> : null}
      </b>
      {SERIES.map((series) => {
        const share = goalShare(datum[series.key], datum[series.goalKey]);
        return (
          <div key={series.key} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} aria-hidden="true" />
              {series.label}
            </span>
            <span className="tabular-nums font-semibold text-slate-900">
              {formatCurrency(datum[series.key])}
              {share ? <span className="font-normal text-slate-500"> · {share}</span> : null}
            </span>
          </div>
        );
      })}
      <span className="text-slate-500">
        {datum.partial ? 'Delmånad — inget mål jämförs.' : hasGoal ? null : 'Ingen budget satt för månaden.'}
      </span>
    </div>
  );
}

export default function SalesTrendChart({ trend }: { trend: SalesTrend }) {
  const data: TrendDatum[] = trend.points.map((point) => ({
    ...point,
    label: `${formatMonth(point.period)}${point.partial ? '*' : ''}`,
    quoteGoal: point.goals.quoteValue,
    orderGoal: point.goals.orderValue,
    invoicedGoal: point.goals.invoicedValue,
  }));
  const inPeriod = data.filter((d) => d.inPeriod);
  const partials = data.filter((d) => d.partial);
  const anyGoal = data.some((d) => SERIES.some((s) => d[s.goalKey] != null));

  return (
    <div className="grid gap-3">
      {/* Legenden i HTML: tre serier är för många för att lita på färgen ensam, och målstrecket och
          periodbandet behöver förklaras med form, inte med färg. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
        {SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} aria-hidden="true" />
            {series.label}
          </span>
        ))}
        {anyGoal ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: GOAL_STROKE }} aria-hidden="true" />
            Mål
          </span>
        ) : null}
        {inPeriod.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 rounded-sm border border-[#cfdcc9]" style={{ backgroundColor: PERIOD_BAND }} aria-hidden="true" />
            Vald period
          </span>
        ) : null}
      </div>

      <div
        className="h-72 w-full"
        role="img"
        aria-label={`Offerter, orderingång och fakturerat per månad, ${formatMonthLong(trend.points[0]?.period ?? '')} till ${formatMonthLong(trend.points.at(-1)?.period ?? '')}. Siffrorna finns i tabellen under diagrammet.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="34%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe0" vertical={false} />
            <XAxis xAxisId="value" dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cfdcc9' }} />
            {/* height 0: en dold axel reserverar annars sin höjd och trycker ned den synliga axelns etiketter
                utanför diagrammet, där de klipps bort. */}
            <XAxis xAxisId="goal" dataKey="label" hide height={0} />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#64748b' }} width={52} tickLine={false} axisLine={false} />
            {inPeriod.length > 0 ? (
              <ReferenceArea xAxisId="value" x1={inPeriod[0].label} x2={inPeriod[inPeriod.length - 1].label} fill={PERIOD_BAND} fillOpacity={1} />
            ) : null}
            <Tooltip content={(props) => <TrendTooltip active={props.active} payload={props.payload} />} cursor={{ fill: 'rgba(26,63,38,0.06)' }} />
            {SERIES.map((series) => (
              <Bar key={series.key} xAxisId="value" dataKey={series.key} name={series.label} fill={series.color} radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
            ))}
            {SERIES.map((series) => (
              <Bar key={series.goalKey} xAxisId="goal" dataKey={series.goalKey} name={`Mål ${series.label.toLowerCase()}`} fill="transparent" maxBarSize={MAX_BAR_SIZE} shape={GoalTick} isAnimationActive={false} legendType="none" />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {partials.length > 0 ? (
        <p className="m-0 text-[12px] text-slate-500">
          * Delmånad, bara de här dagarna räknas: {partials.map((d) => `${formatMonth(d.period)} (${formatRangeLabel(d.partial!.from, d.partial!.to)})`).join(', ')}. Inget mål jämförs på en delmånad.
        </p>
      ) : null}

      {/* Tabellen: bärnstensgult har låg kontrast mot kortet (2,06:1), så siffrorna måste kunna läsas
          utan diagrammet. Samma tal som staplarna, mål inom parentes. */}
      <details className="group">
        <summary className="cursor-pointer text-[12px] font-semibold text-slate-600 hover:text-slate-900">Visa som tabell</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <th className="py-2 pr-3">Månad</th>
                {SERIES.map((series) => <th key={series.key} className="py-2 px-3 text-right">{series.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-slate-100 last:border-b-0">
                  <td className="py-1.5 pr-3 text-slate-800">{formatMonthLong(d.period)}{d.partial ? '*' : ''}</td>
                  {SERIES.map((series) => (
                    <td key={series.key} className="py-1.5 px-3 text-right tabular-nums text-slate-700">
                      {formatCurrency(d[series.key])}
                      {d[series.goalKey] != null ? <span className="text-slate-500"> (mål {formatCurrency(d[series.goalKey]!)})</span> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
