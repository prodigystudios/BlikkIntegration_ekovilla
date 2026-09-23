"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  REPORT_RANGE_LABELS,
  reportRange,
  today,
  type ReportRangeKey,
} from './reportRanges';
// Procentreglerna importeras i stället för att skrivas om här: båda har ett null-fall som är lätt
// att tappa (mål 0 ger inte 0 %, föregående 0 ger inte +100 %), och de är enhetstestade i
// tests/crm/reportGoals.test.ts. En egen kopia i vyn hade varit den enda ingen prövar.
import {
  goalPercent,
  previousPercentChange,
  type PeriodMetric,
  type PeriodMetricKey,
  type PeriodSummary,
} from '@/lib/domains/crm/reportGoals';

// ── Types (mirror lib/domains/crm/reports.ts) ──
type SalesOverTimePoint = { period: string; quoteValue: number; orderValue: number; invoicedValue: number };
type SellerReportRow = { userId: string; userName: string; calls: number; quotes: number; quoteValue: number; wonValue: number; orders: number; orderValue: number; invoicedValue: number };
type FunnelStage = { count: number; value: number };
type SalesFunnel = { quotes: FunnelStage; won: FunnelStage; orders: FunnelStage; invoiced: FunnelStage };
type CustomerReportRow = { customer: string; orderValue: number; invoicedValue: number; orderCount: number };
type ProfitabilityPoint = { period: string; tg1: number | null; tg2: number | null };
type Profitability = {
  tg1: number | null;
  tg2: number | null;
  tb1: number;
  tb2: number;
  revenueTb1: number;
  revenueTb2: number;
  /** Fakturerade jobb i perioden, och hur många av dem som gick att räkna. */
  jobs: number;
  jobsTb1: number;
  jobsTb2: number;
  overTime: ProfitabilityPoint[];
  /** Kalkylen kunde inte köras alls — skilt från "inga kompletta jobb". */
  unavailable: boolean;
};
type SalesReport = {
  range: { from: string; to: string };
  periodSummary: PeriodSummary;
  salesOverTime: SalesOverTimePoint[];
  perSeller: SellerReportRow[];
  funnel: SalesFunnel;
  perCustomer: CustomerReportRow[];
  profitability: Profitability;
};

// ── Series colours (match the leaderboard tones) ──
const COLOR_QUOTE = '#0d9488'; // teal — offertvärde
const COLOR_ORDER = '#f59e0b'; // amber — ordervärde
const COLOR_INVOICED = '#8b5cf6'; // violet — fakturerat
// Lönsamhetens två serier. Egna hues, inte återbruk av de tre ovan: teal betyder offertvärde på
// samma sida, och samma färg för två olika saker i samma vy är hur man bygger in en felläsning.
// Paret är kontrollerat mot kortytan (#f9fbf7) — ΔE 19,7 i deuteranopi, 20,7 i normalseende, båda
// över 3:1 i kontrast.
const COLOR_TG1 = '#0284c7'; // sky — täckningsgrad efter material
const COLOR_TG2 = '#15803d'; // green — täckningsgrad efter arbete

