"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import AssigneeFilter, { matchesAssignee, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import { openFortnoxPdf, postFortnoxEmail, downloadFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import { documentRef } from '@/app/crm/lib/format';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { quoteStatusMeta } from '@/app/crm/lib/crmTokens';

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

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function initialsOf(name: string | null | undefined) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  const [movingQuoteId, setMovingQuoteId] = useState<string | null>(null);
  const [creatingWorkOrderId, setCreatingWorkOrderId] = useState<string | null>(null);
  const [pushingFortnoxId, setPushingFortnoxId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  // Which offer's "Mejla offert" choice menu (eget mejlprogram / Fortnox) is open.
  const [emailMenuOpenId, setEmailMenuOpenId] = useState<string | null>(null);
  const [orderPdfId, setOrderPdfId] = useState<string | null>(null);
  const [orderEmailingId, setOrderEmailingId] = useState<string | null>(null);
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
  const offerLocked = Boolean(detailQuote?.work_order_id) && detailQuote?.fortnox_sync_status !== 'failed';

  // Amount display for the detail hero follows the same convention as the list rows.
  const detailDisplay = detailQuote ? quoteAmountDisplay(detailQuote.quote_type, resolveQuoteVatBreakdown(detailQuote)) : null;

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
      if (json?.data?.fortnox_error) {
        toast.error(`Arbetsorder skapad men Fortnox-synk misslyckades: ${json.data.fortnox_error}`);
      } else {
        toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');
      }
      // Don't auto-navigate — the button flips to "Gå till arbetsorder" so the user
      // can choose to go there when ready.
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

  // Offer PDF + email, and order-confirmation PDF + email (for the work order created
  // from this quote). Shared fetch/popup/email logic lives in lib/fortnoxDoc.
  async function openOfferPdf(quoteId: string) {
    setPdfLoadingId(quoteId);
    await openFortnoxPdf(`/api/fortnox/offers/${quoteId}/pdf`, toast.error);
    setPdfLoadingId(null);
  }

  async function sendOfferEmail(quoteId: string) {
    if (!window.confirm('Mejla offerten till kunden via Fortnox?')) return;
    setEmailingId(quoteId);
    if (await postFortnoxEmail(`/api/fortnox/offers/${quoteId}/email`, toast.error)) {
      toast.success('Offerten mejlad till kunden via Fortnox');
    }
    setEmailingId(null);
  }

  // "Eget mejlprogram": open a pre-filled draft in the user's mail client. mailto can't
  // attach files, so we download the offer PDF to disk first for the user to attach.
  async function emailOfferViaMailClient(quote: QuoteItem) {
    const ref = documentRef(quote.fortnox_offer_number, quote.quote_number);
    const to = quote.customer_snapshot?.email?.trim() || '';
    const subject = `Offert ${ref}${quote.project_name ? ` – ${quote.project_name}` : ''}`;
    const body = [
      'Hej,',
      '',
      `Här kommer offert ${ref}${quote.project_name ? ` gällande ${quote.project_name}` : ''}. Offerten bifogas som PDF.`,
      '',
      'Hör gärna av dig vid frågor.',
      '',
      'Med vänliga hälsningar',
    ].join('\n');

    setEmailingId(quote.id);
    // Best-effort: drop the PDF in Downloads so it can be attached to the draft.
    const pdfOk = await downloadFortnoxPdf(`/api/fortnox/offers/${quote.id}/pdf`, `offert-${ref}.pdf`, toast.error);
    setEmailingId(null);

    // Open the mail client with the draft (recipient/subject/body pre-filled) regardless –
    // the PDF download is a convenience, not a hard dependency.
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    if (pdfOk) toast.success('Offert-PDF nedladdad – bifoga den i mejlet som öppnades.');
  }

  async function openOrderPdf(workOrderId: string) {
    setOrderPdfId(workOrderId);
    await openFortnoxPdf(`/api/crm/work-orders/${workOrderId}/fortnox/pdf`, toast.error);
    setOrderPdfId(null);
  }

  async function sendOrderEmail(workOrderId: string) {
    if (!window.confirm('Mejla orderbekräftelsen till kunden via Fortnox?')) return;
    setOrderEmailingId(workOrderId);
    if (await postFortnoxEmail(`/api/crm/work-orders/${workOrderId}/fortnox/email`, toast.error)) {
      toast.success('Orderbekräftelsen mejlad till kunden via Fortnox');
    }
    setOrderEmailingId(null);
  }

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
              const overdue = isOverdue(item);
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
                    movingQuoteId === item.id ? 'opacity-60' : null,
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
                        <span className="truncate text-[11px] text-slate-500">{getQuoteCustomerName(item)}</span>
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
        <div
          className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/50 [backdrop-filter:blur(4px)] sm:items-center sm:p-4"
          onClick={() => setDetailPanelOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Offert ${detailQuote.project_name}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-none bg-white shadow-[0_-12px_50px_rgba(15,23,42,0.30)] sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:shadow-[0_30px_80px_rgba(15,23,42,0.28)]"
          >
            {/* Sticky header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-4 [padding-top:calc(1rem+env(safe-area-inset-top))] sm:pt-4">
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', quoteStatusMeta[detailQuote.status].className)}>
                    {quoteStatusMeta[detailQuote.status].label}
                  </span>
                  {detailQuote.quote_number ? (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{documentRef(detailQuote.fortnox_offer_number, detailQuote.quote_number)}</span>
                  ) : null}
                </div>
                <strong className="truncate text-lg font-bold tracking-tight text-slate-950">{detailQuote.project_name}</strong>
                <p className="m-0 truncate text-sm text-slate-500">{getQuoteCustomerName(detailQuote)}</p>
              </div>
              <button
                type="button"
                aria-label="Stäng"
                onClick={() => setDetailPanelOpen(false)}
                className="!h-9 !w-9 shrink-0 !rounded-full !border !border-slate-200 !bg-white !p-0 text-slate-500 transition hover:!border-slate-300 hover:text-slate-700"
              >
                <svg className="mx-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="grid flex-1 gap-5 overflow-y-auto px-5 py-5">
              {/* Hero: amount + key dates */}
              <div className="rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{detailDisplay?.primaryLabel ?? 'Belopp'}</div>
                <div className="mt-0.5 text-[1.75rem] font-bold leading-none tracking-tight text-slate-900 tabular-nums">
                  {formatCurrency(detailDisplay?.primary ?? detailQuote.amount, detailQuote.currency_code)}
                </div>
                {detailDisplay ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                    <span>Ex moms <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(detailDisplay.subtotal, detailQuote.currency_code)}</span></span>
                    <span>Moms ({detailDisplay.vatPercent} %) <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(detailDisplay.vat, detailQuote.currency_code)}</span></span>
                    <span>Inkl. moms <span className="font-medium text-slate-600 tabular-nums">{formatCurrency(detailDisplay.total, detailQuote.currency_code)}</span></span>
                  </div>
                ) : null}
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#dce6d6] pt-3">
                  {([
                    ['Offertdatum', formatDate(detailQuote.quote_date), false],
                    ['Följ upp', formatDate(detailQuote.follow_up_date), isOverdue(detailQuote)],
                    ['Giltig till', formatDate(detailQuote.valid_until), false],
                  ] as Array<[string, string, boolean]>).map(([lbl, val, warn]) => (
                    <div key={lbl} className="grid gap-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{lbl}</span>
                      <span className={cn('text-sm font-medium', warn ? 'text-amber-700' : 'text-slate-700')}>{warn ? '⚠ ' : ''}{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              {detailQuote.description ? (
                <div className="grid gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Beskrivning</span>
                  <p className="m-0 text-sm leading-6 text-slate-700">{detailQuote.description}</p>
                </div>
              ) : null}

              {/* Status changer */}
              <div className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Byt status</span>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(quoteStatusMeta) as Array<[QuoteItem['status'], typeof quoteStatusMeta[QuoteItem['status']]]>).map(([s, meta]) => {
                    const isCurrent = detailQuote.status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={movingQuoteId === detailQuote.id || isCurrent}
                        onClick={() => void moveQuoteToStatus(detailQuote.id, s)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                          isCurrent
                            ? cn(meta.className, 'cursor-default')
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50',
                        )}
                      >
                        {isCurrent ? <span className={cn('h-1.5 w-1.5 rounded-full', meta.accent)} /> : null}
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              {detailQuote.notes ? (
                <div className="grid gap-1.5 rounded-xl border border-amber-100 bg-amber-50/60 p-3.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700/80">Anteckningar</span>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detailQuote.notes}</p>
                </div>
              ) : null}

              {/* Action cards */}
              <div className="grid gap-3">
                {/* Work order */}
                <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.5h6V4M9 11h6M9 15h4" />
                        </svg>
                      </span>
                      <div className="grid min-w-0 gap-0.5">
                        <span className="text-sm font-semibold text-slate-800">Arbetsorder</span>
                        <span className="text-xs leading-5 text-slate-500">
                          {detailQuote.work_order_id
                            ? `${documentRef(workOrderFortnoxById.get(detailQuote.work_order_id) ?? null, detailQuote.work_order_number)} är skapad.`
                            : detailQuote.status === 'won'
                              ? 'Klar att bli en intern arbetsorder.'
                              : 'Sätt offerten till vunnen för att skapa.'}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {detailQuote.work_order_id ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/crm/arbetsorder/${detailQuote.work_order_id}`)}
                          className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                        >
                          Gå till arbetsorder
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void createWorkOrder(detailQuote.id)}
                          disabled={detailQuote.status !== 'won' || creatingWorkOrderId === detailQuote.id}
                          className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                        >
                          {creatingWorkOrderId === detailQuote.id ? 'Skapar…' : 'Skapa arbetsorder'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Order confirmation — once a work order (Fortnox order) exists */}
                  {detailQuote.work_order_id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e3e9df] pt-3">
                      <span className="mr-auto text-xs font-medium text-slate-500">Orderbekräftelse</span>
                      <button
                        type="button"
                        onClick={() => void openOrderPdf(detailQuote.work_order_id!)}
                        disabled={orderPdfId === detailQuote.work_order_id}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {orderPdfId === detailQuote.work_order_id ? 'Hämtar…' : 'Hämta PDF'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendOrderEmail(detailQuote.work_order_id!)}
                        disabled={orderEmailingId === detailQuote.work_order_id}
                        className="rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {orderEmailingId === detailQuote.work_order_id ? 'Mejlar…' : 'Mejla order'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Fortnox */}
                <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 16V4M8 8l4-4 4 4M5 20h14" />
                        </svg>
                      </span>
                      <div className="grid min-w-0 gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-800">Fortnox</span>
                          {offerLocked ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
                              </svg>
                              Låst
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs leading-5 text-slate-500">
                          {detailQuote.fortnox_offer_number
                            ? `Offert #${detailQuote.fortnox_offer_number} skapad.`
                            : 'Skicka offerten till Fortnox.'}
                        </span>
                        {detailQuote.fortnox_sync_status === 'failed' ? (
                          <span className="text-xs font-semibold text-rose-600">Senaste synk misslyckades.</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {detailQuote.fortnox_offer_number ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void openOfferPdf(detailQuote.id)}
                            disabled={pdfLoadingId === detailQuote.id}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pdfLoadingId === detailQuote.id ? 'Hämtar…' : 'Hämta PDF'}
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setEmailMenuOpenId((o) => (o === detailQuote.id ? null : detailQuote.id))}
                              disabled={emailingId === detailQuote.id}
                              aria-haspopup="menu"
                              aria-expanded={emailMenuOpenId === detailQuote.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {emailingId === detailQuote.id ? 'Mejlar…' : 'Mejla offert'}
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className={cn('transition-transform', emailMenuOpenId === detailQuote.id && 'rotate-180')}>
                                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {emailMenuOpenId === detailQuote.id ? (
                              <>
                                {/* Click-away backdrop */}
                                <div className="fixed inset-0 z-40" onClick={() => setEmailMenuOpenId(null)} aria-hidden />
                                <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.16)]">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setEmailMenuOpenId(null); void emailOfferViaMailClient(detailQuote); }}
                                    className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
                                  >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                      Eget mejlprogram
                                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Standard</span>
                                    </span>
                                    <span className="text-xs text-slate-500">Öppnar ditt mejlprogram – PDF:en laddas ner att bifoga.</span>
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setEmailMenuOpenId(null); void sendOfferEmail(detailQuote.id); }}
                                    className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
                                  >
                                    <span className="text-sm font-semibold text-slate-800">Via Fortnox</span>
                                    <span className="text-xs text-slate-500">Fortnox mejlar offerten med PDF direkt till kunden.</span>
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                      {/* Sync/re-sync hidden once a work order locks the offer in Fortnox
                          (but still shown if the sync failed, so the user can recover) */}
                      {!offerLocked ? (
                        <button
                          type="button"
                          onClick={() => void pushToFortnox(detailQuote.id)}
                          disabled={pushingFortnoxId === detailQuote.id || detailQuote.fortnox_sync_status === 'pending'}
                          className={cn(
                            'rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                            detailQuote.fortnox_offer_number
                              ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700',
                          )}
                        >
                          {pushingFortnoxId === detailQuote.id ? 'Skickar…' : detailQuote.fortnox_offer_number ? 'Skicka igen' : 'Skicka'}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Locked explanation — offer can no longer be edited/re-synced */}
                  {offerLocked ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs leading-5 text-amber-900">
                      <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
                      </svg>
                      <span>
                        Offerten är <strong>låst</strong>{detailQuote.work_order_number ? ` – arbetsorder ${detailQuote.work_order_number} är skapad` : ' – en arbetsorder har skapats'}, så den kan inte längre ändras eller synkas om i Fortnox. Du kan fortfarande hämta PDF:en och mejla den till kunden.
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Sticky footer — a locked offer (work order created) can't be edited or
                re-synced, so the edit action is hidden and "Stäng" fills the row. */}
            <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] sm:[padding-bottom:0.75rem]">
              <button
                type="button"
                onClick={() => setDetailPanelOpen(false)}
                className={cn(
                  'flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300',
                  !offerLocked && 'sm:flex-none sm:px-5',
                )}
              >
                Stäng
              </button>
              {!offerLocked ? (
                <button
                  type="button"
                  onClick={() => { setDetailPanelOpen(false); router.push(`/crm/offerter/${detailQuote.id}/redigera`); }}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 sm:ml-auto sm:flex-none sm:px-5"
                  style={{ backgroundColor: 'var(--crm-primary)' }}
                >
                  Redigera offert
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
