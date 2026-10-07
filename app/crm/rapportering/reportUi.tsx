"use client";

import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
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

// Rapportsidans delade byggstenar: formatering, CSV-export och korten flikarna delar. Flikarna bor i
// ./tabs/, en fil per flik.

// ── Series colours (match the leaderboard tones) ──
export const COLOR_QUOTE = '#0d9488'; // teal — offertvärde
export const COLOR_ORDER = '#f59e0b'; // amber — ordervärde
export const COLOR_INVOICED = '#8b5cf6'; // violet — fakturerat

// Ytor INUTI ett kort: en salvieton strax mörkare än kortet (#f9fbf7), aldrig vitt — en vit panel blir
// den ljusaste ytan på sidan och drar blicken (Williams ord, 2026-10-07).
export const INSET_PANEL = 'rounded-xl border border-[#dde6d9] bg-[#f1f5ee]';

// ── Formatting ──
const sekFormatter = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
export function formatCurrency(value: number) { return sekFormatter.format(Number.isFinite(value) ? value : 0); }
export function formatCompact(value: number) { return new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
export function formatMonth(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat('sv-SE', { month: 'short', year: '2-digit' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
/** "september 2026" — tooltipens rubrik. */
export function formatMonthLong(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
// UTC-pinned: the bare dates are calendar days, and letting the browser's zone touch them
// would shift the label a day for anyone west of Greenwich.
export function formatRangeLabel(from: string, to: string) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const start = fmt.format(new Date(`${from}T00:00:00Z`));
  const end = fmt.format(new Date(`${to}T00:00:00Z`));
  return start === end ? start : `${start} – ${end}`;
}
export function percent(part: number, whole: number) {
  if (whole <= 0) return '–';
  return `${Math.round((part / whole) * 100)} %`;
}
export function formatCount(value: number) {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value);
}
export function formatSigned(percent: number) {
  const rounded = Math.round(percent);
  return `${rounded > 0 ? '+' : ''}${formatCount(rounded)} %`;
}
/** Procent med en decimal och kommatecken, eller "–". */
export function formatPercent(value: number | null, decimals: 0 | 1 = 0) {
  if (value == null || !Number.isFinite(value)) return '–';
  return `${new Intl.NumberFormat('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)} %`;
}

// ── CSV export (Swedish Excel: ; delimiter + BOM) ──
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  // ⚠️ KOMMATECKEN CITERAS INTE. Filen är `;`-separerad för svenskt Excel, så ett komma är inte
  // avgränsare och behöver ingen citering (RFC 4180 kräver den bara för avgränsaren, citattecken
  // och radbrytning). Skillnaden är inte kosmetisk: ett citerat `"40,5"` läses av Excel som TEXT,
  // och timkolumnerna hade summerat till 0 i stället för till periodens timmar.
  const escape = (cell: string | number) => {
    const s = String(cell ?? '');
    return /["\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300">
      Exportera CSV
    </button>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#e0e8dc] bg-white p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={crm.cardInner}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className={cn('mb-1', crm.sectionTitle)}>{title}</p>
          {subtitle ? <p className="m-0 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function EmptyChart() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
      Ingen data för vald period.
    </div>
  );
}

/** Ett tal som inte gick att räkna. Aldrig 0 — "0 kr" hade varit ett påstående om verksamheten. */
export function Unavailable({ children = 'Kunde inte räknas. Övriga siffror på sidan är opåverkade.' }: { children?: ReactNode }) {
  return <div className="text-[12px] text-amber-800">{children}</div>;
}

// ── Periodens huvudtal ───────────────────────────────────────────────────────

export const PERIOD_METRIC_LABELS: Record<PeriodMetricKey, string> = {
  calls: 'Samtal',
  quotes: 'Offerter',
  quoteValue: 'Offertvärde',
  orders: 'Order',
  orderValue: 'Ordervärde',
  invoicedValue: 'Fakturerat',
};

const CURRENCY_METRICS = new Set<PeriodMetricKey>(['quoteValue', 'orderValue', 'invoicedValue']);

export function formatMetric(key: PeriodMetricKey, value: number) {
  return CURRENCY_METRICS.has(key) ? formatCurrency(value) : formatCount(value);
}

/** Målstaplarna gäller bara när varje månad i perioden har budget — se buildPeriodSummary. */
export function goalsApply(summary: PeriodSummary) {
  return summary.goalMonths.length > 0 && summary.monthsWithoutGoal.length === 0;
}

/**
 * Jämförelsen mot föregående lika långa period.
 *
 * ⚠️ TRE TOMMA LÄGEN MED TRE OLIKA SVAR:
 *
 *   previous == null  jämförelsen kunde inte hämtas      -> "Ingen jämförelse"
 *   previous === 0    föregående period var faktiskt tom -> "mot 0", men ingen procent
 *   annars                                               -> förändringen i procent
 */
export function MetricComparison({ metric }: { metric: PeriodMetric }) {
  const change = previousPercentChange(metric);
  if (metric.previous == null) return <div className="text-[12px] text-slate-500">Ingen jämförelse</div>;
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      {change == null ? (
        // Föregående period var noll. Att gå från 0 till 5 är en nyhet, inte en procentuell
        // ökning — så talet får stå för sig själv utan ett påhittat +100 %.
        //
        // ⚠️ "Ny" bara när det FINNS något nytt. Med 0 mot 0 hade etiketten påstått en
        // nyhet där ingenting alls hänt i någon av perioderna.
        <span className="font-semibold text-slate-600">{metric.actual > 0 ? 'Ny' : 'Oförändrat'}</span>
      ) : (
        <span className={cn('font-semibold tabular-nums', change < 0 ? 'text-rose-700' : 'text-emerald-700')}>
          {change < 0 ? '↓' : '↑'} {formatSigned(change)}
        </span>
      )}
      <span className="text-slate-500">mot {formatMetric(metric.key, metric.previous)}</span>
    </div>
  );
}

/**
 * Målet som en stapel.
 *
 * Ingen stapel alls när ingen budget är satt — en stapel på 0 % läses som ett misslyckande, inte som
 * en saknad uppgift. ⚠️ `apply` false betyder att HELA sidan avstår från måluppfyllnad, och varför
 * står i underrubriken. Då tiger kortet: "Inget mål satt" på varje kort hade motsagt en underrubrik
 * som just förklarat att budgeten finns men bara för en del av månaderna.
 */
export function MetricGoal({
  metric,
  apply,
  daysCovered,
  daysTotal,
  extra,
}: {
  metric: PeriodMetric;
  apply: boolean;
  daysCovered: number;
  daysTotal: number;
  /** En extra uppgift efter målet, t.ex. antalsmålet bredvid värdemålet. */
  extra?: string | null;
}) {
  const attainment = goalPercent(metric);
  if (!apply) return null;
  if (metric.target == null || attainment == null) {
    return <div className="text-[12px] text-slate-500">Inget mål satt{extra ? ` · ${extra}` : ''}</div>;
  }
  return (
    <div className="grid gap-1">
      <div className="h-1.5 rounded-full bg-[#dde6d9]">
        {/* Stapeln klipps vid 100 %, talet under gör det INTE: 140 % av målet ska synas som
            140 %, och en stapel som växer förbi sin ram spräcker kortet. */}
        <div
          className="h-1.5 rounded-full"
          style={{ width: `${Math.max(2, Math.min(100, attainment))}%`, backgroundColor: 'var(--crm-primary)' }}
        />
      </div>
      {/* ⚠️ TÄCKNINGEN STÅR BREDVID TALET. Budgeten är satt per hel månad; en period som bara är två
          dagar in i månaden ger 5 % av målet, och utan dagraden läses det som ett misslyckande i
          stället för som "månaden har knappt börjat". Bara när perioden inte täcker månaderna helt. */}
      <div className="text-[12px] tabular-nums text-slate-600">
        {formatCount(Math.round(attainment))} % av målet {formatMetric(metric.key, metric.target)}
        {daysCovered < daysTotal ? <span className="text-slate-500"> · {daysCovered} av {daysTotal} dagar</span> : null}
        {extra ? <span className="text-slate-500"> · {extra}</span> : null}
      </div>
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
export function goalSubtitle(summary: PeriodSummary): string {
  if (summary.goalMonths.length === 0) {
    return 'Ingen budget är satt för periodens månader, så måluppfyllnad visas inte.';
  }
  if (summary.monthsWithoutGoal.length > 0) {
    const total = summary.goalMonths.length + summary.monthsWithoutGoal.length;
    return `Måluppfyllnad visas inte: budget saknas för ${summary.monthsWithoutGoal.length} av periodens ${total} månader, och målet skulle då mäta ett kortare spann än utfallet.`;
  }
  return `Mål ur budgeten för ${goalMonthsLabel(summary.goalMonths)} — perioden täcker ${summary.goalDaysCovered} av ${summary.goalDaysTotal} dagar.`;
}

// ── Nyckeltalskortet ─────────────────────────────────────────────────────────

/**
 * Definitionen bakom ett tal, bakom en liten i-knapp — i stället för långa texter under rubrikerna.
 * `<details>` och inte en hovring: den fungerar med tangentbord och på en telefon, utan JavaScript.
 */
export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label={`Vad betyder ${label}?`}
        className="grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full border border-[#cfdcc9] bg-[#f9fbf7] text-[11px] font-bold italic text-slate-500 transition hover:border-[color:var(--crm-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)] group-open:border-[color:var(--crm-primary)] group-open:bg-[color:var(--crm-primary)] group-open:text-white [&::-webkit-details-marker]:hidden"
      >
        i
      </summary>
      <div className="absolute right-0 top-7 z-20 w-[min(280px,75vw)] rounded-xl border border-[#dde6d9] bg-[#f9fbf7] p-3 text-[12px] font-normal not-italic leading-relaxed text-slate-700 shadow-[0_10px_24px_rgba(20,44,27,0.14)]">
        {children}
      </div>
    </details>
  );
}

/** Kortets omfång: periodens etikett, eller "Nu" för en ögonblicksbild som inte följer perioden. */
export function ScopeChip({ children, now = false }: { children: ReactNode; now?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
        now ? 'bg-[#e3ece0] text-[#1a3f26]' : 'bg-[#e6ede3] text-slate-600',
      )}
    >
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  scope,
  definition,
  value,
  muted = false,
  children,
}: {
  label: string;
  scope: ReactNode;
  definition: ReactNode;
  value: ReactNode;
  /** Talet saknas ("–"): dämpat, så det inte läses som ett uppmätt värde. */
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className={cn(INSET_PANEL, 'grid content-start gap-1.5 p-4')}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
        {scope}
        <Definition label={label}>{definition}</Definition>
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', muted ? 'text-slate-400' : 'text-slate-900')}>{value}</div>
      {children}
    </article>
  );
}

/** En undertext på ett nyckeltalskort. */
export function KpiNote({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return <div className={cn('text-[12px]', tone === 'warn' ? 'text-amber-800' : 'text-slate-600')}>{children}</div>;
}
