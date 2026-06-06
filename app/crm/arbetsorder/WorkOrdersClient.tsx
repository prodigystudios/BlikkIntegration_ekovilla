"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, syncStatusClass } from '@/app/crm/lib/crmTokens';

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
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
  assignee: { id: string; full_name: string | null } | null;
  fortnox_order_sync_status: FortnoxSyncStatus;
};

type WorkOrderFilter = 'all' | 'draft' | 'scheduled' | 'active' | 'completed';

const workOrderStatusMeta: Record<WorkOrderStatus, { label: string; className: string }> = {
  draft:       { label: 'Utkast',   className: 'border-slate-200 bg-slate-50 text-slate-600' },
  scheduled:   { label: 'Planerad', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  ready:       { label: 'Redo',     className: 'border-amber-200 bg-amber-50 text-amber-700' },
  in_progress: { label: 'Pågår',    className: 'border-violet-200 bg-violet-50 text-violet-700' },
  completed:   { label: 'Klar',     className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled:   { label: 'Avbruten', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

const FILTERS: Array<[WorkOrderFilter, string]> = [
  ['all', 'Alla'], ['draft', 'Utkast'], ['scheduled', 'Planerade'], ['active', 'Pågående'], ['completed', 'Klara'],
];

function matchesFilter(item: WorkOrderItem, filter: WorkOrderFilter) {
  if (filter === 'all') return true;
  if (filter === 'draft') return item.status === 'draft';
  if (filter === 'scheduled') return item.status === 'scheduled' || item.status === 'ready';
  if (filter === 'completed') return item.status === 'completed';
  return item.status === 'in_progress';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}
function formatCurrency(value: number | string | null | undefined, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '0'));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}
function isOverdue(date: string | null, status: WorkOrderStatus) {
  if (!date || status === 'completed' || status === 'cancelled') return false;
  const d = new Date(`${date}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export default function WorkOrdersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkOrderFilter>('all');

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
    for (const [value] of FILTERS) counts[value] = workOrders.filter((item) => matchesFilter(item, value)).length;
    return counts;
  }, [workOrders]);

  const visibleWorkOrders = useMemo(() => workOrders.filter((item) => matchesFilter(item, filter)), [filter, workOrders]);

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
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Sök på ordernummer, projekt eller kund"
          className="max-w-sm"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* List card */}
      <div className={crm.card}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0e8dc] px-5 py-3">
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
          <span className="text-xs text-slate-400">{workOrders.length} i registret</span>
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
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleWorkOrders.map((item) => {
                const meta = workOrderStatusMeta[item.status];
                const overdue = isOverdue(item.desired_installation_date, item.status);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => router.push(`/crm/arbetsorder/${item.id}`)}
                    className="block w-full rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 text-left shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_24px_-8px_rgba(20,44,27,0.20)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn(crm.badge, meta.className)}>{meta.label}</span>
                          {overdue ? <span className={cn(crm.badge, 'border-rose-200 bg-rose-50 text-rose-700')}>Försenad</span> : null}
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{item.order_number}</span>
                        </div>
                        <div className="grid gap-0.5">
                          <strong className="truncate text-base font-semibold text-slate-900">{item.project_name}</strong>
                          <span className="text-sm text-slate-500">{item.client_name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                          <span className={overdue ? 'font-semibold text-rose-600' : undefined}>Planerad {formatDate(item.desired_installation_date)}</span>
                          <span>·</span>
                          <span>{formatCurrency(item.pricing_summary?.total ?? item.amount, item.currency_code)}</span>
                          <span>·</span>
                          <span>{(item.line_items || []).length} rader</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <span className="rounded-full border border-[#e0e8dc] bg-[#f1f5ee] px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {item.assignee?.full_name || 'Ej tilldelad'}
                          </span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', syncStatusClass[item.fortnox_order_sync_status])}>
                            Fortnox: {syncStatusLabel[item.fortnox_order_sync_status]}
                          </span>
                        </div>
                      </div>
                      <svg className="mt-1 shrink-0 text-slate-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
