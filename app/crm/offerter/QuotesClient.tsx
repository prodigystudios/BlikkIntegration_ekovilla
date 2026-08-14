"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import AssigneeFilter, { matchesAssignee, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import { documentRef } from '@/app/crm/lib/format';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { quoteCustomerName, isQuoteOverdue } from '@/app/crm/lib/quoteDisplay';
import QuoteDetailPanel from '@/app/crm/components/QuoteDetailPanel';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuoteItem = {
  id: string;
  quote_number: string | null;
  prospect_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_source: { kind?: string | null } | null;
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
    email?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  prospect: { id: string; company_name: string; contact_name: string | null; city: string | null; status: string } | Array<{ id: string; company_name: string; contact_name: string | null; city: string | null; status: string }> | null;
  project_name: string;
  description: string | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  valid_until: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  converted_to_work_order_at: string | null;
  fortnox_offer_number: string | null;
  fortnox_sync_status: 'not_synced' | 'pending' | 'synced' | 'failed' | null;
  fortnox_synced_at: string | null;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type QuoteFilter = 'all' | 'active' | 'follow_up' | 'won' | 'lost';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const quoteFilterMeta: Record<QuoteFilter, { label: string }> = {
  all: { label: 'Alla' },
  active: { label: 'Aktiva' },
  follow_up: { label: 'Följ upp' },
  won: { label: 'Vunna' },
  lost: { label: 'Förlorade' },
};

function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function initialsOf(name: string | null | undefined) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


function compareQuotes(a: QuoteItem, b: QuoteItem) {
  const aOverdue = isQuoteOverdue(a);
  const bOverdue = isQuoteOverdue(b);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  if (a.follow_up_date && b.follow_up_date && a.follow_up_date !== b.follow_up_date) {
    return a.follow_up_date.localeCompare(b.follow_up_date);
  }
  if (a.quote_date !== b.quote_date) return b.quote_date.localeCompare(a.quote_date);
  return b.updated_at.localeCompare(a.updated_at);
}

// ─── QuotesClient ─────────────────────────────────────────────────────────────

export default function QuotesClient({ currentUserId }: { currentUserId: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch('/api/crm/work-orders/assignees', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setAssignees(json?.ok ? json.data?.items || [] : []); })
      .catch(() => { if (active) setAssignees([]); });
    return () => { active = false; };
  }, []);
  // Offer + order-confirmation e-mail (own mail client, with recipient resolution).
  // Map of work_order_id → its Fortnox order number, so the offer list AO-chip and the
  // modal's work-order reference can lead with the Fortnox number (the quote row itself
  // doesn't carry it). Fetched once from the work-orders list (one request, no per-row
  // fetch, no DB join needed).
  const [workOrderFortnoxById, setWorkOrderFortnoxById] = useState<Map<string, string | null>>(new Map());
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [hasHandledPreset, setHasHandledPreset] = useState(false);

  const presetProspectId = searchParams.get('prospect_id') || '';
  const presetQuoteId = searchParams.get('quote_id') || '';
  const shouldOpenCreate = searchParams.get('new') === '1';
  const [hasHandledQuotePreset, setHasHandledQuotePreset] = useState(false);

  // Redirect preset "new=1" links to the form page
  useEffect(() => {
    if (!shouldOpenCreate || hasHandledPreset || loading) return;
    setHasHandledPreset(true);
    const params = new URLSearchParams();
    if (presetProspectId) params.set('prospect_id', presetProspectId);
    router.push(`/crm/offerter/ny${params.size > 0 ? `?${params}` : ''}`);
  }, [shouldOpenCreate, hasHandledPreset, loading, presetProspectId, router]);

  useEffect(() => {
    setHasHandledPreset(false);
  }, [presetProspectId, shouldOpenCreate]);

  // Load quotes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (presetProspectId) query.set('prospect_id', presetProspectId);

    fetch(`/api/crm/quotes${query.size > 0 ? `?${query}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        if (!json.ok) { setError(json?.error || 'Kunne inte ladda offerter.'); setQuotes([]); return; }
        setQuotes(Array.isArray(json?.data?.items) ? json.data.items : []);
      })
      .catch(() => { if (active) { setError('Kunde inte ladda offerter.'); setQuotes([]); } })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [presetProspectId, search]);

  // Deep-link: open a specific quote's detail panel when arriving with
  // ?quote_id= (e.g. from a customer's related list). Handled once the matching
  // quote is loaded so a manual close isn't re-triggered.
  useEffect(() => { setHasHandledQuotePreset(false); }, [presetQuoteId]);

  useEffect(() => {
    if (!presetQuoteId || hasHandledQuotePreset || loading) return;
    if (!quotes.some((q) => q.id === presetQuoteId)) return;
    setDetailQuoteId(presetQuoteId);
    setDetailPanelOpen(true);
    setHasHandledQuotePreset(true);
  }, [presetQuoteId, hasHandledQuotePreset, loading, quotes]);

  // Count of active filters (status + assignee) — shown as a badge on the mobile toggle.
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);

  // Scope the whole page (list, stats, chip counts) to the chosen "Ansvarig" filter.
  const assigneeScopedQuotes = useMemo(
    () => quotes.filter((q) => matchesAssignee(q.assigned_to, assigneeFilter, currentUserId)),
    [quotes, assigneeFilter, currentUserId],
  );

  const visibleQuotes = useMemo(() => {
    if (filter === 'all') return assigneeScopedQuotes;
    if (filter === 'active') return assigneeScopedQuotes.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up');
    if (filter === 'follow_up') return assigneeScopedQuotes.filter((q) => q.status === 'follow_up');
    if (filter === 'won') return assigneeScopedQuotes.filter((q) => q.status === 'won');
    return assigneeScopedQuotes.filter((q) => q.status === 'lost');
  }, [filter, assigneeScopedQuotes]);

  const sortedVisibleQuotes = useMemo(() => [...visibleQuotes].sort(compareQuotes), [visibleQuotes]);

  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) if (a.full_name) map.set(a.id, a.full_name);
    return map;
  }, [assignees]);

  const filterCounts = useMemo<Record<QuoteFilter, number>>(() => ({
    all: assigneeScopedQuotes.length,
    active: assigneeScopedQuotes.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up').length,
    follow_up: assigneeScopedQuotes.filter((q) => q.status === 'follow_up').length,
    won: assigneeScopedQuotes.filter((q) => q.status === 'won').length,
    lost: assigneeScopedQuotes.filter((q) => q.status === 'lost').length,
  }), [assigneeScopedQuotes]);

  const detailQuote = useMemo(
    () => (detailQuoteId ? quotes.find((q) => q.id === detailQuoteId) || null : null),
    [detailQuoteId, quotes],
  );

  // The offer is locked in Fortnox only once it's been converted to an order (a work
  // order exists) AND its sync didn't fail. If the sync failed we must NOT show "Låst"
  // / hide re-sync — the salesperson still needs to recover.

  // Amount display for the detail hero follows the same convention as the list rows.

  // Load the work-orders list once and index Fortnox order numbers by work_order_id.
  useEffect(() => {
    let active = true;
    fetch('/api/crm/work-orders', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!active) return;
        const items: Array<{ id: string; fortnox_order_number: string | null }> = j?.ok && Array.isArray(j?.data?.items) ? j.data.items : [];
        setWorkOrderFortnoxById(new Map(items.map((w) => [w.id, w.fortnox_order_number ?? null])));
      })
      .catch(() => { if (active) setWorkOrderFortnoxById(new Map()); });
    return () => { active = false; };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Offerter</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Skapa och följ upp offerter
            {presetProspectId ? <span className="ml-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">Filtrerad på prospekt</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/crm/offerter/ny')}
          className="inline-flex items-center rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Skapa offert
        </button>
      </div>

      {/* Quote list */}
      <div className="grid gap-2 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-2.5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)] md:p-3">
        {/* Search + mobile filter toggle */}
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på offert, kund eller anteckning"
            className="flex-1 sm:max-w-xs"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-label="Filter"
            className={cn(
              'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center !rounded-lg !border !p-0 transition sm:hidden',
              filtersOpen || activeFilterCount > 0
                ? '!border-emerald-500 !bg-emerald-50 text-emerald-700'
                : '!border-[#dce4d8] !bg-white text-slate-600',
            )}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {activeFilterCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        {/* Filters — collapsible on mobile, inline on desktop */}
        <div className={cn('flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center', filtersOpen ? 'flex' : 'hidden')}>
          <div className="flex flex-wrap gap-1.5">
            {((['all', 'active', 'follow_up', 'won', 'lost']) as const).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
                    active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={active ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {quoteFilterMeta[value].label}
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600')}>
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
          <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:ml-auto sm:w-[200px]" />
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-400">Laddar offerter…</div> : null}
        {!loading && visibleQuotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
            Inga offerter matchar just nu.
          </div>
        ) : null}

        {!loading && visibleQuotes.length > 0 ? (
          <div className="grid gap-1">
            {sortedVisibleQuotes.map((item) => {
              const overdue = isQuoteOverdue(item);
              const statusMeta = quoteStatusMeta[item.status];
              const sellerName = item.assigned_to ? (assigneeNameById.get(item.assigned_to) || 'Okänd') : null;
              // Private → show price incl moms; business → show ex moms (with the basis tagged).
              const amountDisplay = quoteAmountDisplay(item.quote_type, resolveQuoteVatBreakdown(item));

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setDetailQuoteId(item.id); setDetailPanelOpen(true); }}
                  className={cn(
                    'group relative flex items-stretch overflow-hidden rounded-lg border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_20px_-10px_rgba(20,44,27,0.30)]',
                    overdue ? 'border-amber-200' : 'border-[#e3e9df]',
                  )}
                >
                  {/* Status accent rail */}
                  <span className={cn('w-1.5 shrink-0', statusMeta.accent)} aria-hidden="true" />

                  <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_48px_140px_128px] sm:items-center sm:gap-3">
                    {/* Number badge + identity + chips */}
                    <div className="flex min-w-0 items-center gap-2">
                      <DocumentNumberBadge label="Offert" value={documentRef(item.fortnox_offer_number, item.quote_number)} />
                      <div className="grid min-w-0 gap-0.5">
                        <strong className="truncate text-[13px] font-bold text-slate-900">{item.project_name}</strong>
                        <span className="truncate text-[11px] text-slate-500">{quoteCustomerName(item)}</span>
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', statusMeta.className)}>
                            {statusMeta.label}
                          </span>
                          <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {item.quote_type === 'private' ? 'Privat' : 'Företag'}
                          </span>
                          {item.work_order_id ? (
                            <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              Order {documentRef(workOrderFortnoxById.get(item.work_order_id) ?? null, item.work_order_number)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Responsible seller — avatar pill only, in a fixed slot so it never drifts */}
                    <div className="hidden items-center justify-center sm:flex">
                      <span
                        title={sellerName ?? 'Ej tilldelad'}
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                          sellerName ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {initialsOf(sellerName)}
                      </span>
                    </div>

                    {/* Dates */}
                    <div className="hidden flex-col gap-0.5 sm:flex">
                      <span className="text-[11px] font-medium text-slate-600">{formatDate(item.quote_date)}</span>
                      {item.follow_up_date ? (
                        <span className={cn('text-[11px] font-semibold', overdue ? 'text-amber-700' : 'text-slate-400')}>
                          {overdue ? '⚠ ' : ''}Följ upp {formatDate(item.follow_up_date)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300">Ingen uppföljning</span>
                      )}
                    </div>

                    {/* Amount + chevron (amount hidden on mobile — name takes priority) */}
                    <div className="flex items-center justify-end gap-2">
                      <span className="hidden flex-col items-end leading-tight sm:flex">
                        <span className="whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-900 sm:text-sm">
                          {formatCurrency(amountDisplay.primary, item.currency_code)}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">{amountDisplay.basisSuffix}</span>
                      </span>
                      <svg className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ── Detail panel ── */}
      {detailPanelOpen && detailQuote ? (
        <QuoteDetailPanel
          quote={detailQuote}
          workOrderFortnoxNumber={detailQuote.work_order_id ? (workOrderFortnoxById.get(detailQuote.work_order_id) ?? null) : null}
          onClose={() => setDetailPanelOpen(false)}
          onQuoteChanged={(updated) => setQuotes((current) => current.map((q) => (q.id === updated.id ? { ...q, ...updated } : q)))}
        />
      ) : null}
    </div>
  );
}
