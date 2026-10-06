"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import AssigneeFilter, { assigneeQueryParam, defaultAssigneeFilter, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import SortFilter from '@/app/crm/components/SortFilter';
import StatusFilter from '@/app/crm/components/StatusFilter';
import { RowAssignee } from '@/app/crm/components/RowAssignee';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { documentRef } from '@/app/crm/lib/format';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import {
  DEFAULT_QUOTE_STATUS_FILTER,
  QUOTE_STATUS_FILTER_OPTIONS,
  isStatusFilterChanged,
  statusFilterParam,
  type QuoteStatusFilterOption,
} from '@/lib/domains/crm/listStatusFilter';
import { crm, quoteStatusMeta } from '@/app/crm/lib/crmTokens';
import { quoteCustomerName, isQuoteOverdue } from '@/app/crm/lib/quoteDisplay';
import QuoteDetailPanel from '@/app/crm/components/QuoteDetailPanel';
import type { CustomerQuoteItem } from '@/app/crm/components/CustomerQuotesDrawer';
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
    // Kontaktfälten läses av detaljpanelens kontaktkort. Servern har alltid skickat dem —
    // listan typade dem bara inte, eftersom raderna inte visar dem.
    contact_name?: string | null;
    phone?: string | null;
    end_contact_name?: string | null;
    end_contact_phone?: string | null;
    end_contact_email?: string | null;
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

type QuoteSort = 'created_desc' | 'follow_up_asc';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const quoteSortMeta: Record<QuoteSort, { label: string }> = {
  created_desc: { label: 'Senast skapad' },
  follow_up_asc: { label: 'Följ upp först' },
};

// The list pages the same way the order board does: one page per status selection, accumulated
// with "Visa fler". Filtering, counting and ordering all happen server-side — the row cap cuts
// before the browser sees anything, so a client-side filter would have been counting a truncated set.
const PAGE_SIZE = 100;

// Statusfiltrets etiketter — samma ord som statuspillret i tabellen.
const quoteStatusLabel = (status: QuoteStatusFilterOption) => quoteStatusMeta[status]?.label ?? status;

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

// Radens adress. Ett vanligt klick öppnar panelen på plats (onOpenRow/onOpen); adressen är vad
// Cmd-klick och mittenknappen öppnar i en ny flik, och djuplänken där öppnar samma panel.
const quoteHref = (quote: QuoteItem) => `/crm/offerter?quote_id=${quote.id}`;

// Kolumnbredderna — kunden tar resten och håller sig kring 170 px eller mer i varje bredd. På
// telefon står kund och status kvar: namnet går före beloppet, som i kortlistan tabellen ersatte.
// Resten kommer in med bredden: numret, ansvarigs bricka och beloppet från 640 px, uppföljningen
// från 768, datumet från 1024 (där sidomenyn tar sin plats), kundtypen och ansvarigs namn från
// 1280. Från 1280 ryms momsbasens längsta etikett, "omvänd skattskyldighet", på en rad; smalare
// bryts den hellre än att rinna ut över kanten.
//
// Beloppet står längst ut och statusen bredvid (William, 2026-10-06). På telefon är beloppet dolt
// och statusen sista synliga kolumn: där ligger den mot högerkanten utan eget indrag (`last:pr-0`
// träffar den dolda beloppscellen, inte statusen), från 640 px vänsterställd i sin kolumn.
const quoteWidth = {
  number: 'hidden w-[7rem] break-words tabular-nums text-slate-500 sm:table-cell',
  customer: '',
  type: 'hidden w-[4.75rem] xl:table-cell',
  assignee: 'hidden w-[2.75rem] sm:table-cell xl:w-[10rem]',
  date: 'hidden w-[7rem] whitespace-nowrap tabular-nums text-slate-500 lg:table-cell',
  followUp: 'hidden w-[8rem] whitespace-nowrap tabular-nums md:table-cell',
  amount: 'hidden w-[7.5rem] text-right tabular-nums sm:table-cell xl:w-[9rem]',
  status: 'w-[6.75rem] pr-0 text-right sm:w-[7.5rem] sm:pr-4 sm:text-left',
} as const;

// ─── QuotesClient ─────────────────────────────────────────────────────────────

