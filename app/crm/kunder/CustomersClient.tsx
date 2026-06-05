"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
import { cn } from '@/lib/shared/cn';
import { crm, customerStageLabel, customerStageClass, syncStatusLabel, syncStatusClass } from '@/app/crm/lib/crmTokens';

type CustomerType = 'business' | 'private';
type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';
type CustomerStatus = 'active' | 'inactive' | 'churned';

type CustomerItem = {
  id: string;
  customer_type: CustomerType;
  customer_stage: CustomerStage;
  company_name: string | null;
  organization_number: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  visit_address: { street: string | null; postal_code: string | null; city: string | null } | null;
  fortnox_customer_id: string | null;
  sync_status: 'not_synced' | 'pending' | 'synced' | 'failed';
  status: CustomerStatus;
  updated_at: string;
  contacts: { id: string }[];
};

type StageFilter = 'alla' | CustomerStage;

const filterMeta: Record<StageFilter, string> = {
  alla: 'Alla', prospect: 'Prospekt', customer: 'Kunder', fortnox_customer: 'Fortnox-kunder',
};

function getDisplayName(item: CustomerItem): string {
  if (item.customer_type === 'business') return item.company_name || 'Okänt företag';
  const parts = [item.first_name, item.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}

function getInitials(item: CustomerItem): string {
  if (item.customer_type === 'business' && item.company_name) {
    const words = item.company_name.trim().split(/\s+/);
    return words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : words[0].slice(0, 2).toUpperCase();
  }
  const f = item.first_name?.[0] ?? '';
  const l = item.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || '?';
}

export default function CustomersClient() {
  const router = useRouter();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StageFilter>('alla');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/customers${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda kunder.'); setItems([]); return; }
        setItems(Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda kunder.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [search]);

  const visibleItems = useMemo(() => {
    const filtered = filter === 'alla' ? items : items.filter((i) => i.customer_stage === filter);
    return filtered.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [filter, items]);

  const filterCounts = useMemo<Record<StageFilter, number>>(() => ({
    alla: items.length,
    prospect: items.filter((i) => i.customer_stage === 'prospect').length,
    customer: items.filter((i) => i.customer_stage === 'customer').length,
    fortnox_customer: items.filter((i) => i.customer_stage === 'fortnox_customer').length,
  }), [items]);

  const stats = useMemo(() => ({
    total: items.length,
    prospects: items.filter((i) => i.customer_stage === 'prospect').length,
    customers: items.filter((i) => i.customer_stage === 'customer').length,
    fortnox: items.filter((i) => i.customer_stage === 'fortnox_customer').length,
  }), [items]);

  return (
    <div className="grid grid-cols-1 gap-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>Kundregister</h1>
          <p className={cn('m-0 mt-0.5', crm.pageSubtitle)}>Prospekt, kunder och Fortnox-kopplade konton</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/crm/kunder/ny')}
          className={crm.primaryButton}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          <span aria-hidden>+</span> Ny kund
        </button>
      </div>

      {/* ── Metrics ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Totalt" value={stats.total} helper="Alla i registret" />
        <MetricCard label="Prospekt" value={stats.prospects} helper="Potentiella kunder" />
        <MetricCard label="Kunder" value={stats.customers} helper="Aktiva kundrelationer" />
        <MetricCard label="Fortnox-kunder" value={stats.fortnox} helper="Fortnox-koppling aktiv" />
      </div>

      {/* ── List card ── */}
      <div className={crm.card}>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök kund…"
            className="w-full sm:w-64"
          />
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            {(Object.keys(filterMeta) as StageFilter[]).map((value) => {
              const isActive = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition',
                    isActive ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={isActive ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {filterMeta[value]}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}>
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* List header */}
        {!loading && !error && visibleItems.length > 0 && (
          <div className="flex items-center border-b border-slate-100 px-5 py-2">
            <div className="mr-4 w-9 shrink-0" />
            <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Kund</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:block">Status</span>
            <div className="ml-4 w-4 shrink-0" />
          </div>
        )}

        {/* Rows */}
        <div className="divide-y divide-slate-100">
          {error ? (
            <div className="px-5 py-4">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            </div>
          ) : loading ? (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-36 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </>
          ) : visibleItems.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <strong className="block text-sm font-bold text-slate-800">Inga poster i det här filtret</strong>
              <p className="mt-1 text-sm text-slate-500">
                {filter === 'prospect' ? 'Lägg till ett prospekt med knappen ovan.'
                  : filter === 'fortnox_customer' ? 'Fortnox-kunder visas här när integrationen är aktiv.'
                  : 'Prospekt konverteras till kunder när en offert vinns.'}
              </p>
            </div>
          ) : (
            visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(`/crm/kunder/${item.id}`)}
                className={cn(
                  'block w-full px-5 text-left transition hover:bg-slate-50/80 active:bg-slate-100/60',
                  item.status === 'churned' && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-4 py-3.5">
                  {/* Initials circle */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                    {getInitials(item)}
                  </div>

                  {/* Name + secondary info */}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-semibold text-slate-900">
                      {getDisplayName(item)}
                    </strong>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-400">
                      {item.organization_number && (
                        <span>{item.organization_number}</span>
                      )}
                      {item.email && (
                        <span className="max-w-[220px] truncate">{item.email}</span>
                      )}
                      {item.visit_address?.city && (
                        <span>{item.visit_address.city}</span>
                      )}
                      {!item.organization_number && !item.email && !item.visit_address?.city && item.contacts.length > 0 && (
                        <span>{item.contacts.length} kontakt{item.contacts.length !== 1 ? 'er' : ''}</span>
                      )}
                    </div>
                  </div>

                  {/* Stage + sync badges */}
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn(
                      crm.badge,
                      customerStageClass[item.customer_stage],
                    )}>
                      {customerStageLabel[item.customer_stage]}
                    </span>
                    {item.customer_stage === 'fortnox_customer' && (
                      <span className={cn(
                        'hidden whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:inline',
                        syncStatusClass[item.sync_status],
                      )}>
                        {syncStatusLabel[item.sync_status]}
                      </span>
                    )}
                  </div>

                  {/* Chevron */}
                  <svg className="shrink-0 text-slate-300" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
