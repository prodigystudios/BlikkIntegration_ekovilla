"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, syncStatusClass, workOrderStatusLabel, workOrderStatusClass, workOrderStatusAccent } from '@/app/crm/lib/crmTokens';
import { formatDate, formatCurrency, isWorkOrderOverdue, documentRef } from '@/app/crm/lib/format';
import AssigneeFilter, { MINE, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import CrmModal from '@/app/crm/components/CrmModal';
import EntityCombobox, { type EntityResult } from '@/app/crm/components/EntityCombobox';
import { useToast } from '@/lib/Toast';

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';
type FortnoxSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

type WorkOrderItem = {
  id: string;
  order_number: string;
  project_name: string;
  client_name: string;
  pricing_summary: { total?: number } | null;
  line_items: Array<unknown> | null;
  amount: number | string;
  currency_code: string;
  desired_installation_date: string | null;
  status: WorkOrderStatus;
  assigned_to: string | null;
  assignee: { id: string; full_name: string | null } | null;
  fortnox_order_number: string | null;
  fortnox_order_sync_status: FortnoxSyncStatus;
};

type WorkOrderFilter = 'all' | 'draft' | 'scheduled' | 'active' | 'completed' | 'invoiced';

// Status labels/classes are centralised in crmTokens (shared with detail + card).

const FILTERS: Array<[WorkOrderFilter, string]> = [
  ['all', 'Alla'], ['draft', 'Ej planerade'], ['scheduled', 'Planerade'], ['active', 'Pågående'], ['completed', 'Fakturera'], ['invoiced', 'Avslutade'],
];

// Status filtering and pagination are now server-side (see lib/domains/crm/work-orders.ts).
// The board fetches one page per filter and accumulates via "Visa fler".
const PAGE_SIZE = 100;
const EMPTY_COUNTS: Record<WorkOrderFilter, number> = { all: 0, draft: 0, scheduled: 0, active: 0, completed: 0, invoiced: 0 };

function initialsOf(name: string | null | undefined) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


export default function WorkOrdersClient({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<WorkOrderFilter, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkOrderFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  // 'mine' → the current user id, resolved before the request so status/assignee filtering and
  // counts are all computed server-side (the list can exceed the PostgREST row cap).
  const assigneeParam = useMemo(
    () => assigneeFilter.map((v) => (v === MINE ? (currentUserId ?? '') : v)).filter(Boolean).join(','),
    [assigneeFilter, currentUserId],
  );

  function buildListQuery(nextOffset: number) {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    query.set('filter', filter);
    if (assigneeParam) query.set('assignee', assigneeParam);
    query.set('offset', String(nextOffset));
    query.set('limit', String(PAGE_SIZE));
    // Chip counts only need recomputing on a fresh first page, not on "Visa fler".
    if (nextOffset === 0) query.set('counts', '1');
    return query.toString();
  }

  async function loadMore() {
    if (loadingMore || workOrders.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/crm/work-orders?${buildListQuery(workOrders.length)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ladda fler arbetsorder.'); return; }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      setWorkOrders((prev) => [...prev, ...items]);
      setTotal(json?.data?.total ?? total);
    } catch {
      toast.error('Kunde inte ladda fler arbetsorder.');
    } finally {
      setLoadingMore(false);
    }
  }

  // "Ny order" (standalone, no quote) — requires a linked customer.
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderCustomerLabel, setNewOrderCustomerLabel] = useState('');
  const [newOrderName, setNewOrderName] = useState('');
  const [newOrderDate, setNewOrderDate] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);

  async function searchCustomers(query: string): Promise<EntityResult[]> {
    const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
    return items.map((c: { id: string; display_name: string; organization_number: string | null; city: string | null }) => ({
      id: c.id,
      label: c.display_name || 'Okänd kund',
      sublabel: [c.organization_number, c.city].filter(Boolean).join(' · ') || undefined,
    }));
  }

  function resetNewOrder() {
    setNewOrderOpen(false);
    setNewOrderCustomerId('');
    setNewOrderCustomerLabel('');
    setNewOrderName('');
    setNewOrderDate('');
  }

  async function createOrder() {
    if (!newOrderCustomerId) { toast.error('Välj en kund'); return; }
    if (!newOrderName.trim()) { toast.error('Ange ett ordernamn'); return; }
    setCreatingOrder(true);
    try {
      const res = await fetch('/api/crm/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: newOrderCustomerId,
          project_name: newOrderName.trim(),
          desired_installation_date: newOrderDate || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa order'); return; }
      const item = json?.data?.item as { id?: string; order_number?: string } | undefined;
      toast.success(item?.order_number ? `Order skapad: ${item.order_number}` : 'Order skapad');
      resetNewOrder();
      if (item?.id) router.push(`/crm/arbetsorder/${item.id}`);
    } catch {
      toast.error('Kunde inte skapa order');
    } finally {
      setCreatingOrder(false);
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

  // Legacy deep-link: /crm/arbetsorder?work_order_id=X now lives at its own page.
  const deepLinkId = searchParams.get('work_order_id') || '';
  useEffect(() => {
    if (deepLinkId) router.replace(`/crm/arbetsorder/${deepLinkId}`);
  }, [deepLinkId, router]);

  // Reset + first page whenever the search, status filter or assignee scope changes. The
  // server filters and paginates; the chip counts come back on the first page (offset 0).
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/work-orders?${buildListQuery(0)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder.'); setWorkOrders([]); setTotal(0); return; }
        setWorkOrders(Array.isArray(json?.data?.items) ? json.data.items : []);
        setTotal(json?.data?.total ?? 0);
        if (json?.data?.counts) setCounts(json.data.counts);
      } catch { if (active) { setError('Kunde inte ladda arbetsorder.'); setWorkOrders([]); setTotal(0); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, assigneeParam]);

  const hasMore = workOrders.length < total;

  // Resolve the responsible user's name from the admin-sourced assignees list. The
  // work-order list is read with the session client, whose profiles RLS only returns the
  // current user's own profile — so `item.assignee` (the joined profile) is null for
  // colleagues' orders. Map by assigned_to instead (same approach as the quotes list).
  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) if (a.full_name) map.set(a.id, a.full_name);
    return map;
  }, [assignees]);

  // Count of active filters (status + assignee) — shown as a badge on the mobile toggle.
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Arbetsorder</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Öppna en arbetsorder för arbetsytan med översikt, ekonomi, artiklar, tid och kommentarer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOrderOpen(true)}
          className="inline-flex items-center rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Ny order
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* List card */}
      <div className="grid gap-2 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-2.5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)] md:p-3">
        {/* Search + mobile filter toggle */}
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på ordernummer, projekt eller kund"
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
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition',
                  filter === value ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
                )}
                style={filter === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
              >
                {label} <span className={cn('ml-0.5', filter === value ? 'text-white/70' : 'text-slate-400')}>{counts[value]}</span>
              </button>
            ))}
          </div>
          <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:ml-auto sm:w-[200px]" />
        </div>

        {/* List */}
        {loading ? <div className="py-4 text-sm text-slate-500">Laddar arbetsorder…</div> : null}
          {!loading && workOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-8 text-center text-sm text-slate-500">
              Inga arbetsorder matchar just nu.
            </div>
          ) : null}

          {!loading && workOrders.length > 0 ? (
            <div className="grid gap-1">
              {workOrders.map((item) => {
                const overdue = isWorkOrderOverdue(item.desired_installation_date, item.status);
                const sellerName = item.assigned_to
                  ? (assigneeNameById.get(item.assigned_to) || item.assignee?.full_name || 'Okänd')
                  : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => router.push(`/crm/arbetsorder/${item.id}`)}
                    className={cn(
                      'group relative flex items-stretch overflow-hidden rounded-lg border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_20px_-10px_rgba(20,44,27,0.30)]',
                      overdue ? 'border-rose-200' : 'border-[#e3e9df]',
                    )}
                  >
                    {/* Status accent rail */}
                    <span className={cn('w-1.5 shrink-0', workOrderStatusAccent[item.status])} aria-hidden="true" />

                    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_48px_140px_128px] sm:items-center sm:gap-3">
                      {/* Number badge + identity + chips */}
                      <div className="flex min-w-0 items-center gap-2">
                        <DocumentNumberBadge label="Order" value={documentRef(item.fortnox_order_number, item.order_number)} />
                        <div className="grid min-w-0 gap-0.5">
                          <strong className="truncate text-[13px] font-bold text-slate-900">{item.project_name}</strong>
                          <span className="truncate text-[11px] text-slate-500">{item.client_name}</span>
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', workOrderStatusClass[item.status])}>
                              {workOrderStatusLabel[item.status]}
                            </span>
                            {overdue ? (
                              <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                Försenad
                              </span>
                            ) : null}
                            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                              {(item.line_items || []).length} rader
                            </span>
                            <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', syncStatusClass[item.fortnox_order_sync_status])}>
                              Fortnox: {syncStatusLabel[item.fortnox_order_sync_status]}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Responsible installer/seller — avatar pill only, in a fixed slot so it never drifts */}
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

                      {/* Date */}
                      <div className="hidden flex-col gap-0.5 sm:flex">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Planerad</span>
                        <span className={cn('text-[11px] font-medium', overdue ? 'text-rose-600' : 'text-slate-600')}>
                          {overdue ? '⚠ ' : ''}{formatDate(item.desired_installation_date)}
                        </span>
                      </div>

                      {/* Amount + chevron (amount hidden on mobile — name takes priority) */}
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-900 sm:inline sm:text-sm">
                          {formatCurrency(item.pricing_summary?.total ?? item.amount, item.currency_code)}
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

          {/* Visa fler — server-side pagination so the board never silently truncates */}
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
              <span className="text-[11px] text-slate-400">Visar {workOrders.length} av {total}</span>
            </div>
          ) : null}
      </div>

      {/* ── Ny order (standalone) ── */}
      {newOrderOpen ? (
        <CrmModal
          onClose={resetNewOrder}
          ariaLabel="Ny order"
          maxWidth="sm:max-w-[520px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">Ny order</h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Skapa en order utan offert. Lägg till artiklar efteråt på ordern.</p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={resetNewOrder}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void createOrder()}
                disabled={creatingOrder || !newOrderCustomerId || !newOrderName.trim()}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {creatingOrder ? 'Skapar…' : 'Skapa order'}
              </button>
            </>
          }
        >
          <div className="grid gap-4">
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Kund</p>
              <EntityCombobox
                value={newOrderCustomerId}
                valueLabel={newOrderCustomerLabel}
                onChange={(id, label) => { setNewOrderCustomerId(id); setNewOrderCustomerLabel(label); }}
                onClear={() => { setNewOrderCustomerId(''); setNewOrderCustomerLabel(''); }}
                search={searchCustomers}
                placeholder="Sök kund…"
              />
            </div>
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Ordernamn / projekt</p>
              <Input value={newOrderName} onChange={(e) => setNewOrderName(e.target.value)} placeholder="Ex. Lösull vind, Lindberg" />
            </div>
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Önskat installationsdatum (valfritt)</p>
              <Input value={newOrderDate} onChange={(e) => setNewOrderDate(e.target.value)} type="date" lang="sv-SE" />
            </div>
          </div>
        </CrmModal>
      ) : null}
    </div>
  );
}
