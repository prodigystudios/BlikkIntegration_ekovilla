"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import AssigneeFilter, { matchesAssignee, MINE, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import DocumentNumberBadge from '@/app/crm/components/DocumentNumberBadge';
import { documentRef } from '@/app/crm/lib/format';
import { resolveQuoteVatBreakdown, quoteAmountDisplay } from '@/lib/domains/crm/pricing';
import { crm, quoteStatusMeta, type QuoteStatus } from '@/app/crm/lib/crmTokens';
import {
  quoteBoardColumn,
  isQuoteCardLocked,
  SALJTAVLA_COLUMNS,
  SALJTAVLA_DROPPABLE_STATUSES,
  type SaljtavlaColumn,
} from '@/lib/domains/crm/quoteBoard';

// ─── Types ───────────────────────────────────────────────────────────────────

type BoardQuote = {
  id: string;
  quote_number: string | null;
  fortnox_offer_number: string | null;
  status: QuoteStatus;
  work_order_id: string | null;
  work_order_number: string | null;
  prospect_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  quote_type: 'private' | 'business';
  customer_name: string | null;
  customer_snapshot: { customer_name?: string | null; company_name?: string | null } | null;
  prospect: { company_name: string } | Array<{ company_name: string }> | null;
  pricing_summary: { subtotal?: number; vat?: number; total?: number } | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  project_name: string;
  follow_up_date: string | null;
  quote_date: string;
  updated_at: string;
};

// Per-column header presentation. Columns map 1:1 to quote status and borrow their
// accent from the shared quoteStatusMeta.
const COLUMN_DEF: Record<SaljtavlaColumn, { label: string; hint: string; accent: string }> = {
  draft: { label: quoteStatusMeta.draft.label, hint: 'Ej skickad', accent: quoteStatusMeta.draft.accent },
  sent: { label: quoteStatusMeta.sent.label, hint: 'Hos kund', accent: quoteStatusMeta.sent.accent },
  follow_up: { label: quoteStatusMeta.follow_up.label, hint: 'Inväntar svar', accent: quoteStatusMeta.follow_up.accent },
  won: { label: quoteStatusMeta.won.label, hint: 'Affär klar', accent: quoteStatusMeta.won.accent },
  lost: { label: quoteStatusMeta.lost.label, hint: 'Stängd utan affär', accent: quoteStatusMeta.lost.accent },
};

const DROPPABLE = new Set<string>(SALJTAVLA_DROPPABLE_STATUSES);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCustomerName(item: BoardQuote) {
  const prospect = Array.isArray(item.prospect) ? item.prospect[0] : item.prospect;
  return prospect?.company_name
    || item.customer_snapshot?.customer_name
    || item.customer_snapshot?.company_name
    || item.customer_name
    || 'Okänd kund';
}

function todayIso() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function isOverdue(item: BoardQuote) {
  if (!item.follow_up_date || item.status === 'won' || item.status === 'lost') return false;
  return item.follow_up_date < todayIso();
}

function formatAmount(value: number, currencyCode: string) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(value);
}

// ─── SaljtavlaClient ───────────────────────────────────────────────────────────

