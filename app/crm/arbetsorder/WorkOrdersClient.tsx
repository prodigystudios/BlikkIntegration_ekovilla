"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, syncStatusClass, workOrderStatusLabel, workOrderStatusClass, workOrderStatusAccent } from '@/app/crm/lib/crmTokens';
import { formatDate, formatCurrency, isWorkOrderOverdue, documentRef } from '@/app/crm/lib/format';
import AssigneeFilter, { matchesAssignee, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import CrmModal from '@/app/crm/components/CrmModal';
import EntityCombobox, { type EntityResult } from '@/app/crm/components/EntityCombobox';
import { useToast } from '@/lib/Toast';

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled';
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

function matchesFilter(item: WorkOrderItem, filter: WorkOrderFilter) {
  if (filter === 'all') return true;
  if (filter === 'draft') return item.status === 'draft';
  if (filter === 'scheduled') return item.status === 'scheduled' || item.status === 'ready';
  if (filter === 'completed') return item.status === 'completed';
  if (filter === 'invoiced') return item.status === 'invoiced';
  return item.status === 'in_progress';
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkOrderFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

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

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/work-orders${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder.'); setWorkOrders([]); return; }
        setWorkOrders(Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch { if (active) { setError('Kunde inte ladda arbetsorder.'); setWorkOrders([]); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [search]);

  const filterCounts = useMemo(() => {
    const counts = {} as Record<WorkOrderFilter, number>;
    const scoped = workOrders.filter((item) => matchesAssignee(item.assigned_to, assigneeFilter, currentUserId));
    for (const [value] of FILTERS) counts[value] = scoped.filter((item) => matchesFilter(item, value)).length;
    return counts;
  }, [workOrders, assigneeFilter, currentUserId]);

  const visibleWorkOrders = useMemo(
    () => workOrders.filter((item) => matchesFilter(item, filter) && matchesAssignee(item.assigned_to, assigneeFilter, currentUserId)),
    [filter, workOrders, assigneeFilter, currentUserId],
  );

  // Count of active filters (status + assignee) — shown as a badge on the mobile toggle.
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Arbetsorder</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Öppna en arbetsorder för arbetsytan med översikt, ekonomi, artiklar, tid och kommentarer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på ordernummer, projekt eller kund"
            className="max-w-sm"
          />
          <button
            type="button"
            onClick={() => setNewOrderOpen(true)}
            className={crm.primaryButton}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            <span aria-hidden>+</span> Ny order
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* List card */}
      <div className={crm.card}>
        {/* Toolbar */}
        <div className="grid gap-3 border-b border-[#e0e8dc] px-5 py-3">
          {/* Mobile filter toggle */}
          <div className="flex items-center justify-between gap-3 sm:hidden">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className={cn(
                'relative inline-flex items-center gap-2 !rounded-lg !border px-3 py-2 text-sm font-semibold transition',
                filtersOpen || activeFilterCount > 0 ? '!border-emerald-500 !bg-emerald-50 text-emerald-700' : '!border-[#dce4d8] !bg-white text-slate-600',
              )}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              Filter
              {activeFilterCount > 0 ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
              ) : null}
            </button>
            <span className="whitespace-nowrap text-xs text-slate-400">{workOrders.length} i registret</span>
          </div>

          {/* Filters — collapsible on mobile, inline on desktop */}
          <div className={cn('flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-between', filtersOpen ? 'flex' : 'hidden')}>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                    filter === value ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
                  )}
                  style={filter === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                >
                  {label} <span className={cn('ml-0.5', filter === value ? 'text-white/70' : 'text-slate-400')}>{filterCounts[value]}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:w-[200px]" />
              <span className="hidden whitespace-nowrap text-xs text-slate-400 sm:inline">{workOrders.length} i registret</span>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="p-4">
          {loading ? <div className="py-4 text-sm text-slate-500">Laddar arbetsorder…</div> : null}
          {!loading && visibleWorkOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-8 text-center text-sm text-slate-500">
              Inga arbetsorder matchar just nu.
            </div>
          ) : null}

          {!loading && visibleWorkOrders.length > 0 ? (
            <div className="grid gap-2">
              {visibleWorkOrders.map((item) => {
                const overdue = isWorkOrderOverdue(item.desired_installation_date, item.status);
                const sellerName = item.assignee?.full_name || null;
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

                    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_170px_140px_auto] sm:items-center sm:gap-4">
                      {/* Number badge + identity + chips */}
                      <div className="flex min-w-0 items-center gap-3">
                        <DocumentNumberBadge label="Order" value={documentRef(item.fortnox_order_number, item.order_number)} />
                        <div className="grid min-w-0 gap-1">
                          <strong className="truncate text-sm font-bold text-slate-900">{item.project_name}</strong>
                          <span className="truncate text-xs text-slate-500">{item.client_name}</span>
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
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

                      {/* Responsible installer/seller */}
                      <div className="hidden items-center gap-2 sm:flex">
                        <span className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                          sellerName ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400',
                        )}>
                          {initialsOf(sellerName)}
                        </span>
                        <div className="grid min-w-0">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Ansvarig</span>
                          <span className={cn('truncate text-xs font-semibold', sellerName ? 'text-slate-700' : 'text-slate-400')}>
                            {sellerName ?? 'Ej tilldelad'}
                          </span>
                        </div>
                      </div>

                      {/* Date */}
                      <div className="hidden flex-col gap-0.5 sm:flex">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Planerad</span>
                        <span className={cn('text-xs font-medium', overdue ? 'text-rose-600' : 'text-slate-600')}>
                          {overdue ? '⚠ ' : ''}{formatDate(item.desired_installation_date)}
                        </span>
                      </div>

                      {/* Amount + chevron (amount hidden on mobile — name takes priority) */}
                      <div className="flex items-center justify-end gap-3">
                        <span className="hidden whitespace-nowrap text-sm font-bold tabular-nums text-slate-900 sm:inline sm:text-base">
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
        </div>
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