// ── Formatting ──
const sekFormatter = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
function formatCurrency(value: number) { return sekFormatter.format(Number.isFinite(value) ? value : 0); }
function formatCompact(value: number) { return new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
function formatMonth(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat('sv-SE', { month: 'short', year: '2-digit' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
// UTC-pinned: the bare dates are calendar days, and letting the browser's zone touch them
// would shift the label a day for anyone west of Greenwich.
function formatRangeLabel(from: string, to: string) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const start = fmt.format(new Date(`${from}T00:00:00Z`));
  const end = fmt.format(new Date(`${to}T00:00:00Z`));
  return start === end ? start : `${start} – ${end}`;
}
function percent(part: number, whole: number) {
  if (whole <= 0) return '–';
  return `${Math.round((part / whole) * 100)} %`;
}

// ── CSV export (Swedish Excel: ; delimiter + BOM) ──
function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const escape = (cell: string | number) => {
    const s = String(cell ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = [header, ...rows].map((row) => row.map(escape).join(';')).join('\n');
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The last-12-months preset is also the landing state, so the page opens on a range the
// quick filters can recognise and highlight.
const DEFAULT_RANGE_KEY: ReportRangeKey = 'last12';

function defaultFrom() { return reportRange(DEFAULT_RANGE_KEY).from; }

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300">
      Exportera CSV
    </button>
  );
}

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

// ── Perioden i korthet ───────────────────────────────────────────────────────
//
// Sidan har hittills bara visat absoluta tal. "3,2 Mkr" säger ingenting utan något att hålla det
// emot, och båda referenserna fanns redan i databasen: månadsbudgeten i crm_goals och föregående
// lika långa period. Korten bär dem bredvid utfallet.

const PERIOD_METRIC_LABELS: Record<PeriodMetricKey, string> = {
  calls: 'Samtal',
  quotes: 'Offerter',
  quoteValue: 'Offertvärde',
  orders: 'Order',
  orderValue: 'Ordervärde',
  invoicedValue: 'Fakturerat',
};

const CURRENCY_METRICS = new Set<PeriodMetricKey>(['quoteValue', 'orderValue', 'invoicedValue']);

function formatCount(value: number) {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value);
}

function formatSigned(percent: number) {
  const rounded = Math.round(percent);
  return `${rounded > 0 ? '+' : ''}${formatCount(rounded)} %`;
}

/**
 * Ett av periodens sex huvudtal, med sina två referenser.
 *
 * ⚠️ TRE TOMMA LÄGEN MED TRE OLIKA SVAR, av samma skäl som lönsamhetskortet skiljer dem åt:
 *
 *   previous == null  jämförelsen kunde inte hämtas      -> ingen rad alls
 *   previous === 0    föregående period var faktiskt tom -> "mot 0", men ingen procent
 *   target == null    ingen budget är satt               -> ingen stapel, inte en stapel på 0 %
 *
 * Att slå ihop dem gör beskedet till ett påstående om verksamheten även när felet ligger i
 * hämtningen eller när ingen budget finns.
 */
function PeriodMetricCard({
  metric,
  goalsApply,
  daysCovered,
  daysTotal,
}: {
  metric: PeriodMetric;
  goalsApply: boolean;
  daysCovered: number;
  daysTotal: number;
}) {
  const isCurrency = CURRENCY_METRICS.has(metric.key);
  const format = (value: number) => (isCurrency ? formatCurrency(value) : formatCount(value));
  const change = previousPercentChange(metric);
  const attainment = goalPercent(metric);

  return (
    <div className="rounded-xl border border-[#e0e8dc] bg-white p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {PERIOD_METRIC_LABELS[metric.key]}
      </span>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{format(metric.actual)}</div>

      {/* Jämförelsen mot föregående lika långa period. */}
      {metric.previous == null ? (
        <div className="mt-1 text-[11px] text-slate-400">Ingen jämförelse</div>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
          {change == null ? (
            // Föregående period var noll. Att gå från 0 till 5 är en nyhet, inte en procentuell
            // ökning — så talet får stå för sig själv utan ett påhittat +100 %.
            //
            // ⚠️ "Ny" bara när det FINNS något nytt. Med 0 mot 0 hade etiketten påstått en
            // nyhet där ingenting alls hänt i någon av perioderna.
            <span className="font-semibold text-slate-500">{metric.actual > 0 ? 'Ny' : 'Oförändrat'}</span>
          ) : (
            <span className={cn('font-semibold tabular-nums', change < 0 ? 'text-rose-700' : 'text-emerald-700')}>
              {change < 0 ? '↓' : '↑'} {formatSigned(change)}
            </span>
          )}
          <span className="text-slate-400">mot {format(metric.previous)}</span>
        </div>
      )}

      {/* Målet. Ingen stapel alls när ingen budget är satt — en stapel på 0 % läses som ett
          misslyckande, inte som en saknad uppgift.

          ⚠️ `goalsApply` false betyder att HELA sektionen avstår från måluppfyllnad, och varför
          står i underrubriken. Då tiger kortet: "Inget mål satt" på sex kort hade motsagt en
          underrubrik som just förklarat att budgeten finns men bara för en del av månaderna. */}
      {!goalsApply ? null : metric.target == null || attainment == null ? (
        <div className="mt-3 text-[11px] text-slate-400">Inget mål satt</div>
      ) : (
        <div className="mt-3 grid gap-1">
          <div className="h-1.5 rounded-full bg-slate-100">
            {/* Stapeln klipps vid 100 %, talet under gör det INTE: 140 % av målet ska synas som
                140 %, och en stapel som växer förbi sin ram spräcker kortet. */}
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${Math.max(2, Math.min(100, attainment))}%`,
                backgroundColor: 'var(--crm-primary)',
              }}
            />
          </div>
          {/* ⚠️ TÄCKNINGEN STÅR BREDVID TALET, inte bara i underrubriken. Budgeten är satt per hel
              månad; en period som bara är två dagar in i månaden ger 5 % av målet, och utan
              dagraden läses det som ett misslyckande i stället för som "månaden har knappt
              börjat". Samma regel som lönsamhetskortets "14 av 19 fakturerade jobb" — caveaten
              följer med siffran, för det är siffran folk läser.

              Bara när perioden INTE täcker månaderna helt: på en hel månad vore raden brus. */}
          <div className="text-[11px] tabular-nums text-slate-500">
            {formatCount(Math.round(attainment))} % av målet {format(metric.target)}
            {daysCovered < daysTotal ? (
              <span className="text-slate-400"> · {daysCovered} av {daysTotal} dagar</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** "sep -26", eller "sep -25 – aug -26 · 12 månader" när målet spänner över flera. */
function goalMonthsLabel(months: string[]): string {
  if (months.length === 0) return '';
  if (months.length === 1) return formatMonth(months[0]);
  return `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])} · ${months.length} månader`;
}

/**
 * Varför målstaplarna syns — eller varför de inte gör det.
 *
 * ⚠️ TRE OLIKA BESKED, inte ett. "Inget mål satt" på en period där budgeten finns men bara för en
 * del av månaderna är missvisande: den som läser det fyller i en budget som redan finns. Beskedet
 * måste peka på vad som faktiskt saknas, annars går det inte att åtgärda.
 */
function goalSubtitle(summary: PeriodSummary): string {
  if (summary.goalMonths.length === 0) {
    return 'Ingen budget är satt för periodens månader, så måluppfyllnad visas inte.';
  }
  if (summary.monthsWithoutGoal.length > 0) {
    const total = summary.goalMonths.length + summary.monthsWithoutGoal.length;
    return `Måluppfyllnad visas inte: budget saknas för ${summary.monthsWithoutGoal.length} av periodens ${total} månader, och målet skulle då mäta ett kortare spann än utfallet.`;
  }
  return `Mål ur budgeten för ${goalMonthsLabel(summary.goalMonths)} — perioden täcker ${summary.goalDaysCovered} av ${summary.goalDaysTotal} dagar.`;
}

function SectionCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={crm.cardInner}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className={cn('mb-1', crm.sectionTitle)}>{title}</p>
          {subtitle ? <p className="m-0 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ReportsClient() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The highlight tracks what was clicked rather than being derived back from the dates:
  // presets collide (on a Monday the 1st, this week and this month are the same range),
  // and no amount of comparing could tell which one the user meant.
  const [activeRangeKey, setActiveRangeKey] = useState<ReportRangeKey | null>(DEFAULT_RANGE_KEY);

  const applyRange = (key: ReportRangeKey) => {
    const range = reportRange(key);
    setActiveRangeKey(key);
    setFrom(range.from);
    setTo(range.to);
  };

  // One click per period makes it easy to outrun the previous request, and a 12-month
  // report takes far longer than a one-week one. Without the abort, the slower earlier
  // request resolves last and paints a year's data under a "Denna vecka" chip.
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/reports?from=${from}&to=${to}`, { cache: 'no-store', signal });
      if (signal.aborted) return;
      // The abort can land mid-body, and this catch would turn that into an empty object
      // that reads as a failed report — a stale error banner over the successor's data.
      const json = await res.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda rapporten.'); setReport(null); return; }
      setReport(json.data as SalesReport);
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError('Kunde inte ladda rapporten.');
      setReport(null);
    } finally {
      // An aborted request has a successor already loading; clearing the flag here would
      // flash the charts back in between periods.
      if (!signal.aborted) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A range inside one calendar month collapses to a single monthly bucket. Labelling that
  // point "aug -26" would present a week's figures as the whole month's — so when there is
  // only one bucket it is named after the period actually asked for.
  const singlePoint = (report?.salesOverTime.length ?? 0) === 1;
  const salesChartData = useMemo(
    () => (report?.salesOverTime || []).map((p) => ({
      ...p,
      label: report && report.salesOverTime.length === 1
        ? formatRangeLabel(report.range.from, report.range.to)
        : formatMonth(p.period),
    })),
    [report],
  );
  // Samma etikettregel som försäljningsserien, så de två kurvorna går att läsa mot varandra.
  const marginChartData = useMemo(
    () => (report?.profitability.overTime || []).map((p) => ({
      ...p,
      label: report && report.profitability.overTime.length === 1
        ? formatRangeLabel(report.range.from, report.range.to)
        : formatMonth(p.period),
    })),
    [report],
  );
  const sellerChartData = useMemo(
    () => (report?.perSeller || []).slice(0, 12).map((s) => ({ name: s.userName, Ordervärde: s.orderValue, Offertvärde: s.quoteValue })),
    [report],
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
      {/* Header */}
      <div className="grid gap-3">
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>Rapportering</h1>
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Försäljning, säljarprestation och konvertering för vald period. Alla belopp är exklusive moms, och avbrutna order räknas inte.</p>
        </div>
        {/* Quick periods on the left as the everyday control, the manual dates on the
            right for the odd range that no preset covers. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {REPORT_RANGE_LABELS.map(([key, label]) => {
              const active = activeRangeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => applyRange(key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition',
                    active ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
                  )}
                  style={active ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              {/* slate-600: de här två ligger på sidbakgrunden (#e5ede5), inte på ett kort. slate-500
                  hade gett 3,98:1 och fortfarande fallit. */}
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Från</span>
              <input type="date" value={from} max={to} onChange={(e) => { setActiveRangeKey(null); setFrom(e.target.value); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Till</span>
              <input type="date" value={to} min={from} max={today()} onChange={(e) => { setActiveRangeKey(null); setTo(e.target.value); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" />
            </label>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong className="font-semibold">Kunde inte ladda rapporten</strong>
          <p className="m-0 mt-1">{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-[#e0e8dc] bg-[#dfe6da]" />)}
        </div>
      ) : report ? (
        <>
          {/* 0. Perioden i korthet — utfallet mot målet och mot föregående period */}
          <SectionCard
            title="Perioden i korthet"
            subtitle={[
              report.periodSummary.previousRange
                ? `Jämfört med lika lång period dessförinnan (${formatRangeLabel(report.periodSummary.previousRange.from, report.periodSummary.previousRange.to)}).`
                : 'Ingen jämförelseperiod kunde räknas fram.',
              goalSubtitle(report.periodSummary),
            ].join(' ')}
            action={<ExportButton onClick={() => downloadCsv(
              `perioden-i-korthet_${report.range.from}_${report.range.to}.csv`,
              ['Tal', 'Utfall', 'Föregående period', 'Förändring (%)', 'Mål', 'Måluppfyllnad (%)'],
              report.periodSummary.metrics.map((metric) => {
                const change = previousPercentChange(metric);
                const attainment = goalPercent(metric);
                return [
                  PERIOD_METRIC_LABELS[metric.key],
                  metric.actual,
                  // Tomt, inte 0: en nolla i exporten hade lästs som ett uppmätt värde.
                  metric.previous ?? '',
                  change == null ? '' : Math.round(change),
                  metric.target ?? '',
                  attainment == null ? '' : Math.round(attainment),
                ];
              }),
            )} />}
          >
            {/* Tre i bredd, inte sex: krontalen blir sexsiffriga och ett kort per kolumn hade
                brutit siffran över två rader på en vanlig laptop. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.periodSummary.metrics.map((metric) => (
                <PeriodMetricCard
                  key={metric.key}
                  metric={metric}
                  goalsApply={
                    report.periodSummary.goalMonths.length > 0 &&
                    report.periodSummary.monthsWithoutGoal.length === 0
                  }
                  daysCovered={report.periodSummary.goalDaysCovered}
                  daysTotal={report.periodSummary.goalDaysTotal}
                />
              ))}
            </div>
          </SectionCard>

          {/* 1. Försäljning över tid */}
          <SectionCard
            title="Försäljning över tid"
            subtitle={singlePoint
              ? 'Offert- och ordervärde skapat i perioden; fakturerat är det som fakturerades under perioden. Ex moms.'
              : 'Offert- och ordervärde per månad de skapades; fakturerat per månad det fakturerades. Ex moms.'}
            action={<ExportButton onClick={() => downloadCsv(
              `forsaljning-over-tid_${report.range.from}_${report.range.to}.csv`,
              [singlePoint ? 'Period' : 'Månad', 'Offertvärde (ex moms)', 'Ordervärde (ex moms)', 'Fakturerat (ex moms)'],
              report.salesOverTime.map((p) => [
                singlePoint ? `${report.range.from} – ${report.range.to}` : p.period,
                p.quoteValue, p.orderValue, p.invoicedValue,
              ]),
            )} />}
          >
            {salesChartData.length === 0 ? <EmptyChart /> : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesChartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#64748b' }} width={56} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} labelStyle={{ color: '#0f172a' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {/* Buckets are monthly, so a week/month range yields a single point —
                        and a line through one point draws nothing. Show the dot instead of
                        an empty canvas. */}
                    <Line type="monotone" dataKey="quoteValue" name="Offertvärde" stroke={COLOR_QUOTE} strokeWidth={2} dot={singlePoint} />
                    <Line type="monotone" dataKey="orderValue" name="Ordervärde" stroke={COLOR_ORDER} strokeWidth={2} dot={singlePoint} />
                    <Line type="monotone" dataKey="invoicedValue" name="Fakturerat" stroke={COLOR_INVOICED} strokeWidth={2} dot={singlePoint} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* 1b. Lönsamhet — vad som blev kvar av det som fakturerades */}
          <SectionCard
            title="Lönsamhet"
            subtitle="Täckningsgrad på jobb som fakturerades i perioden, räknad på rapporterade säckar och rapporterad tid. Bara jobb med komplett underlag räknas."
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
                Inga jobb fakturerades i perioden.
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

          {/* 4. Per kund */}
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
        </>
      ) : null}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
      Ingen data för vald period.
    </div>
  );
}
