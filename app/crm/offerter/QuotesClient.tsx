"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import AssigneeFilter, { MINE, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import { RowAssignee, RowAssigneeChip } from '@/app/crm/components/RowAssignee';
import { documentRef } from '@/app/crm/lib/format';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { quoteCustomerName, isQuoteOverdue } from '@/app/crm/lib/quoteDisplay';
import QuoteDetailPanel from '@/app/crm/components/QuoteDetailPanel';
import useDocumentEmail from '@/app/crm/components/useDocumentEmail';

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
type QuoteSort = 'created_desc' | 'follow_up_asc';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const quoteFilterMeta: Record<QuoteFilter, { label: string }> = {
  all: { label: 'Alla' },
  active: { label: 'Aktiva' },
  follow_up: { label: 'Följ upp' },
  won: { label: 'Vunna' },
  lost: { label: 'Förlorade' },
};

const quoteSortMeta: Record<QuoteSort, { label: string }> = {
  created_desc: { label: 'Senast skapad' },
  follow_up_asc: { label: 'Följ upp först' },
};

// The list pages the same way the order board does: one page per filter, accumulated with
// "Visa fler". Filtering, counting and ordering all happen server-side — the row cap cuts before
// the browser sees anything, so a client-side tab would have been counting a truncated set.
const PAGE_SIZE = 100;
const EMPTY_COUNTS: Record<QuoteFilter, number> = { all: 0, active: 0, follow_up: 0, won: 0, lost: 0 };

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

// ─── QuotesClient ─────────────────────────────────────────────────────────────

