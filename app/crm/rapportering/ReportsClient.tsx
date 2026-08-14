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

// ── Types (mirror lib/domains/crm/reports.ts) ──
type SalesOverTimePoint = { period: string; quoteValue: number; orderValue: number; invoicedValue: number };
type SellerReportRow = { userId: string; userName: string; calls: number; quotes: number; quoteValue: number; wonValue: number; orderValue: number; invoicedValue: number };
type FunnelStage = { count: number; value: number };
type SalesFunnel = { quotes: FunnelStage; won: FunnelStage; orders: FunnelStage; invoiced: FunnelStage };
type CustomerReportRow = { customer: string; orderValue: number; invoicedValue: number; orderCount: number };
type SalesReport = {
  range: { from: string; to: string };
  salesOverTime: SalesOverTimePoint[];
  perSeller: SellerReportRow[];
  funnel: SalesFunnel;
  perCustomer: CustomerReportRow[];
};

// ── Series colours (match the leaderboard tones) ──
const COLOR_QUOTE = '#0d9488'; // teal — offertvärde
const COLOR_ORDER = '#f59e0b'; // amber — ordervärde
const COLOR_INVOICED = '#8b5cf6'; // violet — fakturerat

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
  const sellerChartData = useMemo(
    () => (report?.perSeller || []).slice(0, 12).map((s) => ({ name: s.userName, Ordervärde: s.orderValue, Offertvärde: s.quoteValue })),
    [report],
  );
  const customerChartData = useMemo(
    () => (report?.perCustomer || []).slice(0, 8).map((c) => ({ name: c.customer, Ordervärde: c.orderValue })),
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
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Försäljning, säljarprestation och konvertering för vald period.</p>
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Från</span>
              <input type="date" value={from} max={to} onChange={(e) => { setActiveRangeKey(null); setFrom(e.target.value); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Till</span>
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
          {/* 1. Försäljning över tid */}
          <SectionCard
            title="Försäljning över tid"
            subtitle={singlePoint
              ? 'Offertvärde, ordervärde och fakturerat för hela den valda perioden'
              : 'Offertvärde, ordervärde och fakturerat per månad'}
            action={<ExportButton onClick={() => downloadCsv(
              `forsaljning-over-tid_${report.range.from}_${report.range.to}.csv`,
              [singlePoint ? 'Period' : 'Månad', 'Offertvärde', 'Ordervärde', 'Fakturerat'],
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

          {/* 2. Per säljare */}
          <SectionCard
            title="Per säljare"
            subtitle="Aktivitet och värde per säljare i perioden"
            action={<ExportButton onClick={() => downloadCsv(
              `per-saljare_${report.range.from}_${report.range.to}.csv`,
              ['Säljare', 'Samtal', 'Offerter', 'Offertvärde', 'Vunnet värde', 'Ordervärde', 'Fakturerat'],
              report.perSeller.map((s) => [s.userName, s.calls, s.quotes, s.quoteValue, s.wonValue, s.orderValue, s.invoicedValue]),
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
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                        <th className="py-2 pr-3">Säljare</th>
                        <th className="py-2 px-3 text-right">Samtal</th>
                        <th className="py-2 px-3 text-right">Offerter</th>
                        <th className="py-2 px-3 text-right">Offertvärde</th>
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
            subtitle="Offert → vunnen → arbetsorder → fakturerat"
            action={<ExportButton onClick={() => downloadCsv(
              `konvertering_${report.range.from}_${report.range.to}.csv`,
              ['Steg', 'Antal', 'Värde', 'Konvertering'],
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
            subtitle="Topplista kunder på ordervärde"
            action={<ExportButton onClick={() => downloadCsv(
              `per-kund_${report.range.from}_${report.range.to}.csv`,
              ['Kund', 'Antal order', 'Ordervärde', 'Fakturerat'],
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
                      <Bar dataKey="Ordervärde" fill={COLOR_ORDER} radius={[0, 4, 4, 0]} />
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
