"use client";

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
type WorkOrderTab = 'overview' | 'economy' | 'articles' | 'time' | 'comments';

type WorkOrderItem = {
  id: string;
  quote_id: string;
  prospect_id: string | null;
  order_number: string;
  project_name: string;
  client_name: string;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, any> | null;
  work_address: {
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    delivery_address?: string | null;
    invoice_address?: string | null;
  } | null;
  pricing_summary: {
    subtotal?: number;
    vat?: number;
    total?: number;
  } | null;
  line_items: Array<{
    id: string;
    article_name?: string | null;
    article_number?: string | null;
    pricing_mode?: 'm3' | 'item';
    article_unit_name?: string | null;
    quantity?: string;
    m2?: string;
    thickness_mm?: string;
    unit_price?: string;
    discount_percent?: string;
  }> | null;
  rot_details: Record<string, any> | null;
  internal_handoff: {
    desired_installation_date?: string | null;
    handoff_notes?: string | null;
    work_scope?: string | null;
  } | null;
  currency_code: string;
  amount: number | string;
  vat_percent: number | string;
  desired_installation_date: string | null;
  source_status: string;
  status: WorkOrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string | null;
};

type WorkOrderDraft = {
  status: WorkOrderStatus;
  desired_installation_date: string;
  street_address: string;
  postal_code: string;
  city: string;
  delivery_address: string;
  invoice_address: string;
  work_scope: string;
  handoff_notes: string;
  notes: string;
};

type TimeEntryItem = {
  id: string;
  work_order_id: string;
  user_id: string;
  work_date: string;
  hours: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  user?: { full_name?: string | null } | null;
};