export default function QuotesClient({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<QuoteFilter, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const [sort, setSort] = useState<QuoteSort>('created_desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  // 'mine' resolves to the current user before it goes to the server, the same way the order board
  // does it — the filter is server-side now, so the browser can't be the one deciding who's who.
  const assigneeParam = useMemo(
    () => assigneeFilter.map((v) => (v === MINE ? (currentUserId ?? '') : v)).filter(Boolean).join(','),
    [assigneeFilter, currentUserId],
  );

  const presetProspectId = searchParams.get('prospect_id') || '';
  const presetQuoteId = searchParams.get('quote_id') || '';
  const shouldOpenCreate = searchParams.get('new') === '1';

  // What the tab counts are computed over. They don't depend on the tab (every tab is counted) nor
  // on the sort (order can't change a count), so re-requesting five exact COUNTs on a sort toggle
  // would be five O(n) scans for a number that cannot move.
  const countScope = `${search.trim()}|${assigneeParam}|${presetProspectId}`;
  const countedScope = useRef<string | null>(null);

  // Bumped when something happens that can move a row between tabs, to force a reload.
  const [reloadKey, setReloadKey] = useState(0);

  function buildListQuery(nextOffset: number, withCounts: boolean) {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (presetProspectId) query.set('prospect_id', presetProspectId);
    query.set('filter', filter);
    query.set('sort', sort);
    if (assigneeParam) query.set('assignee', assigneeParam);
    query.set('offset', String(nextOffset));
    query.set('limit', String(PAGE_SIZE));
    if (withCounts) query.set('counts', '1');
    return query.toString();
  }

  async function loadMore() {
    if (loadingMore || quotes.length >= total) return;
    setLoadingMore(true);
    // The page being appended belongs to the query it was asked for. Change the sort mid-flight and
    // the first-page effect replaces the list under it; appending then mixes two orderings and
    // duplicates rows, so a response whose request no longer describes the visible list is dropped.
    const requestedFor = `${countScope}|${filter}|${sort}`;
    try {
      const res = await fetch(`/api/crm/quotes?${buildListQuery(quotes.length, false)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (requestedFor !== `${countScope}|${filter}|${sort}`) return;
      if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda fler offerter.'); return; }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      setQuotes((prev) => [...prev, ...items]);
      setTotal(json?.data?.total ?? total);
    } catch {
      setError('Kunde inte ladda fler offerter.');
    } finally {
      setLoadingMore(false);
    }
  }

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
  // Held here, not in the panel: the send flow has a dismissable progress overlay that must survive
  // the modal being closed.
  const documentEmail = useDocumentEmail();
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  // A quote reached by ?quote_id= that isn't on the loaded page. Feeds the panel only.
  const [linkedQuote, setLinkedQuote] = useState<QuoteItem | null>(null);
  const [hasHandledPreset, setHasHandledPreset] = useState(false);

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

  // Load the first page. Search, tab, sort and assignee are all server-side, so every one of them
  // starts a fresh page rather than re-filtering what happens to be in the browser.
  useEffect(() => {
    let active = true;
    const wantCounts = countedScope.current !== countScope;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/quotes?${buildListQuery(0, wantCounts)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda offerter.'); setQuotes([]); setTotal(0); return; }
        setQuotes(Array.isArray(json?.data?.items) ? json.data.items : []);
        setTotal(json?.data?.total ?? 0);
        if (json?.data?.counts) { setCounts(json.data.counts); countedScope.current = countScope; }
      } catch { if (active) { setError('Kunde inte ladda offerter.'); setQuotes([]); setTotal(0); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetProspectId, search, filter, sort, assigneeParam, reloadKey]);

  // Deep-link: open a specific quote's detail panel when arriving with ?quote_id= (e.g. from a
  // customer's related list). Handled once the matching quote is loaded so a manual close isn't
  // re-triggered.
  useEffect(() => { setHasHandledQuotePreset(false); }, [presetQuoteId]);

  // The linked quote need not be on the loaded page any more: it may be won while the tab shows
  // "Aktiva", or simply sit past the first page. Fetch that one row so the link opens the panel it
  // promised — but keep it OUT of the list, which stays exactly the page the server returned. A
  // prepended row would sit at the top in defiance of the chosen sort once the panel closes.
  useEffect(() => {
    if (!presetQuoteId || hasHandledQuotePreset || loading) return;
    if (quotes.some((q) => q.id === presetQuoteId) || linkedQuote?.id === presetQuoteId) return;
    let active = true;
    fetch(`/api/crm/quotes/${presetQuoteId}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active && json?.ok && json?.data?.item) setLinkedQuote(json.data.item); })
      .catch(() => { /* the panel simply won't open — the list is still usable */ });
    return () => { active = false; };
  }, [presetQuoteId, hasHandledQuotePreset, loading, quotes, linkedQuote]);

  useEffect(() => {
    if (!presetQuoteId || hasHandledQuotePreset || loading) return;
    if (!quotes.some((q) => q.id === presetQuoteId) && linkedQuote?.id !== presetQuoteId) return;
    setDetailQuoteId(presetQuoteId);
    setDetailPanelOpen(true);
    setHasHandledQuotePreset(true);
  }, [presetQuoteId, hasHandledQuotePreset, loading, quotes, linkedQuote]);

  // Count of active filters (status + assignee) — shown as a badge on the mobile toggle.
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);
  const hasMore = quotes.length < total;

  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) if (a.full_name) map.set(a.id, a.full_name);
    return map;
  }, [assignees]);

  const detailQuote = useMemo(() => {
    if (!detailQuoteId) return null;
    return quotes.find((q) => q.id === detailQuoteId)
      ?? (linkedQuote?.id === detailQuoteId ? linkedQuote : null);
  }, [detailQuoteId, quotes, linkedQuote]);

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
              'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-lg border p-0 transition sm:hidden',
              filtersOpen || activeFilterCount > 0
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-[#dce4d8] bg-white text-slate-600',
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
                    {counts[value]}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Sort: newest first by default, nearest follow-up as the other view. Server-side, since
              the list is paginated — ordering the loaded page would only sort the first hundred. */}
          <label className="flex items-center gap-1.5 text-[13px] text-slate-500">
            <span className="shrink-0">Sortera</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as QuoteSort)}
              className="rounded-lg border border-[#dce4d8] bg-white px-2 py-1 text-[13px] font-semibold text-slate-700"
            >
              {(Object.keys(quoteSortMeta) as QuoteSort[]).map((value) => (
                <option key={value} value={value}>{quoteSortMeta[value].label}</option>
              ))}
            </select>
          </label>
          <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:ml-auto sm:w-[200px]" />
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-400">Laddar offerter…</div> : null}
        {!loading && quotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
            Inga offerter matchar just nu.
          </div>
        ) : null}

        {!loading && quotes.length > 0 ? (
          <div className="grid gap-1">
            {quotes.map((item) => {
              const overdue = isQuoteOverdue(item);
              const statusMeta = quoteStatusMeta[item.status];
              // Inget 'Okänd'-fallback: katalogen hämtas i en egen request, så ett tomt uppslag
              // betyder oftast "inte hämtad ännu" och inte "okänd person". RowAssignee skiljer
              // de två tillstånden åt.
              const sellerName = item.assigned_to ? (assigneeNameById.get(item.assigned_to) ?? null) : null;
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

                  {/* Ansvarig-kolumnen är 116px och inte 48px: den rymmer namnet, inte bara en
                      initialbricka man måste hovra på. Utrymmet tas ur identitetskolumnen, som är
                      den flexibla — de två högerkolumnerna har fast innehåll. */}
                  <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_48px_140px_128px] md:grid-cols-[minmax(0,1fr)_116px_140px_128px] lg:grid-cols-[minmax(0,1fr)_150px_140px_128px] sm:items-center sm:gap-3">
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
                          {/* Ansvarig på mobil, där kolumnen till höger inte får plats */}
                          <RowAssigneeChip name={sellerName} />
                        </div>
                      </div>
                    </div>

                    {/* Ansvarig säljare, i en fast slot så den aldrig driver i sidled */}
                    <RowAssignee name={sellerName} assigned={Boolean(item.assigned_to)} />

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

        {/* Visa fler — server-side pagination so the list never silently truncates. Without it the
            row cap cut from the tail of the sort, which meant won and sent quotes vanished first. */}
        {!loading && hasMore ? (
          <div className="flex flex-col items-center gap-1 pt-1">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-full border border-[#dce4d8] bg-white px-4 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:border-[#c8d4c3] disabled:opacity-60"
            >
              {loadingMore ? 'Laddar…' : 'Visa fler'}
            </button>
            <span className="text-[11px] text-slate-400">Visar {quotes.length} av {total}</span>
          </div>
        ) : null}
      </div>

      {/* ── Detail panel ── */}
      {detailPanelOpen && detailQuote ? (
        <QuoteDetailPanel
          quote={detailQuote}
          workOrderFortnoxNumber={detailQuote.work_order_id ? (workOrderFortnoxById.get(detailQuote.work_order_id) ?? null) : null}
          returnTo={`/crm/offerter?quote_id=${detailQuote.id}`}
          documentEmail={documentEmail}
          onClose={() => setDetailPanelOpen(false)}
          onQuoteChanged={(patch) => {
            setQuotes((current) => current.map((q) => (q.id === patch.id ? { ...q, ...patch } : q)));
            // Keep the open panel alive across a reload that may drop its row from the page: hold
            // the patched quote outside the list. Without this, marking a draft "Vunnen" from the
            // "Aktiva" tab would reload the list, lose the row, and unmount the panel mid-click.
            const patched = quotes.find((q) => q.id === patch.id) ?? linkedQuote;
            if (patched && patched.id === patch.id) setLinkedQuote({ ...patched, ...patch });
            // A status change moves the row between tabs and moves two counters. The tabs are
            // server-side now, so the browser can no longer make that happen by re-filtering an
            // array — it has to ask again, counts included.
            if (patch.status && patch.status !== patched?.status) {
              countedScope.current = null;
              setReloadKey((key) => key + 1);
            }
          }}
        />
      ) : null}

      {documentEmail.modal}
    </div>
  );
}
