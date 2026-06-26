"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '../../../components/ui/Input';
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

const PAGE_SIZE = 50;
const EMPTY_COUNTS: Record<StageFilter, number> = { alla: 0, prospect: 0, customer: 0, fortnox_customer: 0 };

export default function CustomersClient() {
  const router = useRouter();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<StageFilter>('alla');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stageCounts, setStageCounts] = useState<Record<StageFilter, number>>(EMPTY_COUNTS);
  const [hasMore, setHasMore] = useState(false);

  // Refs let the infinite-scroll loader read the current offset / in-flight state without
  // being recreated on every appended page (which would re-trigger the observer).
  const itemsRef = useRef<CustomerItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Debounce the search box so each keystroke doesn't fire its own request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildQuery = useCallback((offset: number) => {
    const q = new URLSearchParams();
    if (debouncedSearch) q.set('q', debouncedSearch);
    if (filter !== 'alla') q.set('stage', filter);
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', String(offset));
    return q.toString();
  }, [debouncedSearch, filter]);

  // First page — runs on mount and whenever the search term or stage filter changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/crm/customers?${buildQuery(0)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda kunder.');
          setItems([]); setHasMore(false); setStageCounts(EMPTY_COUNTS);
          return;
        }
        const data = json.data ?? {};
        setItems(Array.isArray(data.items) ? data.items : []);
        setHasMore(!!data.hasMore);
        if (data.stageCounts) {
          setStageCounts({
            alla: data.stageCounts.alla ?? 0,
            prospect: data.stageCounts.prospect ?? 0,
            customer: data.stageCounts.customer ?? 0,
            fortnox_customer: data.stageCounts.fortnox_customer ?? 0,
          });
        }
      } catch {
        if (!active) return;
        setError('Kunde inte ladda kunder.');
        setItems([]); setHasMore(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [buildQuery]);

  // Append the next page (used by the infinite-scroll sentinel).
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/crm/customers?${buildQuery(itemsRef.current.length)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setHasMore(false); return; }
      const data = json.data ?? {};
      const next: CustomerItem[] = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => [...prev, ...next]);
      setHasMore(!!data.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [buildQuery]);

  // Observe a sentinel near the end of the list; load the next page as it scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  // Active filter count — shown as a badge on the mobile filter toggle.
  const activeFilterCount = filter !== 'alla' ? 1 : 0;

  return (
    <div className="grid grid-cols-1 gap-4">

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

      {/* ── List card ── */}
      <div className={crm.card}>

        {/* Toolbar */}
        <div className="grid gap-3 border-b border-slate-100 px-4 py-2.5">
          {/* Search + mobile filter toggle */}
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök kund…"
              className="flex-1 sm:w-64 sm:flex-none"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-label="Filter"
              className={cn(
                'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center !rounded-lg !border !p-0 transition sm:hidden',
                filtersOpen || activeFilterCount > 0 ? '!border-emerald-500 !bg-emerald-50 text-emerald-700' : '!border-[#dce4d8] !bg-white text-slate-600',
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {activeFilterCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
              ) : null}
            </button>
          </div>

          {/* Stage filters — collapsible on mobile, inline on desktop */}
          <div className={cn('flex-wrap gap-1.5 sm:flex', filtersOpen ? 'flex' : 'hidden')}>
            {(Object.keys(filterMeta) as StageFilter[]).map((value) => {
              const isActive = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
                    isActive ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={isActive ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {filterMeta[value]}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}>
                    {stageCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* List header */}
        {!loading && !error && items.length > 0 && (
          <div className="flex items-center border-b border-slate-100 px-4 py-1.5">
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
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-36 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
                </div>
              ))}
            </>
          ) : items.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <strong className="block text-sm font-bold text-slate-800">
                {debouncedSearch ? 'Inga träffar' : 'Inga poster i det här filtret'}
              </strong>
              <p className="mt-1 text-sm text-slate-500">
                {debouncedSearch ? 'Prova en annan sökterm.'
                  : filter === 'prospect' ? 'Lägg till ett prospekt med knappen ovan.'
                  : filter === 'fortnox_customer' ? 'Fortnox-kunder visas här när integrationen är aktiv.'
                  : 'Prospekt konverteras till kunder när en offert vinns.'}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(`/crm/kunder/${item.id}`)}
                className={cn(
                  'block w-full px-4 text-left transition hover:bg-slate-50/80 active:bg-slate-100/60',
                  item.status === 'churned' && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3 py-2.5">
                  {/* Initials circle */}
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                    {getInitials(item)}
                  </div>

                  {/* Name + secondary info */}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-slate-900">
                      {getDisplayName(item)}
                    </strong>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-400">
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

        {/* Infinite-scroll sentinel + "loading more" indicator */}
        {!loading && !error && items.length > 0 && (
          <div ref={sentinelRef} className="flex items-center justify-center px-4 py-3 text-[12px] text-slate-400">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
                Laddar fler…
              </span>
            ) : hasMore ? (
              <span>&nbsp;</span>
            ) : (
              <span>Alla {stageCounts[filter]} kunder visade</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
