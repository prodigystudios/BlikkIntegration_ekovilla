"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MetricCard from '../components/MetricCard';
import Input from '../../../components/ui/Input';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuoteItem = {
  id: string;
  quote_number: string | null;
  prospect_id: string | null;
  opportunity_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_source: { kind?: string | null } | null;
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
  } | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  prospect: { id: string; company_name: string; contact_name: string | null; city: string | null; status: string } | Array<{ id: string; company_name: string; contact_name: string | null; city: string | null; status: string }> | null;
  opportunity: { id: string; title: string; status: string } | null;
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

const quoteStatusMeta: Record<QuoteItem['status'], { label: string; className: string; cardClass: string; amountClass: string }> = {
  draft: {
    label: 'Utkast',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    cardClass: 'border-slate-200/90 bg-white',
    amountClass: 'border-slate-200 bg-white text-slate-800',
  },
  sent: {
    label: 'Skickad',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
    cardClass: 'border-sky-100 bg-white',
    amountClass: 'border-sky-200 bg-white text-sky-900',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    cardClass: 'border-amber-100 bg-white ring-1 ring-amber-50',
    amountClass: 'border-amber-200 bg-white text-amber-900',
  },
  won: {
    label: 'Vunnen',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    cardClass: 'border-emerald-100 bg-white',
    amountClass: 'border-emerald-200 bg-white text-emerald-900',
  },
  lost: {
    label: 'Förlorad',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    cardClass: 'border-rose-100 bg-white',
    amountClass: 'border-rose-200 bg-white text-rose-900',
  },
};

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

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getQuoteCustomerName(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name
    || item.customer_snapshot?.customer_name
    || item.customer_snapshot?.company_name
    || item.customer_name
    || 'Okänd kund';
}

function isOverdue(item: QuoteItem) {
  if (!item.follow_up_date || item.status === 'won' || item.status === 'lost') return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return item.follow_up_date < todayIso;
}

function compareQuotes(a: QuoteItem, b: QuoteItem) {
  const aOverdue = isOverdue(a);
  const bOverdue = isOverdue(b);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  if (a.follow_up_date && b.follow_up_date && a.follow_up_date !== b.follow_up_date) {
    return a.follow_up_date.localeCompare(b.follow_up_date);
  }
  if (a.quote_date !== b.quote_date) return b.quote_date.localeCompare(a.quote_date);
  return b.updated_at.localeCompare(a.updated_at);
}

// ─── QuotesClient ─────────────────────────────────────────────────────────────