type CommentItem = {
  id: string;
  work_order_id: string;
  created_by: string;
  body: string;
  created_at: string;
  author?: { full_name?: string | null } | null;
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

const initialDraft: WorkOrderDraft = {
  status: 'draft',
  desired_installation_date: '',
  street_address: '',
  postal_code: '',
  city: '',
  delivery_address: '',
  invoice_address: '',
  work_scope: '',
  handoff_notes: '',
  notes: '',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatCurrency(value: number | string | null | undefined, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value || '0'));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

export default function WorkOrdersClient() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkOrderFilter>('all');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkOrderTab>('overview');
  const [draft, setDraft] = useState<WorkOrderDraft>(initialDraft);
  const [timeEntries, setTimeEntries] = useState<TimeEntryItem[]>([]);
  const [timeEntriesLoading, setTimeEntriesLoading] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [loggingTime, setLoggingTime] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [timeDraft, setTimeDraft] = useState({ work_date: new Date().toISOString().slice(0, 10), hours: '', note: '' });
  const [commentDraft, setCommentDraft] = useState('');
  const [suppressHighlightedAutoOpen, setSuppressHighlightedAutoOpen] = useState(false);

  const highlightedWorkOrderId = searchParams.get('work_order_id') || '';

  function closeWorkOrderModal() {
    setSuppressHighlightedAutoOpen(true);
    setModalOpen(false);
    setSelectedWorkOrderId(null);

    if (!highlightedWorkOrderId) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('work_order_id');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (!highlightedWorkOrderId) {
      setSuppressHighlightedAutoOpen(false);
    }
  }, [highlightedWorkOrderId]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        if (highlightedWorkOrderId) query.set('work_order_id', highlightedWorkOrderId);
        const response = await fetch(`/api/crm/work-orders${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!active) return;

        if (!response.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda arbetsorder.');
          setWorkOrders([]);
          return;
        }

        const items = Array.isArray(json?.data?.items) ? json.data.items : [];
        setWorkOrders(items);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda arbetsorder.');
        setWorkOrders([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [highlightedWorkOrderId, search]);

  const visibleWorkOrders = useMemo(() => {
    if (filter === 'all') return workOrders;
    if (filter === 'draft') return workOrders.filter((item) => item.status === 'draft');
    if (filter === 'scheduled') return workOrders.filter((item) => item.status === 'scheduled' || item.status === 'ready');
    if (filter === 'completed') return workOrders.filter((item) => item.status === 'completed');
    return workOrders.filter((item) => item.status === 'in_progress');
  }, [filter, workOrders]);

  useEffect(() => {
    if (highlightedWorkOrderId) {
      if (suppressHighlightedAutoOpen) return;
      const highlighted = visibleWorkOrders.find((item) => item.id === highlightedWorkOrderId);
      if (highlighted) {
        setSelectedWorkOrderId(highlighted.id);
        setModalOpen(true);
        setActiveTab('overview');
      }
      return;
    }

    if (!visibleWorkOrders.length && !modalOpen) {
      setSelectedWorkOrderId(null);
      return;
    }
  }, [highlightedWorkOrderId, modalOpen, suppressHighlightedAutoOpen, visibleWorkOrders]);

  const selectedWorkOrder = useMemo(
    () => workOrders.find((item) => item.id === selectedWorkOrderId) || null,
    [selectedWorkOrderId, workOrders],
  );

  useEffect(() => {
    if (!selectedWorkOrder) {
      setDraft(initialDraft);
      return;
    }

    setDraft({
      status: selectedWorkOrder.status,
      desired_installation_date: selectedWorkOrder.desired_installation_date || '',
      street_address: selectedWorkOrder.work_address?.street_address || '',
      postal_code: selectedWorkOrder.work_address?.postal_code || '',
      city: selectedWorkOrder.work_address?.city || '',
      delivery_address: selectedWorkOrder.work_address?.delivery_address || '',
      invoice_address: selectedWorkOrder.work_address?.invoice_address || '',
      work_scope: selectedWorkOrder.internal_handoff?.work_scope || '',
      handoff_notes: selectedWorkOrder.internal_handoff?.handoff_notes || '',
      notes: selectedWorkOrder.notes || '',
    });
  }, [selectedWorkOrder]);

  useEffect(() => {
    if (!modalOpen || !selectedWorkOrder) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen, selectedWorkOrder]);

  useEffect(() => {
    if (!modalOpen || !selectedWorkOrder) return;

    let cancelled = false;
    const selectedWorkOrderId = selectedWorkOrder.id;

    async function loadTimeEntries() {
      setTimeEntriesLoading(true);
      try {
        const response = await fetch(`/api/crm/work-orders/${selectedWorkOrderId}/time-entries`, { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!cancelled) {
          setTimeEntries(response.ok && json.ok && Array.isArray(json?.data?.items) ? json.data.items : []);
        }
      } finally {
        if (!cancelled) setTimeEntriesLoading(false);
      }
    }

    async function loadComments() {
      setCommentsLoading(true);
      try {
        const response = await fetch(`/api/crm/work-orders/${selectedWorkOrderId}/comments`, { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!cancelled) {
          setComments(response.ok && json.ok && Array.isArray(json?.data?.items) ? json.data.items : []);
        }
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    }

    void Promise.all([loadTimeEntries(), loadComments()]);

    return () => {
      cancelled = true;
    };
  }, [modalOpen, selectedWorkOrder]);

  const totalLoggedHours = useMemo(
    () => timeEntries.reduce((sum, item) => sum + Number(item.hours || 0), 0),
    [timeEntries],
  );

  async function saveWorkOrder() {
    if (!selectedWorkOrder) return;
    setSaving(true);

    try {
      const response = await fetch(`/api/crm/work-orders/${selectedWorkOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          desired_installation_date: draft.desired_installation_date || null,
          notes: draft.notes,
          internal_handoff: {
            desired_installation_date: draft.desired_installation_date || null,
            work_scope: draft.work_scope,
            handoff_notes: draft.handoff_notes,
          },
          work_address: {
            street_address: draft.street_address,
            postal_code: draft.postal_code,
            city: draft.city,
            delivery_address: draft.delivery_address,
            invoice_address: draft.invoice_address,
          },
        }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara arbetsorder');
        return;
      }

      const item = json?.data?.item as WorkOrderItem | undefined;
      if (item) {
        setWorkOrders((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      }

      toast.success('Arbetsorder sparad');
    } catch {
      toast.error('Kunde inte spara arbetsorder');
    } finally {
      setSaving(false);
    }
  }

  async function createTimeEntry() {
    if (!selectedWorkOrder) return;
    if (!timeDraft.work_date || !timeDraft.hours.trim()) {
      toast.error('Datum och timmar krävs');
      return;
    }

    setLoggingTime(true);

    try {
      const response = await fetch(`/api/crm/work-orders/${selectedWorkOrder.id}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: timeDraft.work_date,
          hours: Number(timeDraft.hours.replace(',', '.')),
          note: timeDraft.note,
        }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte logga tid');
        return;
      }

      const item = json?.data?.item as TimeEntryItem | undefined;
      if (item) {
        setTimeEntries((current) => [item, ...current]);
      }
      setTimeDraft({ work_date: new Date().toISOString().slice(0, 10), hours: '', note: '' });
      toast.success('Tid loggad');
    } catch {
      toast.error('Kunde inte logga tid');
    } finally {
      setLoggingTime(false);
    }
  }

  async function createComment() {
    if (!selectedWorkOrder) return;
    if (!commentDraft.trim()) {
      toast.error('Kommentar krävs');
      return;
    }

    setPostingComment(true);

    try {
      const response = await fetch(`/api/crm/work-orders/${selectedWorkOrder.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentDraft }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara kommentar');
        return;
      }

      const item = json?.data?.item as CommentItem | undefined;
      if (item) {
        setComments((current) => [item, ...current]);
      }
      setCommentDraft('');
      toast.success('Kommentar sparad');
    } catch {
      toast.error('Kunde inte spara kommentar');
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Arbetsorder</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Välj en arbetsorder för att öppna arbetsytan med separata flikar för översikt, ekonomi, artiklar, tid och kommentarer.
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'Alla'],
              ['draft', 'Utkast'],
              ['scheduled', 'Planerade'],
              ['active', 'Pågående'],
              ['completed', 'Klara'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  filter === value
                    ? 'text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                )}
                style={filter === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{workOrders.length} i registret</span>
            {highlightedWorkOrderId ? (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                Hoppar till skapad arbetsorder
              </span>
            ) : null}
          </div>
        </div>

        {/* Work order list */}
        <div className="p-4">
          {loading ? <div className="py-4 text-sm text-slate-500">Laddar arbetsorder...</div> : null}
          {!loading && visibleWorkOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Inga arbetsorder matchar just nu.
            </div>
          ) : null}

          {!loading && visibleWorkOrders.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleWorkOrders.map((item) => {
                const meta = workOrderStatusMeta[item.status];
                const isHighlighted = item.id === highlightedWorkOrderId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedWorkOrderId(item.id);
                      setModalOpen(true);
                      setActiveTab('overview');
                    }}
                    className={cn(
                      'block w-full rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 text-left shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_24px_-8px_rgba(20,44,27,0.20)]',
                      isHighlighted ? 'ring-2 ring-emerald-200' : null,
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn(crm.badge, meta.className)}>{meta.label}</span>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{item.order_number}</span>
                        </div>
                        <div className="grid gap-0.5">
                          <strong className="truncate text-base font-semibold text-slate-900">{item.project_name}</strong>
                          <span className="text-sm text-slate-500">{item.client_name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                          <span>Planerad {formatDate(item.desired_installation_date)}</span>
                          <span>·</span>
                          <span>{formatCurrency(item.pricing_summary?.total ?? item.amount, item.currency_code)}</span>
                          <span>·</span>
                          <span>{(item.line_items || []).length} rader</span>
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

      {/* Detail modal */}
      {modalOpen && selectedWorkOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
          <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.25)]">

            {/* Sticky header */}
            <div className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="grid gap-0.5">
                  <h2 className="m-0 text-xl font-bold tracking-tight text-slate-900">
                    {selectedWorkOrder.project_name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-sm text-slate-500">{selectedWorkOrder.client_name} · {selectedWorkOrder.order_number}</p>
                    {selectedWorkOrder.customer_id ? (
                      <a
                        href="/crm/kunder"
                        className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-300"
                      >
                        Kundkort →
                      </a>
                    ) : null}
                  </div>
                </div>
                <button type="button" onClick={closeWorkOrderModal} className={crm.ghostButton}>
                  Stäng
                </button>
              </div>

              {/* Tab strip */}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
                {([
                  ['overview', 'Översikt'],
                  ['economy', 'Ekonomi'],
                  ['articles', 'Artiklar'],
                  ['time', 'Tid'],
                  ['comments', 'Kommentarer'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveTab(value)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                      activeTab === value
                        ? 'text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                    )}
                    style={activeTab === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable tab content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">

              {activeTab === 'overview' ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                  <div className="grid gap-4">
                    <div className={cn(crm.cardInner, 'grid gap-4 md:grid-cols-2')}>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Status</span>
                        <Select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as WorkOrderStatus }))}>
                          {Object.entries(workOrderStatusMeta).map(([value, meta]) => (
                            <option key={value} value={value}>{meta.label}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Önskat installationsdatum</span>
                        <Input value={draft.desired_installation_date} onChange={(event) => setDraft((current) => ({ ...current, desired_installation_date: event.target.value }))} type="date" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                        <span className={crm.sectionTitle}>Arbetsadress</span>
                        <Input value={draft.street_address} onChange={(event) => setDraft((current) => ({ ...current, street_address: event.target.value }))} placeholder="Gatuadress" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Postnummer</span>
                        <Input value={draft.postal_code} onChange={(event) => setDraft((current) => ({ ...current, postal_code: event.target.value }))} placeholder="123 45" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Ort</span>
                        <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                        <span className={crm.sectionTitle}>Leveransadress</span>
                        <Input value={draft.delivery_address} onChange={(event) => setDraft((current) => ({ ...current, delivery_address: event.target.value }))} placeholder="Leveransadress" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                        <span className={crm.sectionTitle}>Fakturaadress</span>
                        <Input value={draft.invoice_address} onChange={(event) => setDraft((current) => ({ ...current, invoice_address: event.target.value }))} placeholder="Fakturaadress" />
                      </label>
                    </div>

                    <div className={cn(crm.cardInner, 'grid gap-4')}>
                      <p className={crm.sectionTitle}>Intern handoff</p>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Arbetets scope</span>
                        <Input value={draft.work_scope} onChange={(event) => setDraft((current) => ({ ...current, work_scope: event.target.value }))} placeholder="Kort operativ scope" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Överlämningsnotering</span>
                        <Textarea value={draft.handoff_notes} onChange={(event) => setDraft((current) => ({ ...current, handoff_notes: event.target.value }))} rows={4} placeholder="Detaljer till teamet" />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-600">
                        <span className={crm.sectionTitle}>Interna anteckningar</span>
                        <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Internt orderunderlag" />
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:content-start">
                    <div className={cn(crm.cardInner, 'grid gap-3')}>
                      <p className={crm.sectionTitle}>Snabböversikt</p>
                      <div className="grid gap-2 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-slate-500">Offertkälla</span>
                          <strong className="text-slate-900">{selectedWorkOrder.source_status}</strong>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-slate-500">Kundtyp</span>
                          <strong className="text-slate-900">{selectedWorkOrder.quote_type === 'private' ? 'Privatkund' : 'Företag'}</strong>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-slate-500">Rader</span>
                          <strong className="text-slate-900">{(selectedWorkOrder.line_items || []).length}</strong>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-slate-500">Loggade timmar</span>
                          <strong className="text-slate-900">{totalLoggedHours.toFixed(1)} h</strong>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-slate-500">Kommentarer</span>
                          <strong className="text-slate-900">{comments.length}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className={cn('mb-2', crm.sectionTitle, 'text-emerald-600')}>Nästa steg</p>
                      <p className="m-0 text-sm text-emerald-900">
                        När underlaget känns klart här blir arbetsordern den samlade källan för fortsatt leverans, tidsrapportering, projektkommentarer och senare fakturering.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'economy' ? (
                <div className="grid gap-4">
                  <div className={cn(crm.cardInner, 'grid gap-3')}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={crm.sectionTitle}>Ekonomi</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>
                          Delsumma {formatCurrency(selectedWorkOrder.pricing_summary?.subtotal ?? 0, selectedWorkOrder.currency_code)}
                        </span>
                        <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>
                          Moms {formatCurrency(selectedWorkOrder.pricing_summary?.vat ?? 0, selectedWorkOrder.currency_code)}
                        </span>
                        <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                          Total {formatCurrency(selectedWorkOrder.pricing_summary?.total ?? selectedWorkOrder.amount, selectedWorkOrder.currency_code)}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p className={crm.sectionTitle}>Valuta</p>
                        <div className="mt-1 text-lg font-bold text-slate-900">{selectedWorkOrder.currency_code}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p className={crm.sectionTitle}>Moms %</p>
                        <div className="mt-1 text-lg font-bold text-slate-900">{selectedWorkOrder.vat_percent}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p className={crm.sectionTitle}>ROT</p>
                        <div className="mt-1 text-lg font-bold text-slate-900">{selectedWorkOrder.rot_details?.enabled ? 'Aktivt' : 'Ej aktivt'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'articles' ? (
                <div className={cn(crm.cardInner, 'grid gap-3')}>
                  <p className={crm.sectionTitle}>Artiklar</p>
                  <div className="grid gap-2">
                    {(selectedWorkOrder.line_items || []).map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
                        <div className="grid gap-0.5">
                          <strong className="text-slate-900">{item.article_name || 'Offert-rad'}</strong>
                          <span className="text-xs text-slate-500">
                            {item.article_number || 'Utan artikelnummer'}{item.thickness_mm ? ` · ${item.thickness_mm} mm` : ''}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.pricing_mode === 'm3' ? `m² ${item.m2 || '0'}` : `Antal ${item.quantity || '0'}`} · A-pris {formatCurrency(item.unit_price || 0, selectedWorkOrder.currency_code)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTab === 'time' ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className={cn(crm.cardInner, 'grid gap-3')}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={crm.sectionTitle}>Tidrapporter</p>
                      <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                        {totalLoggedHours.toFixed(1)} h totalt
                      </span>
                    </div>
                    {timeEntriesLoading ? <div className="text-sm text-slate-500">Laddar tid...</div> : null}
                    {!timeEntriesLoading && timeEntries.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        Ingen tid rapporterad ännu.
                      </div>
                    ) : null}
                    {!timeEntriesLoading ? timeEntries.map((item) => (
                      <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-slate-900">{item.user?.full_name || 'Medarbetare'}</strong>
                          <span className="text-slate-500">{item.hours} h · {formatDate(item.work_date)}</span>
                        </div>
                        {item.note ? <div className="text-slate-600">{item.note}</div> : null}
                        <div className="text-xs text-slate-400">Registrerad {formatDateTime(item.created_at)}</div>
                      </div>
                    )) : null}
                  </div>

                  <div className={cn(crm.cardInner, 'grid gap-3 bg-slate-50/60 lg:content-start')}>
                    <p className={crm.sectionTitle}>Ny tidrad</p>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Datum</span>
                      <Input value={timeDraft.work_date} onChange={(event) => setTimeDraft((current) => ({ ...current, work_date: event.target.value }))} type="date" />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Timmar</span>
                      <Input value={timeDraft.hours} onChange={(event) => setTimeDraft((current) => ({ ...current, hours: event.target.value }))} inputMode="decimal" placeholder="8" />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Kommentar</span>
                      <Textarea value={timeDraft.note} onChange={(event) => setTimeDraft((current) => ({ ...current, note: event.target.value }))} rows={4} placeholder="Vad gjordes?" />
                    </label>
                    <button type="button" onClick={createTimeEntry} disabled={loggingTime} className={crm.saveButton}>
                      {loggingTime ? 'Sparar tid...' : 'Rapportera tid'}
                    </button>
                  </div>
                </div>
              ) : null}

              {activeTab === 'comments' ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className={cn(crm.cardInner, 'grid gap-3')}>
                    <p className={crm.sectionTitle}>Projektkommentarer</p>
                    {commentsLoading ? <div className="text-sm text-slate-500">Laddar kommentarer...</div> : null}
                    {!commentsLoading && comments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        Inga kommentarer ännu.
                      </div>
                    ) : null}
                    {!commentsLoading ? comments.map((item) => (
                      <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-slate-900">{item.author?.full_name || 'Kommentar'}</strong>
                          <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
                        </div>
                        <div className="text-slate-600">{item.body}</div>
                      </div>
                    )) : null}
                  </div>

                  <div className={cn(crm.cardInner, 'grid gap-3 bg-slate-50/60 lg:content-start')}>
                    <p className={crm.sectionTitle}>Ny kommentar</p>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className={crm.sectionTitle}>Kommentar</span>
                      <Textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} rows={8} placeholder="Skriv en kommentar om projektet" />
                    </label>
                    <button type="button" onClick={createComment} disabled={postingComment} className={crm.saveButton}>
                      {postingComment ? 'Sparar kommentar...' : 'Spara kommentar'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Sticky footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <span className="text-sm text-slate-500">Källa: vunnen offert {selectedWorkOrder.quote_id.slice(0, 8)}...</span>
              <button
                type="button"
                onClick={saveWorkOrder}
                disabled={saving}
                className={cn(crm.saveButton, 'h-9 w-auto px-5')}
              >
                {saving ? 'Sparar...' : 'Spara arbetsorder'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