export default function SaljtavlaClient({ currentUserId }: { currentUserId: string | null }) {
  const toast = useToast();
  const router = useRouter();

  const [quotes, setQuotes] = useState<BoardQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  // Default to the logged-in seller's own offers ("mina offerter"); the filter can be
  // widened to other sellers / everyone.
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>([MINE]);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<SaljtavlaColumn | null>(null);
  // Quote rows carry only the internal AO number; the work order's Fortnox order
  // number lives on crm_work_orders. Index it once (work_order_id → fortnox number)
  // so won cards can lead with the Fortnox number the customer recognises.
  const [workOrderFortnoxById, setWorkOrderFortnoxById] = useState<Map<string, string | null>>(new Map());

  // Load quotes (all statuses — the board groups them client-side).
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    fetch(`/api/crm/quotes${query.size > 0 ? `?${query}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (!active) return;
        if (!json.ok) { setError(json?.error || 'Kunde inte ladda offerter.'); setQuotes([]); return; }
        setQuotes(Array.isArray(json?.data?.items) ? json.data.items : []);
      })
      .catch(() => { if (active) { setError('Kunde inte ladda offerter.'); setQuotes([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  // Assignee options (same source as the offer list).
  useEffect(() => {
    let active = true;
    fetch('/api/crm/work-orders/assignees', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setAssignees(json?.ok ? json.data?.items || [] : []); })
      .catch(() => { if (active) setAssignees([]); });
    return () => { active = false; };
  }, []);

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

  // Scope to the chosen "Ansvarig" filter (default = mine).
  const scopedQuotes = useMemo(
    () => quotes.filter((q) => matchesAssignee(q.assigned_to, assigneeFilter, currentUserId)),
    [quotes, assigneeFilter, currentUserId],
  );

  // Group into board columns, with a summed value per column (uses the same
  // headline amount as the cards: incl. moms for private, ex moms for business).
  const columns = useMemo(() => {
    const byColumn = new Map<SaljtavlaColumn, { items: BoardQuote[]; total: number }>();
    for (const col of SALJTAVLA_COLUMNS) byColumn.set(col, { items: [], total: 0 });
    for (const q of scopedQuotes) {
      const bucket = byColumn.get(quoteBoardColumn(q))!;
      bucket.items.push(q);
      bucket.total += quoteAmountDisplay(q.quote_type, resolveQuoteVatBreakdown(q)).primary;
    }
    for (const bucket of byColumn.values()) {
      bucket.items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return byColumn;
  }, [scopedQuotes]);

  async function moveToStatus(quoteId: string, nextStatus: QuoteStatus) {
    const currentItem = quotes.find((q) => q.id === quoteId);
    if (!currentItem || currentItem.status === nextStatus) return;

    // Won converts a prospect into a customer — confirm the meaningful transition.
    if (nextStatus === 'won' && !window.confirm('Markera offerten som vunnen? En kopplad prospekt konverteras då till kund.')) {
      return;
    }

    setMovingId(quoteId);
    const optimistic = { ...currentItem, status: nextStatus, updated_at: new Date().toISOString() };
    setQuotes((current) => current.map((q) => (q.id === quoteId ? optimistic : q)));

    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: currentItem.prospect_id,
          customer_id: currentItem.customer_id,
          quote_type: currentItem.quote_type,
          customer_name: currentItem.customer_name,
          customer_snapshot: currentItem.customer_snapshot,
          pricing_summary: currentItem.pricing_summary,
          project_name: currentItem.project_name,
          amount: currentItem.amount,
          currency_code: currentItem.currency_code,
          vat_percent: currentItem.vat_percent,
          status: nextStatus,
          quote_date: currentItem.quote_date,
          follow_up_date: currentItem.follow_up_date,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setQuotes((current) => current.map((q) => (q.id === quoteId ? currentItem : q)));
        toast.error(json?.error || 'Kunde inte byta status');
        return;
      }
      const updated = json?.data?.item as BoardQuote | undefined;
      if (updated) setQuotes((current) => current.map((q) => (q.id === updated.id ? updated : q)));
    } catch {
      setQuotes((current) => current.map((q) => (q.id === quoteId ? currentItem : q)));
      toast.error('Kunde inte byta status');
    } finally {
      setMovingId(null);
    }
  }

  function handleDrop(column: SaljtavlaColumn) {
    const id = draggedId;
    setDraggedId(null);
    setDragOverColumn(null);
    if (!id) return;
    if (!DROPPABLE.has(column)) {
      toast.info('Skapa arbetsorder från offertens detaljvy.');
      return;
    }
    void moveToStatus(id, column as QuoteStatus);
  }

  const totalVisible = scopedQuotes.length;

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={crm.pageTitle}>Säljtavla</h1>
          <p className={crm.pageSubtitle}>Offertflöde per status · {totalVisible} offerter</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/crm/offerter/ny')}
          className={crm.primaryButton}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Ny offert
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök offert eller kund…"
          className="sm:max-w-xs"
        />
        <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} className="w-full sm:ml-auto sm:w-[200px]" />
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {SALJTAVLA_COLUMNS.map((col) => {
          const def = COLUMN_DEF[col];
          const bucket = columns.get(col) ?? { items: [], total: 0 };
          const items = bucket.items;
          const isDropTarget = dragOverColumn === col && DROPPABLE.has(col);
          return (
            <div
              key={col}
              onDragOver={(e) => {
                if (!DROPPABLE.has(col)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverColumn(col);
              }}
              onDragLeave={() => setDragOverColumn((c) => (c === col ? null : c))}
              onDrop={(e) => { e.preventDefault(); handleDrop(col); }}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-2xl border bg-[#f9fbf7] transition',
                isDropTarget ? 'border-emerald-300 ring-2 ring-emerald-200' : 'border-[#e0e8dc]',
              )}
            >
              <div className="flex items-center justify-between gap-2 border-b border-[#e0e8dc] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', def.accent)} />
                  <span className="truncate text-[13px] font-bold text-slate-900">{def.label}</span>
                  <span className="shrink-0 rounded-full bg-white px-1.5 text-[11px] font-semibold text-slate-500">{items.length}</span>
                </div>
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500">{formatAmount(bucket.total, 'SEK')}</span>
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                {loading ? (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">Laddar…</p>
                ) : items.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] italic text-slate-400">{def.hint}</p>
                ) : (
                  items.map((item) => <BoardCard key={item.id} item={item} fortnoxOrderNumber={item.work_order_id ? (workOrderFortnoxById.get(item.work_order_id) ?? null) : null} moving={movingId === item.id} onOpen={() => router.push(`/crm/offerter?quote_id=${item.id}`)} onDragStart={() => setDraggedId(item.id)} onDragEnd={() => { setDraggedId(null); setDragOverColumn(null); }} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function BoardCard({
  item,
  fortnoxOrderNumber,
  moving,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: BoardQuote;
  fortnoxOrderNumber: string | null;
  moving: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const meta = quoteStatusMeta[item.status];
  const locked = isQuoteCardLocked(item);
  const overdue = isOverdue(item);
  const display = quoteAmountDisplay(item.quote_type, resolveQuoteVatBreakdown(item));

  return (
    <div
      draggable={!locked && !moving}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={cn(
        'group flex items-stretch overflow-hidden rounded-lg border bg-white text-left shadow-sm transition',
        'hover:-translate-y-0.5 hover:shadow-md',
        meta.cardClass,
        locked ? 'cursor-pointer opacity-95' : 'cursor-grab active:cursor-grabbing',
        moving && 'opacity-50',
      )}
    >
      <span className={cn('w-1.5 shrink-0', meta.accent)} />
      <div className="min-w-0 flex-1 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <DocumentNumberBadge label="Offert" value={documentRef(item.fortnox_offer_number, item.quote_number)} />
          <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', item.quote_type === 'private' ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-violet-200 bg-violet-50 text-violet-700')}>
            {item.quote_type === 'private' ? 'Privat' : 'Företag'}
          </span>
        </div>
        <p className="mt-1 truncate text-[13px] font-bold text-slate-900">{getCustomerName(item)}</p>
        {item.project_name && <p className="truncate text-[11px] text-slate-500">{item.project_name}</p>}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold tabular-nums text-slate-800">{formatAmount(display.primary, item.currency_code)}</span>
          {locked && item.work_order_number && (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
              Order {documentRef(fortnoxOrderNumber, item.work_order_number)}
            </span>
          )}
          {overdue && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              Försenad uppföljning
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