export default function QuotesClient() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const [movingQuoteId, setMovingQuoteId] = useState<string | null>(null);
  const [creatingWorkOrderId, setCreatingWorkOrderId] = useState<string | null>(null);
  const [pushingFortnoxId, setPushingFortnoxId] = useState<string | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [hasHandledPreset, setHasHandledPreset] = useState(false);

  const presetProspectId = searchParams.get('prospect_id') || '';
  const presetOpportunityId = searchParams.get('opportunity_id') || '';
  const shouldOpenCreate = searchParams.get('new') === '1';

  // Redirect preset "new=1" links to the form page
  useEffect(() => {
    if (!shouldOpenCreate || hasHandledPreset || loading) return;
    setHasHandledPreset(true);
    const params = new URLSearchParams();
    if (presetProspectId) params.set('prospect_id', presetProspectId);
    if (presetOpportunityId) params.set('opportunity_id', presetOpportunityId);
    router.push(`/crm/offerter/ny${params.size > 0 ? `?${params}` : ''}`);
  }, [shouldOpenCreate, hasHandledPreset, loading, presetProspectId, presetOpportunityId, router]);

  useEffect(() => {
    setHasHandledPreset(false);
  }, [presetProspectId, presetOpportunityId, shouldOpenCreate]);

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

  const visibleQuotes = useMemo(() => {
    if (filter === 'all') return quotes;
    if (filter === 'active') return quotes.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up');
    if (filter === 'follow_up') return quotes.filter((q) => q.status === 'follow_up');
    if (filter === 'won') return quotes.filter((q) => q.status === 'won');
    return quotes.filter((q) => q.status === 'lost');
  }, [filter, quotes]);

  const sortedVisibleQuotes = useMemo(() => [...visibleQuotes].sort(compareQuotes), [visibleQuotes]);

  const stats = useMemo(() => ({
    total: quotes.length,
    active: quotes.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up').length,
    followUp: quotes.filter((q) => q.status === 'follow_up').length,
    won: quotes.filter((q) => q.status === 'won').length,
  }), [quotes]);

  const filterCounts = useMemo<Record<QuoteFilter, number>>(() => ({
    all: quotes.length,
    active: quotes.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'follow_up').length,
    follow_up: quotes.filter((q) => q.status === 'follow_up').length,
    won: quotes.filter((q) => q.status === 'won').length,
    lost: quotes.filter((q) => q.status === 'lost').length,
  }), [quotes]);

  const detailQuote = useMemo(
    () => (detailQuoteId ? quotes.find((q) => q.id === detailQuoteId) || null : null),
    [detailQuoteId, quotes],
  );

  async function moveQuoteToStatus(quoteId: string, nextStatus: QuoteItem['status']) {
    const currentItem = quotes.find((q) => q.id === quoteId);
    if (!currentItem || currentItem.status === nextStatus) return;

    setMovingQuoteId(quoteId);
    const optimistic = { ...currentItem, status: nextStatus, updated_at: new Date().toISOString() };
    setQuotes((current) => current.map((q) => (q.id === quoteId ? optimistic : q)));

    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: currentItem.prospect_id,
          customer_name: currentItem.customer_name,
          quote_type: currentItem.quote_type,
          customer_source: currentItem.customer_source,
          customer_snapshot: currentItem.customer_snapshot,
          pricing_summary: currentItem.pricing_summary,
          project_name: currentItem.project_name,
          description: currentItem.description,
          amount: currentItem.amount,
          currency_code: currentItem.currency_code,
          vat_percent: currentItem.vat_percent,
          valid_until: currentItem.valid_until,
          status: nextStatus,
          quote_date: currentItem.quote_date,
          follow_up_date: currentItem.follow_up_date,
          notes: currentItem.notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setQuotes((current) => current.map((q) => (q.id === quoteId ? currentItem : q)));
        toast.error(json?.error || 'Kunde inte byta status');
        return;
      }
      const updated = json?.data?.item as QuoteItem | undefined;
      if (updated) setQuotes((current) => current.map((q) => (q.id === updated.id ? updated : q)));
    } catch {
      setQuotes((current) => current.map((q) => (q.id === quoteId ? currentItem : q)));
      toast.error('Kunde inte byta status');
    } finally {
      setMovingQuoteId(null);
    }
  }

  async function createWorkOrder(quoteId: string) {
    const item = quotes.find((q) => q.id === quoteId);
    if (!item || item.status !== 'won') { toast.error('Arbetsorder kan bara skapas från vunnen offert'); return; }
    if (item.work_order_id) { toast.info('Arbetsorder finns redan'); return; }

    setCreatingWorkOrderId(quoteId);
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}/work-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa arbetsorder'); return; }
      const updated = json?.data?.item as QuoteItem | undefined;
      if (updated) setQuotes((current) => current.map((q) => (q.id === updated.id ? updated : q)));
      const workOrder = json?.data?.workOrder as { id?: string; order_number?: string } | undefined;
      toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');
      if (workOrder?.id) router.push(`/crm/arbetsorder?work_order_id=${workOrder.id}`);
    } catch { toast.error('Kunde inte skapa arbetsorder'); } finally { setCreatingWorkOrderId(null); }
  }

  async function pushToFortnox(quoteId: string) {
    setPushingFortnoxId(quoteId);
    try {
      const res = await fetch('/api/fortnox/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skicka till Fortnox');
        return;
      }
      const offerNumber = json?.data?.fortnox_offer_number as string | undefined;
      const wasUpdated = json?.data?.updated as boolean | undefined;
      toast.success(
        offerNumber
          ? `Fortnox-offert #${offerNumber} ${wasUpdated ? 'uppdaterad' : 'skapad'}`
          : 'Skickad till Fortnox',
      );
      // Refresh list to pick up new fortnox_offer_number and sync_status
      setQuotes((current) =>
        current.map((q) =>
          q.id === quoteId
            ? {
                ...q,
                fortnox_offer_number: offerNumber ?? q.fortnox_offer_number,
                fortnox_sync_status: 'synced',
                fortnox_synced_at: new Date().toISOString(),
              }
            : q,
        ),
      );
    } catch {
      toast.error('Kunde inte skicka till Fortnox');
    } finally {
      setPushingFortnoxId(null);
    }
  }

  return (
    <div className="grid gap-6">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Offerter</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Skapa och följ upp offerter
            {presetProspectId ? <span className="ml-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">Filtrerad på prospekt</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/crm/offerter/ny')}
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Skapa offert
        </button>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Alla offerter" value={stats.total} helper="Hela offertregistret oavsett utfall" />
        <MetricCard label="Aktiva offerter" value={stats.active} helper="Utkast, skickade och uppföljning" />
        <MetricCard label="Kräver uppföljning" value={stats.followUp} helper="Behöver nästa offertsteg" />
        <MetricCard label="Vunna offerter" value={stats.won} helper="Offerter som landat i affär" />
      </div>

      {/* Quote list */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på offert, kund eller anteckning"
            className="max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {((['all', 'active', 'follow_up', 'won', 'lost']) as const).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition',
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
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-400">Laddar offerter…</div> : null}
        {!loading && visibleQuotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
            Inga offerter matchar just nu.
          </div>
        ) : null}

        {!loading && visibleQuotes.length > 0 ? (
          <div className="grid gap-2">
            {sortedVisibleQuotes.map((item) => {
              const overdue = isOverdue(item);
              const statusMeta = quoteStatusMeta[item.status];
              const statusDot = item.status === 'won' ? 'bg-emerald-400' : item.status === 'follow_up' ? 'bg-amber-400' : item.status === 'sent' ? 'bg-sky-400' : item.status === 'lost' ? 'bg-rose-300' : 'bg-slate-300';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setDetailQuoteId(item.id); setDetailPanelOpen(true); }}
                  className={cn(
                    'grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[18px] border bg-white px-4 py-3 text-left shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] sm:grid-cols-[auto_1fr_auto_auto_auto]',
                    overdue ? 'border-amber-200' : 'border-slate-200',
                    movingQuoteId === item.id ? 'opacity-60' : null,
                  )}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot)} />

                  <div className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-sm font-bold text-slate-900">{item.project_name}</strong>
                    <span className="truncate text-xs text-slate-500">{getQuoteCustomerName(item)}</span>
                  </div>

                  <span className={cn('hidden rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex', statusMeta.className)}>
                    {statusMeta.label}
                  </span>

                  <span className={cn('hidden rounded-full border px-2.5 py-1 text-sm font-bold sm:inline-flex', statusMeta.amountClass)}>
                    {formatCurrency(item.amount, item.currency_code)}
                  </span>

                  <div className="grid gap-0.5 text-right">
                    <span className="text-xs text-slate-500">{formatDate(item.quote_date)}</span>
                    {item.follow_up_date ? (
                      <span className={cn('text-[11px] font-semibold', overdue ? 'text-amber-700' : 'text-slate-400')}>
                        {overdue ? '⚠ ' : ''}Följ upp {formatDate(item.follow_up_date)}
                      </span>
                    ) : null}
                    {item.work_order_number ? (
                      <span className="text-[11px] font-semibold text-emerald-700">AO {item.work_order_number}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ── Detail panel ── */}
      {detailPanelOpen && detailQuote ? (
        <div
          className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/40 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4"
          onClick={() => setDetailPanelOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Offert ${detailQuote.project_name}`}
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[720px] gap-5 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:max-h-[88vh] sm:overflow-y-auto"
          >
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                {detailQuote.quote_number ? (
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">#{detailQuote.quote_number}</span>
                ) : null}
                <strong className="text-[1.3rem] font-bold tracking-tight text-slate-950">{detailQuote.project_name}</strong>
                <p className="m-0 text-sm text-slate-500">{getQuoteCustomerName(detailQuote)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', quoteStatusMeta[detailQuote.status].className)}>
                  {quoteStatusMeta[detailQuote.status].label}
                </span>
                <button
                  type="button"
                  onClick={() => { setDetailPanelOpen(false); router.push(`/crm/offerter/${detailQuote.id}/redigera`); }}
                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-300 transition-colors"
                >
                  Redigera
                </button>
                <button
                  type="button"
                  onClick={() => setDetailPanelOpen(false)}
                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300 transition-colors"
                >
                  Stäng
                </button>
              </div>
            </div>

            {/* Key info */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Belopp</span>
                <span className="text-sm font-bold text-slate-900">{formatCurrency(detailQuote.amount, detailQuote.currency_code)}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Offertdatum</span>
                <span className="text-sm text-slate-700">{formatDate(detailQuote.quote_date)}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Följ upp</span>
                <span className="text-sm text-slate-700">{formatDate(detailQuote.follow_up_date)}</span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Giltig till</span>
                <span className="text-sm text-slate-700">{formatDate(detailQuote.valid_until)}</span>
              </div>
              {detailQuote.description ? (
                <div className="col-span-2 grid gap-0.5 sm:col-span-4">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Beskrivning</span>
                  <p className="m-0 text-sm leading-5 text-slate-700">{detailQuote.description}</p>
                </div>
              ) : null}
            </div>

            <hr className="border-slate-100" />

            {/* Status changer */}
            <div className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Byt status</span>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(quoteStatusMeta) as Array<[QuoteItem['status'], typeof quoteStatusMeta[QuoteItem['status']]]>).map(([s, meta]) => (
                  <button
                    key={s}
                    type="button"
                    disabled={movingQuoteId === detailQuote.id || detailQuote.status === s}
                    onClick={() => void moveQuoteToStatus(detailQuote.id, s)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                      detailQuote.status === s
                        ? cn(meta.className, 'cursor-default')
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50',
                    )}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            {detailQuote.notes ? (
              <>
                <hr className="border-slate-100" />
                <div className="grid gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Anteckningar</span>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detailQuote.notes}</p>
                </div>
              </>
            ) : null}

            {/* Work order */}
            <hr className="border-slate-100" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Arbetsorder</span>
                <span className="text-sm text-slate-700">
                  {detailQuote.work_order_number
                    ? `Arbetsorder ${detailQuote.work_order_number} är skapad.`
                    : detailQuote.status === 'won'
                      ? 'Klar att bli en intern arbetsorder.'
                      : 'Sätt offerten till vunnen för att skapa arbetsorder.'}
                </span>
              </div>
              <div className="flex gap-2">
                {detailQuote.work_order_id ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/crm/arbetsorder?work_order_id=${detailQuote.work_order_id}`)}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                  >
                    Öppna
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void createWorkOrder(detailQuote.id)}
                  disabled={detailQuote.status !== 'won' || Boolean(detailQuote.work_order_id) || creatingWorkOrderId === detailQuote.id}
                  className="rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                >
                  {creatingWorkOrderId === detailQuote.id ? 'Skapar…' : detailQuote.work_order_number ? 'Skapad' : 'Skapa arbetsorder'}
                </button>
              </div>
            </div>

            {/* Fortnox */}
            <hr className="border-slate-100" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Fortnox</span>
                <span className="text-sm text-slate-700">
                  {detailQuote.fortnox_offer_number
                    ? `Fortnox-offert #${detailQuote.fortnox_offer_number} skapad.`
                    : 'Skicka offerten till Fortnox som en offert.'}
                </span>
                {detailQuote.fortnox_sync_status === 'failed' && (
                  <span className="text-xs font-semibold text-rose-600">Senaste synk misslyckades – försök igen.</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void pushToFortnox(detailQuote.id)}
                disabled={pushingFortnoxId === detailQuote.id || detailQuote.fortnox_sync_status === 'pending'}
                className={cn(
                  'rounded-lg border px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                  detailQuote.fortnox_sync_status === 'synced'
                    ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    : 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800',
                )}
              >
                {pushingFortnoxId === detailQuote.id
                  ? 'Skickar…'
                  : detailQuote.fortnox_offer_number
                    ? 'Skicka igen'
                    : 'Skicka till Fortnox'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
