"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { TabsList, TabsTrigger } from '@/components/ui/Tabs';
import type { SalesReport } from '@/lib/domains/crm/reports';
import {
  REPORT_RANGE_LABELS,
  reportRange,
  today,
  type ReportRangeKey,
} from './reportRanges';
import {
  DEFAULT_REPORT_TAB,
  TAB_PARAM,
  periodChipLabel,
  resolveReportTab,
  visibleReportTabs,
  type ReportTabId,
} from './reportTabs';
import OverviewTab from './tabs/OverviewTab';
import SalesTab from './tabs/SalesTab';
import RevenueTab from './tabs/RevenueTab';
import ProductTab from './tabs/ProductTab';
import ProductionTab from './tabs/ProductionTab';
import TimeTab from './tabs/TimeTab';
import OwnerExportButton from './OwnerExportButton';

// Rapportsidan: en sida i flikar, där varje flik svarar på en fråga (spec 2026-10-07). Skalet här
// äger periodväljaren, laddningen och flikvalet; varje flik bor i ./tabs/.

// "Denna månad" är förvalet (Williams beslut 2026-10-07 — tidigare de senaste tolv månaderna), och
// samma snabbval som rutten faller tillbaka på, så sidan öppnar på ett intervall knapparna känner igen.
const DEFAULT_RANGE_KEY: ReportRangeKey = 'month';

function defaultFrom() { return reportRange(DEFAULT_RANGE_KEY).from; }

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

  // Den flik läsaren bett om — ur ?flik= eller ett klick. Vilken som faktiskt visas avgörs först när
  // rapporten kommit: Tid finns bara när rutten lämnat ut tiden, och en länk dit från någon som inte
  // får se den ska landa på Översikt.
  const [requestedTab, setRequestedTab] = useState<string | null>(null);

  const applyRange = (key: ReportRangeKey) => {
    const range = reportRange(key);
    setActiveRangeKey(key);
    setFrom(range.from);
    setTo(range.to);
  };

  // URL:en läses i en effekt, aldrig i en state-initierare: sidan server-renderas, och ett
  // `typeof window`-undantag hade gett servern förvalet och klienten den sparade fliken — en
  // hydreringskrock. Samma mönster som översiktens ?vecka= (useWeekBoard.ts).
  useEffect(() => {
    setRequestedTab(new URLSearchParams(window.location.search).get(TAB_PARAM));
  }, []);

  const selectTab = (id: ReportTabId) => {
    setRequestedTab(id);
    const url = new URL(window.location.href);
    if (id === DEFAULT_REPORT_TAB) url.searchParams.delete(TAB_PARAM);
    else url.searchParams.set(TAB_PARAM, id);
    // replaceState, inte router.replace: en router-navigering hade kostat en server-rundtur per
    // flikbyte, och "bakåt" ska lämna rapporten, inte stega genom flikarna.
    window.history.replaceState({}, '', url.toString());
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

  const tabs = useMemo(() => visibleReportTabs({ hasTime: report?.time != null }), [report]);
  const activeTab = resolveReportTab(requestedTab, tabs);
  const periodLabel = report ? periodChipLabel(report.range, Number(today().slice(0, 4))) : '';
  const panelShown = !loading && report != null;

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Header */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* min-w: på en smal skärm går knappen ner på egen rad i stället för att pressa texten till en spalt. */}
          <div className="min-w-[min(18rem,100%)] flex-1">
            <h1 className={cn('m-0', crm.pageTitle)}>Rapportering</h1>
            <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Försäljning, omsättning, produkt och marknad, produktion och tid för vald period. Alla belopp är exklusive moms, och avbrutna order räknas inte.</p>
          </div>
          <OwnerExportButton />
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

        <TabsList aria-label="Rapportens delar" className="gap-2">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              id={`report-tab-${tab.id}`}
              // Bara aktiv flik har sin panel i DOM, och bara när rapporten är laddad — aria-controls
              // utan panel vore en dinglande referens (samma regel som AdminTabsClient).
              aria-controls={activeTab === tab.id && panelShown ? `report-tabpanel-${tab.id}` : undefined}
              active={activeTab === tab.id}
              variant="card"
              onClick={() => selectTab(tab.id)}
            >
              <span className="text-sm font-bold">{tab.label}</span>
              <span className="text-[12px] font-normal text-slate-600">{tab.question}</span>
            </TabsTrigger>
          ))}
        </TabsList>
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
        <section role="tabpanel" id={`report-tabpanel-${activeTab}`} aria-labelledby={`report-tab-${activeTab}`}>
          {activeTab === 'oversikt' ? <OverviewTab report={report} periodLabel={periodLabel} /> : null}
          {activeTab === 'forsaljning' ? <SalesTab report={report} periodLabel={periodLabel} /> : null}
          {activeTab === 'omsattning' ? <RevenueTab report={report} periodLabel={periodLabel} /> : null}
          {activeTab === 'produkt' ? <ProductTab report={report} periodLabel={periodLabel} /> : null}
          {activeTab === 'produktion' ? <ProductionTab report={report} activeRangeKey={activeRangeKey} /> : null}
          {/* ⚠️ `time === null` = läsaren saknar `time.entry.read.all`; fliken finns då inte alls (se
              visibleReportTabs), så den här grenen nås inte heller via ?flik=tid. */}
          {activeTab === 'tid' && report.time ? <TimeTab report={report} /> : null}
        </section>
      ) : null}
    </div>
  );
}