export default function QuotesClient({ currentUserId, canWrite, canDelegate, canEditContacts }: { currentUserId: string | null; canWrite: boolean; canDelegate: boolean; canEditContacts: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [total, setTotal] = useState(0);
  // Antal per status, för statusfiltrets meny. null tills första svaret kommit.
  const [counts, setCounts] = useState<Partial<Record<QuoteStatusFilterOption, number>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Startar på allt utom Förlorad (listStatusFilter.ts) och börjar om vid varje besök.
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilterOption[]>(() => [...DEFAULT_QUOTE_STATUS_FILTER]);
  // null = allt ikryssat (ingen parameter), '' = inget ikryssat (inga rader).
  const statusParam = statusFilterParam(statusFilter, QUOTE_STATUS_FILTER_OPTIONS);
  const [sort, setSort] = useState<QuoteSort>('created_desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Startar på den inloggades egna offerter — samma val som orderlistan och säljtavlan.
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>(() => defaultAssigneeFilter(currentUserId));
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  // 'mine' löses upp till ett riktigt id före frågan — filtret är server-side, så webbläsaren får
  // inte vara den som avgör vem "jag" är. Regeln delas med orderlistan.
  const assigneeParam = useMemo(
    () => assigneeQueryParam(assigneeFilter, currentUserId),
    [assigneeFilter, currentUserId],
  );

  const presetProspectId = searchParams.get('prospect_id') || '';
  const presetQuoteId = searchParams.get('quote_id') || '';
  const shouldOpenCreate = searchParams.get('new') === '1';

  // What the status counts are computed over. They don't depend on the status selection (every
  // status is counted) nor on the sort (order can't change a count), so re-requesting five exact
  // COUNTs on a toggle would be five O(n) scans for numbers that cannot move.
  const countScope = `${search.trim()}|${assigneeParam}|${presetProspectId}`;
  const countedScope = useRef<string | null>(null);

  // Bumped when something happens that can move a row between statuses, to force a reload.
  const [reloadKey, setReloadKey] = useState(0);

  // What the visible list is a page of. Held in a ref as well as read from the render closure:
  // a function can only see the values captured when it was created, so comparing two closure
  // reads across an await compares a string with itself. The ref is written by the first-page
  // effect, which runs on every change to the scope — so it, and only it, tells `loadMore`
  // whether the list moved out from under its request. reloadKey ingår: en offert som markeras
  // Vunnen laddar om förstasidan utan att någon annan del av nyckeln rör sig, och en 'Visa fler'
  // i luften skulle då lägga sin sida ovanpå den nya.
  const listScope = `${countScope}|${statusParam}|${sort}|${reloadKey}`;
  const listScopeRef = useRef(listScope);

  function buildListQuery(nextOffset: number, withCounts: boolean) {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (presetProspectId) query.set('prospect_id', presetProspectId);
    if (statusParam !== null) query.set('statuses', statusParam);
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
    const requestedFor = listScope;
    try {
      const res = await fetch(`/api/crm/quotes?${buildListQuery(quotes.length, false)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (listScopeRef.current !== requestedFor) return;
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
  // En offert som inte ligger på den laddade sidan: nådd via ?quote_id= eller vald i lådan
  // "Kundens offerter". Matar BARA panelen — den läggs aldrig in i listan, som ska förbli exakt
  // den sida servern gav.
  //
  // Unionen är avsiktlig: lådans rad bär allt panelen kräver men inte listans egna kolumner
  // (assigned_to, updated_at …). En cast hade lovat fält ingen lovat leverera, och listans rader
  // ritas ändå aldrig ur den här.
  const [linkedQuote, setLinkedQuote] = useState<QuoteItem | CustomerQuoteItem | null>(null);
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

  // Load the first page. Search, status, sort and assignee are all server-side, so every one of them
  // starts a fresh page rather than re-filtering what happens to be in the browser.
  useEffect(() => {
    let active = true;
    listScopeRef.current = listScope;
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
        if (json?.data?.statusCounts) { setCounts(json.data.statusCounts); countedScope.current = countScope; }
      } catch { if (active) { setError('Kunde inte ladda offerter.'); setQuotes([]); setTotal(0); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetProspectId, search, statusParam, sort, assigneeParam, reloadKey]);

  // Deep-link: open a specific quote's detail panel when arriving with ?quote_id= (e.g. from a
  // customer's related list). Handled once the matching quote is loaded so a manual close isn't
  // re-triggered.
  useEffect(() => { setHasHandledQuotePreset(false); }, [presetQuoteId]);

  // The linked quote need not be on the loaded page any more: it may be lost while the status
  // filter hides Förlorad, or simply sit past the first page. Fetch that one row so the link opens the panel it
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
  // Statusen räknas när den avviker från startvalet — startvalet i sig är inget val användaren gjort.
  const activeFilterCount = (isStatusFilterChanged(statusFilter, DEFAULT_QUOTE_STATUS_FILTER) ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);
  const narrowedByStatus = statusParam !== null;
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

  function openQuote(id: string) {
    setDetailQuoteId(id);
    setDetailPanelOpen(true);
  }

  const columns: Array<CrmTableColumn<QuoteItem>> = [
    // Numret via documentRef: Fortnox-numret först, det interna bara som reserv.
    { header: 'Offertnr', className: quoteWidth.number, cell: (item) => documentRef(item.fortnox_offer_number, item.quote_number) },
    {
      header: 'Kund',
      className: quoteWidth.customer,
      cell: (item) => (
        <CustomerCell href={quoteHref(item)} customer={quoteCustomerName(item)} project={item.project_name} onOpen={() => openQuote(item.id)} />
      ),
    },
    { header: 'Typ', className: quoteWidth.type, cell: (item) => (item.quote_type === 'private' ? 'Privat' : 'Företag') },
    {
      header: 'Ansvarig',
      // Smal kolumn med bara brickan (namnet i title) tills det finns plats för namnet vid 1280 px.
      // Rubrikordet ryms inte i den smala kolumnen, så där hörs det bara av skärmläsaren.
      headerContent: <span className="sr-only xl:not-sr-only">Ansvarig</span>,
      className: quoteWidth.assignee,
      // Inget 'Okänd'-fallback: katalogen hämtas i en egen request, så ett tomt uppslag betyder
      // oftast "inte hämtad ännu" och inte "okänd person". RowAssignee skiljer de två tillstånden åt.
      cell: (item) => (
        <RowAssignee name={item.assigned_to ? (assigneeNameById.get(item.assigned_to) ?? null) : null} assigned={Boolean(item.assigned_to)} nameClassName="hidden xl:inline" />
      ),
    },
    { header: 'Datum', className: quoteWidth.date, cell: (item) => formatDate(item.quote_date) },
    {
      header: 'Följ upp',
      className: quoteWidth.followUp,
      cell: (item) => {
        if (!item.follow_up_date) return <span className="text-slate-400">–</span>;
        const overdue = isQuoteOverdue(item);
        return (
          <span className={overdue ? 'font-semibold text-amber-700' : 'text-slate-500'} title={overdue ? 'Uppföljningen är försenad' : undefined}>
            {overdue ? '⚠ ' : ''}{formatDate(item.follow_up_date)}
          </span>
        );
      },
    },
    {
      header: 'Status',
      className: quoteWidth.status,
      cell: (item) => {
        // Guardad uppslagning, som översiktens tabell: en okänd status ska inte släcka listan.
        const status = quoteStatusMeta[item.status];
        return (
          <>
            <span className={cn(crm.badge, status?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{status?.label ?? item.status}</span>
            {item.work_order_id ? (
              <span className="mt-1 block break-words text-[11px] font-semibold text-emerald-700">
                Order {documentRef(workOrderFortnoxById.get(item.work_order_id) ?? null, item.work_order_number)}
              </span>
            ) : null}
            {/* Uppföljningskolumnen är dold under 768 px — där bär statusen signalen i stället. */}
            {isQuoteOverdue(item) ? (
              <span className="mt-1 block text-[11px] font-semibold text-amber-700 md:hidden">Försenad uppföljning</span>
            ) : null}
          </>
        );
      },
    },
    {
      header: 'Belopp',
      className: quoteWidth.amount,
      // Privat → inkl. moms, företag → exkl. moms, med basen utskriven under (pricing.ts).
      cell: (item) => {
        const amount = quoteAmountDisplay(item.quote_type, resolveQuoteVatBreakdown(item));
        return (
          <>
            <span className="block whitespace-nowrap font-semibold text-slate-900">{formatCurrency(amount.primary, item.currency_code)}</span>
            <span className="block text-[11px] leading-tight text-slate-500">{amount.basisSuffix}</span>
          </>
        );
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Offerter</h1>
          {/* Token, inte handrullad kopia — underrubriken låg på slate-500 mot sidbakgrunden
              och mätte 3,98:1. crm.pageSubtitle bär rätt färg för just den ytan. */}
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>
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
        {/* Sök och filter på en rad (William, 2026-10-06): statusflikarna blev ett filter bredvid
            Sortera och Ansvarig, och sökrutan tar platsen. Smalare än ~1000 px står filtren på en
            egen rad, och på mobilen fälls de ihop bakom filterknappen. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 items-center gap-2 sm:min-w-[16rem] sm:flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök på offert, kund eller anteckning"
              className="flex-1"
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

          {/* Status, sortering och ansvarig är alla server-side: listan är paginerad, så att gallra
              eller ordna den laddade sidan skulle bara röra de första hundra. */}
          <div className={cn('flex-col gap-2 sm:flex sm:flex-row sm:items-center', filtersOpen ? 'flex' : 'hidden')}>
            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              options={QUOTE_STATUS_FILTER_OPTIONS}
              defaultValue={DEFAULT_QUOTE_STATUS_FILTER}
              labelOf={quoteStatusLabel}
              counts={counts}
              // Bredare än de andra två: startvalets text, "Utom Avslutad, Avbruten", ska rymmas.
              className="w-full sm:w-[14rem]"
            />
            <SortFilter
              value={sort}
              onChange={setSort}
              options={(Object.keys(quoteSortMeta) as QuoteSort[]).map((value) => ({ value, label: quoteSortMeta[value].label }))}
              label="Sortera offerter"
              className="w-full sm:w-[170px]"
            />
            <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:w-[190px]" />
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-500">Laddar offerter…</div> : null}
        {/* Tomläget gatas på felet också: efter ett misslyckat anrop är listan tom, och "inga
            offerter matchar" under felrutan hade pekat åt fel håll (FRONTEND_SYSTEM.md). */}
        {!loading && !error && quotes.length === 0 ? (
          // 🧨 Filtren måste NÄMNAS här. Ansvarigfiltret är OCH:at med sökrutan och står på "Mina"
          // från start, så en kollegas offertnummer ger noll träffar — och den gamla texten läste
          // sig då som "offerten finns inte". Rader utan ansvarig faller bort av samma skäl
          // (`in(...)` matchar aldrig null). Statusfiltret döljer Förlorad från start, så en förlorad
          // offert som söks fram syns inte heller. På mobilen är filterraden dessutom hopfälld.
          <div className="grid justify-items-center gap-3 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
            <span>
              {narrowedByStatus || assigneeFilter.length > 0
                ? `Inga offerter matchar just nu — listan visar bara ett urval av ${narrowedByStatus && assigneeFilter.length > 0 ? 'statusar och ansvariga' : narrowedByStatus ? 'statusar' : 'ansvariga'}.`
                : 'Inga offerter matchar just nu.'}
            </span>
            {narrowedByStatus || assigneeFilter.length > 0 ? (
              <span className="flex flex-wrap justify-center gap-2">
                {narrowedByStatus ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter([...QUOTE_STATUS_FILTER_OPTIONS])}
                    className="px-3 py-1.5 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
                  >
                    Visa alla statusar
                  </button>
                ) : null}
                {assigneeFilter.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setAssigneeFilter([])}
                    className="px-3 py-1.5 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
                  >
                    Visa alla ansvariga
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}

        {!loading && quotes.length > 0 ? (
          <CrmTable size="regular" label="Offerter" columns={columns} rows={quotes} rowHref={quoteHref} onOpenRow={(item) => openQuote(item.id)} />
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
          /* 🧨 key på offert-id: panelen byter offert på plats via lådan "Kundens offerter", och
             utan omstart följde förra offertens tillstånd med — tydligast dess
             arbetsorderspärrar, som då visades som den NYA offertens hinder. */
          key={detailQuote.id}
          quote={detailQuote}
          workOrderFortnoxNumber={detailQuote.work_order_id ? (workOrderFortnoxById.get(detailQuote.work_order_id) ?? null) : null}
          returnTo={`/crm/offerter?quote_id=${detailQuote.id}`}
          onOpenQuote={(next) => {
            // Raden kommer komplett från lådan, så den kan öppnas direkt. `linkedQuote` är samma
            // spår som djuplänken använder för en offert utanför den laddade sidan — den läggs
            // medvetet INTE in i listan, som ska förbli exakt den sida servern gav.
            setLinkedQuote(next);
            setDetailQuoteId(next.id);
          }}
          documentEmail={documentEmail}
          currentUserId={currentUserId}
          canWrite={canWrite}
          canDelegate={canDelegate}
          canEditContacts={canEditContacts}
          onClose={() => setDetailPanelOpen(false)}
          onQuoteChanged={(patch) => {
            setQuotes((current) => current.map((q) => (q.id === patch.id ? { ...q, ...patch } : q)));
            // Keep the open panel alive across a reload that may drop its row from the page: hold
            // the patched quote outside the list. Without this, marking a draft "Förlorad" while the
            // status filter hides Förlorad would reload the list, lose the row, and unmount the panel
            // mid-click.
            // ⚠️ Funktionellt, inte ur renderingens ögonblicksbild: en långsam Fortnox-push som
            // svarar efter en statusändring hade annars skrivit tillbaka den gamla statusen.
            // QuoteDetailPatch:s egen dokumentation varnar för just det, och lådan gör den
            // länkade offerten till normalfallet i stället för undantaget.
            const patched = quotes.find((q) => q.id === patch.id) ?? linkedQuote;
            setLinkedQuote((current) => {
              const base = quotes.find((q) => q.id === patch.id) ?? current;
              return base && base.id === patch.id ? { ...base, ...patch } : current;
            });
            // A status change can move the row out of the status selection and moves two counters.
            // The filter is server-side, so the browser can't make that happen by re-filtering an
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
