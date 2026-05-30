"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SectionCard from '../../../components/ui/SectionCard';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type ProspectItem = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
};

type QuoteProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: ProspectItem['status'];
};

type QuoteItem = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  quote_type: 'private' | 'business';
  customer_snapshot: {
    customer_name?: string | null;
    company_name?: string | null;
    personal_number?: string | null;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    visit_address?: string | null;
    delivery_address?: string | null;
    invoice_address?: string | null;
  } | null;
  pricing_summary: {
    subtotal?: number;
    vat?: number;
    total?: number;
  } | null;
  line_items: QuoteLineItem[] | null;
  rot_details: {
    enabled?: boolean;
    applicant_name?: string | null;
    personal_number?: string | null;
    property_designation?: string | null;
    rot_percent?: number;
  } | null;
  internal_handoff: {
    desired_installation_date?: string | null;
    handoff_notes?: string | null;
    work_scope?: string | null;
  } | null;
  project_name: string;
  description: string | null;
  amount: number | string;
  currency_code: string;
  vat_percent: number | string | null;
  valid_until: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  converted_to_work_order_at: string | null;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type QuoteLineItem = {
  id: string;
  construction: 'vagg' | 'snedtak' | 'vind' | '';
  m2: string;
  thickness_mm: string;
  auto_price: boolean;
  unit_price: string;
  pricing_mode: 'm3' | 'item';
  quantity: string;
  article_id: string | null;
  article_name: string | null;
  article_number: string | null;
  article_price: number | null;
  article_unit_name: string | null;
  discount_percent: string;
};

type ArticleLite = {
  id?: string;
  name?: string;
  articleNumber?: string;
  price?: number | null;
  unit?: string | { name?: string | null; objectiveName?: string | null } | null;
};

type QuoteDraft = {
  prospect_id: string;
  quote_type: 'private' | 'business';
  customer_name: string;
  company_name: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  delivery_address: string;
  invoice_address: string;
  items: QuoteLineItem[];
  project_name: string;
  description: string;
  amount: string;
  vat_percent: string;
  valid_until: string;
  rot_enabled: boolean;
  rot_applicant_name: string;
  rot_personal_number: string;
  rot_property_designation: string;
  rot_percent: string;
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
  status: QuoteItem['status'];
  quote_date: string;
  follow_up_date: string;
  notes: string;
  create_follow_up_task: boolean;
};

type QuoteFilter = 'all' | 'active' | 'follow_up' | 'won' | 'lost';

const quoteStatusMeta: Record<QuoteItem['status'], { label: string; className: string; cardClass: string; amountClass: string }> = {
  draft: {
    label: 'Utkast',
    className: 'border-slate-300 bg-slate-100 text-slate-700',
    cardClass: 'border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#fcfdfd_100%)]',
    amountClass: 'border-slate-200 bg-white text-slate-800',
  },
  sent: {
    label: 'Skickad',
    className: 'border-sky-300 bg-sky-100 text-sky-800',
    cardClass: 'border-sky-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)]',
    amountClass: 'border-sky-200 bg-white text-sky-900',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-300 bg-amber-100 text-amber-900',
    cardClass: 'border-amber-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf2_100%)] ring-1 ring-amber-100/70',
    amountClass: 'border-amber-200 bg-white text-amber-900',
  },
  won: {
    label: 'Vunnen',
    className: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    cardClass: 'border-emerald-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4fbf6_100%)]',
    amountClass: 'border-emerald-200 bg-white text-emerald-900',
  },
  lost: {
    label: 'Förlorad',
    className: 'border-rose-300 bg-rose-100 text-rose-800',
    cardClass: 'border-rose-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fff7f7_100%)]',
    amountClass: 'border-rose-200 bg-white text-rose-900',
  },
};

const initialDraft: QuoteDraft = {
  prospect_id: '',
  quote_type: 'business',
  customer_name: '',
  company_name: '',
  personal_number: '',
  contact_name: '',
  email: '',
  phone: '',
  street_address: '',
  postal_code: '',
  city: '',
  visit_address: '',
  delivery_address: '',
  invoice_address: '',
  items: [createEmptyLineItem()],
  project_name: '',
  description: '',
  amount: '',
  vat_percent: '25',
  valid_until: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  rot_enabled: false,
  rot_applicant_name: '',
  rot_personal_number: '',
  rot_property_designation: '',
  rot_percent: '30',
  desired_installation_date: '',
  handoff_notes: '',
  work_scope: '',
  status: 'draft',
  quote_date: new Date().toISOString().slice(0, 10),
  follow_up_date: '',
  notes: '',
  create_follow_up_task: true,
};

const quoteFilterMeta: Record<QuoteFilter, { label: string; hint: string; tone: string }> = {
  all: { label: 'Alla', hint: 'Hela offertregistret', tone: 'border-slate-300 bg-white text-slate-700' },
  active: { label: 'Aktiva', hint: 'Utkast, skickade och uppföljning', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  follow_up: { label: 'Följ upp', hint: 'Behöver nästa offertsteg', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  won: { label: 'Vunna', hint: 'Offerter som landat rätt', tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  lost: { label: 'Förlorade', hint: 'Offerter som inte gick vidare', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
};

const quotesSectionClass = 'grid gap-3 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5';

function createEmptyLineItem(): QuoteLineItem {
  return {
    id: crypto.randomUUID(),
    construction: '',
    m2: '',
    thickness_mm: '',
    auto_price: true,
    unit_price: '',
    pricing_mode: 'm3',
    quantity: '',
    article_id: null,
    article_name: null,
    article_number: null,
    article_price: null,
    article_unit_name: null,
    discount_percent: '',
  };
}

function inferConstructionFromArticle(name?: string | null) {
  const value = (name || '').toLowerCase();
  if (/sned\s*tak|snedtak|taklut|lutande/.test(value)) return 'snedtak' as const;
  if (/\bvind\b|vinds?bjälklag|vinden/.test(value)) return 'vind' as const;
  if (/vägg|vagg|regel|stomme|väggreg/.test(value)) return 'vagg' as const;
  return '' as const;
}

function computeUnitPrice(_construction: QuoteLineItem['construction'], _thicknessMm: number) {
  return 900;
}

function getArticleUnitName(unit: ArticleLite['unit']) {
  if (!unit) return '';
  if (typeof unit === 'string') return unit;
  return String(unit.name || unit.objectiveName || '');
}

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getQuoteCustomerName(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name || item.customer_snapshot?.customer_name || item.customer_snapshot?.company_name || item.customer_name || 'Okänd kund';
}

function formatPercent(value: string | number | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(String(value || ''));
  return Number.isFinite(numeric) ? `${numeric}%` : '–';
}

function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

function getNumericAmount(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function isOverdue(item: QuoteItem) {
  if (!item.follow_up_date || item.status === 'won' || item.status === 'lost') return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return item.follow_up_date < todayIso;
}

function compareQuotesForBoard(a: QuoteItem, b: QuoteItem) {
  const aOverdue = isOverdue(a);
  const bOverdue = isOverdue(b);

  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

  if (a.follow_up_date && b.follow_up_date && a.follow_up_date !== b.follow_up_date) {
    return a.follow_up_date.localeCompare(b.follow_up_date);
  }

  if (a.quote_date !== b.quote_date) {
    return b.quote_date.localeCompare(a.quote_date);
  }

  return b.updated_at.localeCompare(a.updated_at);
}

export default function QuotesClient() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteDraft>(initialDraft);
  const [draggedQuoteId, setDraggedQuoteId] = useState<string | null>(null);
  const [dragTargetStatus, setDragTargetStatus] = useState<QuoteItem['status'] | null>(null);
  const [movingQuoteId, setMovingQuoteId] = useState<string | null>(null);
  const [creatingWorkOrderId, setCreatingWorkOrderId] = useState<string | null>(null);
  const [hasAppliedPreset, setHasAppliedPreset] = useState(false);

  const presetProspectId = searchParams.get('prospect_id') || '';
  const shouldOpenCreateForPreset = searchParams.get('new') === '1';

  const prospectsById = useMemo(() => new Map(prospects.map((item) => [item.id, item])), [prospects]);
  const effectiveRows = useMemo(() => {
    return draft.items.map((item) => {
      const baseUnit = item.auto_price
        ? computeUnitPrice(item.construction, parseFloat(item.thickness_mm || '0') || 0)
        : (parseFloat(item.unit_price || '0') || 0);
      const mode = item.pricing_mode === 'item' ? 'item' : 'm3';
      const m2 = parseFloat(item.m2 || '0') || 0;
      const thicknessM = (parseFloat(item.thickness_mm || '0') || 0) / 1000;
      const volume = Math.max(0, m2 * thicknessM);
      const quantity = parseFloat(item.quantity || '0') || 0;
      const amount = mode === 'm3' ? volume : quantity;
      const rawDiscount = parseFloat(item.discount_percent || '0');
      const discount = Number.isFinite(rawDiscount) ? Math.min(100, Math.max(0, rawDiscount)) : 0;
      const effectiveUnit = Math.max(0, baseUnit * (1 - discount / 100));
      const constructionLabel = item.construction === 'vagg' ? 'Vägg' : item.construction === 'snedtak' ? 'Snedtak' : item.construction === 'vind' ? 'Vind' : '';
      const baseLabel = item.article_name ? `${item.article_name}${item.article_number ? ` (${item.article_number})` : ''}` : `${constructionLabel || 'Okänd'}${item.thickness_mm ? ` ${item.thickness_mm} mm` : ''}`;
      const unitSuffix = mode === 'm3' ? ' (m³)' : item.article_unit_name ? ` (${item.article_unit_name})` : '';

      return {
        ...item,
        amount,
        unit: baseUnit,
        effectiveUnit,
        label: `${baseLabel}${unitSuffix}`,
        mode,
        rowTotal: amount * effectiveUnit,
        isConfigured: Boolean(item.article_name || item.m2 || item.quantity || item.unit_price),
      };
    });
  }, [draft.items]);

  const totals = useMemo(() => {
    const subtotal = Math.max(0, effectiveRows.reduce((sum, item) => sum + item.rowTotal, 0));
    const vatPercent = parseFloat(draft.vat_percent || '0') || 0;
    const vat = Math.max(0, subtotal * (vatPercent / 100));
    return {
      subtotal,
      vat,
      total: subtotal + vat,
    };
  }, [draft.vat_percent, effectiveRows]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        if (presetProspectId) query.set('prospect_id', presetProspectId);

        const [prospectsRes, quotesRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch(`/api/crm/quotes${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' }),
        ]);

        const [prospectsJson, quotesJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          quotesRes.json().catch(() => ({})),
        ]);

        if (!active) return;

        if (!prospectsRes.ok || !prospectsJson.ok) {
          setError(prospectsJson?.error || 'Kunde inte ladda prospekt för offerter.');
          setProspects([]);
          setQuotes([]);
          return;
        }

        if (!quotesRes.ok || !quotesJson.ok) {
          setError(quotesJson?.error || 'Kunde inte ladda offerter.');
          setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
          setQuotes([]);
          return;
        }

        setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
        setQuotes(Array.isArray(quotesJson?.data?.items) ? quotesJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda offertytan.');
        setProspects([]);
        setQuotes([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [presetProspectId, search]);

  useEffect(() => {
	setHasAppliedPreset(false);
  }, [presetProspectId, shouldOpenCreateForPreset]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const visibleQuotes = useMemo(() => {
    if (filter === 'all') return quotes;
    if (filter === 'active') return quotes.filter((item) => item.status === 'draft' || item.status === 'sent' || item.status === 'follow_up');
    if (filter === 'follow_up') return quotes.filter((item) => item.status === 'follow_up');
    if (filter === 'won') return quotes.filter((item) => item.status === 'won');
    return quotes.filter((item) => item.status === 'lost');
  }, [filter, quotes]);

  const sortedVisibleQuotes = useMemo(() => [...visibleQuotes].sort(compareQuotesForBoard), [visibleQuotes]);

  const stats = useMemo(() => ({
    total: quotes.length,
    active: quotes.filter((item) => item.status === 'draft' || item.status === 'sent' || item.status === 'follow_up').length,
    followUp: quotes.filter((item) => item.status === 'follow_up').length,
    won: quotes.filter((item) => item.status === 'won').length,
    overdue: quotes.filter((item) => isOverdue(item)).length,
  }), [quotes]);

  const filterCounts = useMemo<Record<QuoteFilter, number>>(() => ({
    all: quotes.length,
    active: quotes.filter((item) => item.status === 'draft' || item.status === 'sent' || item.status === 'follow_up').length,
    follow_up: quotes.filter((item) => item.status === 'follow_up').length,
    won: quotes.filter((item) => item.status === 'won').length,
    lost: quotes.filter((item) => item.status === 'lost').length,
  }), [quotes]);

  useEffect(() => {
  if (!shouldOpenCreateForPreset || hasAppliedPreset || loading) return;
  const presetProspect = presetProspectId ? prospectsById.get(presetProspectId) || null : null;
  setEditingQuoteId(null);
  setDraft({
    ...initialDraft,
    prospect_id: presetProspectId,
    customer_name: presetProspect?.company_name || '',
    company_name: presetProspect?.company_name || '',
    contact_name: presetProspect?.contact_name || '',
    city: presetProspect?.city || '',
  });
  setModalOpen(true);
  setHasAppliedPreset(true);
  }, [hasAppliedPreset, loading, presetProspectId, prospectsById, shouldOpenCreateForPreset]);

  function renderQuoteCard(item: QuoteItem, options?: { compact?: boolean; hideStatusBadge?: boolean }) {
    const prospect = getProspectFromQuote(item);
    const overdue = isOverdue(item);
    const statusMeta = quoteStatusMeta[item.status];
    const compact = options?.compact ?? false;
    const hideStatusBadge = options?.hideStatusBadge ?? false;

    if (compact) {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => openEditModal(item)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
            setDraggedQuoteId(item.id);
          }}
          onDragEnd={() => {
            setDraggedQuoteId(null);
            setDragTargetStatus(null);
          }}
          className={cn(
            'relative grid min-h-[140px] grid-rows-[minmax(0,1fr)_auto_auto] items-start justify-start gap-2 overflow-hidden rounded-[18px] border p-3 text-left shadow-[0_10px_22px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_28px_rgba(15,23,42,0.08)] cursor-grab active:cursor-grabbing',
            statusMeta.cardClass,
            draggedQuoteId === item.id || movingQuoteId === item.id ? 'opacity-60' : null,
            overdue && item.status !== 'follow_up' ? 'ring-1 ring-amber-100' : null,
          )}
        >
          <span className={cn('absolute inset-y-0 left-0 w-1 rounded-l-[18px]', item.status === 'won' ? 'bg-emerald-400' : item.status === 'follow_up' ? 'bg-amber-400' : item.status === 'sent' ? 'bg-sky-400' : item.status === 'lost' ? 'bg-rose-300' : 'bg-slate-300')} />

          <div className="grid min-h-[52px] w-full content-start gap-0.5 pl-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {prospect ? 'Kopplat prospekt' : 'Fristående offert'}
            </span>
            <strong className="truncate text-[15px] font-bold tracking-[-0.03em] text-slate-950">{item.project_name}</strong>
            <p className="m-0 truncate text-sm text-slate-600">{getQuoteCustomerName(item)}</p>
          </div>

          <div className="flex min-h-[20px] w-full flex-wrap items-center gap-x-2 gap-y-1 pl-2 text-xs text-slate-600">
            <span>{formatDate(item.quote_date)}</span>
            {item.follow_up_date ? <span>Följ upp {formatDate(item.follow_up_date)}</span> : null}
            {prospect?.city ? <span>{prospect.city}</span> : null}
          </div>

          <div className="mt-auto flex w-full flex-wrap items-center justify-start gap-2 pl-2">
            <span className={cn('rounded-full border px-2.5 py-1 text-sm font-bold shadow-[0_8px_16px_rgba(15,23,42,0.04)]', statusMeta.amountClass)}>
              {formatCurrency(item.amount, item.currency_code)}
            </span>
            {item.work_order_number ? <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-900">Arbetsorder {item.work_order_number}</span> : null}
            {overdue ? <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-900">Sen uppföljning</span> : null}
          </div>
        </button>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => openEditModal(item)}
        className={cn(
          'relative grid gap-3 overflow-hidden rounded-[22px] border p-3.5 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.10)] md:grid-cols-[minmax(0,1.16fr)_minmax(0,0.92fr)_auto] md:items-center',
          statusMeta.cardClass,
          overdue && item.status !== 'follow_up' ? 'ring-1 ring-amber-100' : null,
        )}
      >
        <span className={cn('absolute inset-y-0 left-0 w-1.5 rounded-l-[24px]', item.status === 'won' ? 'bg-emerald-400' : item.status === 'follow_up' ? 'bg-amber-400' : item.status === 'sent' ? 'bg-sky-400' : item.status === 'lost' ? 'bg-rose-300' : 'bg-slate-300')} />

        <div className="grid gap-1.5 pl-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {prospect ? 'Kopplat prospekt' : 'Fristående offert'}
          </span>
          <div className="grid gap-0.5">
            <strong className="text-[17px] font-bold tracking-[-0.03em] text-slate-950">{item.project_name}</strong>
            <p className="m-0 text-sm font-medium text-slate-600">{getQuoteCustomerName(item)}</p>
          </div>
        </div>

        <div className="grid gap-2 pl-2 md:pl-0">
          {(item.description || item.notes) ? (
            <p className="m-0 line-clamp-2 text-sm leading-5 text-slate-600">{item.description || item.notes}</p>
          ) : (
            <p className="m-0 text-sm text-slate-500">Ingen beskrivning ännu. Klicka för att lägga till offertdetaljer och nästa steg.</p>
          )}

          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 font-medium text-slate-700">Offertdatum {formatDate(item.quote_date)}</span>
            {item.follow_up_date ? <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 font-medium text-slate-700">Följ upp {formatDate(item.follow_up_date)}</span> : null}
            {prospect?.city ? <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1">{prospect.city}</span> : null}
            {item.work_order_number ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-900">Arbetsorder {item.work_order_number}</span> : null}
          </div>
        </div>

        <div className="grid content-start justify-items-start gap-2 pl-2 md:justify-items-end md:pl-0">
          {!hideStatusBadge ? (
            <span className={cn('rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] shadow-[0_10px_18px_rgba(15,23,42,0.06)]', statusMeta.className)}>
              {statusMeta.label}
            </span>
          ) : null}
          <span className={cn('rounded-full border px-3 py-1.5 text-sm font-bold shadow-[0_10px_18px_rgba(15,23,42,0.05)]', statusMeta.amountClass)}>
            {formatCurrency(item.amount, item.currency_code)}
          </span>
          {overdue ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-900">
              Sen uppföljning
            </span>
          ) : null}
        </div>
      </button>
    );
  }

  function openCreateModal() {
    const presetProspect = presetProspectId ? prospectsById.get(presetProspectId) || null : null;
    setEditingQuoteId(null);
    setDraft({
	  ...initialDraft,
	  prospect_id: presetProspectId,
	  customer_name: presetProspect?.company_name || '',
    company_name: presetProspect?.company_name || '',
    contact_name: presetProspect?.contact_name || '',
    city: presetProspect?.city || '',
	});
    setModalOpen(true);
  }

  function openEditModal(item: QuoteItem) {
    setEditingQuoteId(item.id);
    setDraft({
      prospect_id: item.prospect_id || '',
      quote_type: item.quote_type || 'business',
      customer_name: item.customer_name || '',
      company_name: item.customer_snapshot?.company_name || '',
      personal_number: item.customer_snapshot?.personal_number || '',
      contact_name: item.customer_snapshot?.contact_name || '',
      email: item.customer_snapshot?.email || '',
      phone: item.customer_snapshot?.phone || '',
      street_address: item.customer_snapshot?.street_address || '',
      postal_code: item.customer_snapshot?.postal_code || '',
      city: item.customer_snapshot?.city || '',
      visit_address: item.customer_snapshot?.visit_address || '',
      delivery_address: item.customer_snapshot?.delivery_address || '',
      invoice_address: item.customer_snapshot?.invoice_address || '',
      items: item.line_items?.length ? item.line_items : [createEmptyLineItem()],
      project_name: item.project_name,
      description: item.description || '',
      amount: String(item.amount ?? ''),
      vat_percent: String(item.vat_percent ?? 25),
      valid_until: item.valid_until || '',
      rot_enabled: Boolean(item.rot_details?.enabled),
      rot_applicant_name: item.rot_details?.applicant_name || '',
      rot_personal_number: item.rot_details?.personal_number || '',
      rot_property_designation: item.rot_details?.property_designation || '',
      rot_percent: String(item.rot_details?.rot_percent ?? 30),
      desired_installation_date: item.internal_handoff?.desired_installation_date || '',
      handoff_notes: item.internal_handoff?.handoff_notes || '',
      work_scope: item.internal_handoff?.work_scope || '',
      status: item.status,
      quote_date: item.quote_date,
      follow_up_date: item.follow_up_date || '',
      notes: item.notes || '',
      create_follow_up_task: false,
    });
    setModalOpen(true);
  }

  async function createFollowUpTask(quote: QuoteItem) {
    if (!draft.follow_up_date || !draft.create_follow_up_task) return true;

    const taskTitle = `Följ upp offert: ${quote.project_name}`;
    const taskRes = await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prospect_id: quote.prospect_id,
        title: taskTitle,
        details: quote.notes || quote.description || `Uppföljning för offert ${quote.project_name}`,
        priority: 'high',
        due_date: draft.follow_up_date,
        source: 'crm_quote',
        status: 'open',
      }),
    });

    const taskJson = await taskRes.json().catch(() => ({}));
    return taskRes.ok && taskJson.ok;
  }

  async function createWorkOrderFromQuote(quoteId: string) {
    const currentItem = quotes.find((item) => item.id === quoteId);
    if (!currentItem) return;

    if (currentItem.status !== 'won') {
      toast.error('Arbetsorder kan bara skapas från vunnen offert');
      return;
    }

    if (currentItem.work_order_id || currentItem.work_order_number) {
      toast.info(`Arbetsorder finns redan${currentItem.work_order_number ? `: ${currentItem.work_order_number}` : ''}`);
      return;
    }

    setCreatingWorkOrderId(quoteId);
    try {
      const response = await fetch(`/api/crm/quotes/${quoteId}/work-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skapa arbetsorder');
        return;
      }

      const updatedQuote = json?.data?.item as QuoteItem | undefined;
      const workOrder = json?.data?.workOrder as { id?: string; order_number?: string } | undefined;

      if (updatedQuote) {
        setQuotes((current) => current.map((item) => (item.id === updatedQuote.id ? updatedQuote : item)));
      }

      toast.success(workOrder?.order_number ? `Arbetsorder skapad: ${workOrder.order_number}` : 'Arbetsorder skapad');

      if (workOrder?.id) {
        router.push(`/crm/arbetsorder?work_order_id=${workOrder.id}`);
      }
    } catch {
      toast.error('Kunde inte skapa arbetsorder');
    } finally {
      setCreatingWorkOrderId(null);
    }
  }

  async function saveQuote() {
    if (!draft.project_name.trim()) {
      toast.error('Offertnamn krävs');
      return;
    }

    if (!draft.prospect_id && !draft.customer_name.trim()) {
      toast.error('Välj prospekt eller ange kundnamn');
      return;
    }

    if (!draft.amount.trim() || Number(draft.amount.replace(',', '.')) < 0) {
      const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);
      if (!hasAnyLineItemInput) {
        toast.error('Ange ett giltigt belopp eller lägg till offert­rader');
        return;
      }
    }

    if (draft.quote_type === 'private' && !draft.personal_number.trim()) {
      toast.error('Personnummer krävs för privatkund');
      return;
    }

    if (draft.quote_type === 'business' && !draft.company_name.trim() && !draft.customer_name.trim()) {
      toast.error('Företagsnamn krävs för företagskund');
      return;
    }

    if (draft.quote_type === 'business' && draft.rot_enabled) {
      toast.error('ROT kan bara användas för privatkund');
      return;
    }

    const hasAnyLineItemInput = draft.items.some((item) => item.article_name || item.m2 || item.quantity || item.unit_price);
    if (hasAnyLineItemInput) {
      const hasInvalidConfiguredRow = effectiveRows.some((item) => item.isConfigured && (!(item.amount > 0) || !(item.effectiveUnit >= 0)));
      if (hasInvalidConfiguredRow) {
        toast.error('Fyll i kvantitet/volym och pris för varje offert-rad');
        return;
      }
    }

    setSubmitting(true);
    try {
      const isEditing = Boolean(editingQuoteId);
      const amountNumber = hasAnyLineItemInput ? totals.total : Number(draft.amount.replace(',', '.'));
      const vatPercentNumber = Number(draft.vat_percent.replace(',', '.'));
      const vatAmount = hasAnyLineItemInput
        ? totals.vat
        : (Number.isFinite(vatPercentNumber) ? amountNumber * (vatPercentNumber / 100) : 0);
      const payload = {
        prospect_id: draft.prospect_id || null,
        customer_name: draft.customer_name,
        quote_type: draft.quote_type,
        customer_snapshot: {
          customer_name: draft.customer_name || null,
          company_name: draft.company_name || null,
          personal_number: draft.personal_number || null,
          contact_name: draft.contact_name || null,
          email: draft.email || null,
          phone: draft.phone || null,
          street_address: draft.street_address || null,
          postal_code: draft.postal_code || null,
          city: draft.city || null,
          visit_address: draft.visit_address || null,
          delivery_address: draft.delivery_address || null,
          invoice_address: draft.invoice_address || null,
        },
        pricing_summary: {
          subtotal: hasAnyLineItemInput ? totals.subtotal : amountNumber,
          vat: vatAmount,
          total: hasAnyLineItemInput ? totals.total : amountNumber + vatAmount,
        },
        line_items: draft.items,
        rot_details: {
          enabled: draft.rot_enabled,
          applicant_name: draft.rot_applicant_name || null,
          personal_number: draft.rot_personal_number || null,
          property_designation: draft.rot_property_designation || null,
          rot_percent: Number(draft.rot_percent || '30'),
        },
        internal_handoff: {
          desired_installation_date: draft.desired_installation_date || null,
          handoff_notes: draft.handoff_notes || null,
          work_scope: draft.work_scope || null,
        },
        project_name: draft.project_name,
        description: draft.description,
        amount: draft.amount,
        vat_percent: draft.vat_percent,
        valid_until: draft.valid_until || null,
        status: draft.status,
        quote_date: draft.quote_date,
        follow_up_date: draft.follow_up_date || null,
        notes: draft.notes,
      };

      const res = await fetch(isEditing ? `/api/crm/quotes/${editingQuoteId}` : '/api/crm/quotes', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara offert');
        return;
      }

      const item = json?.data?.item as QuoteItem | undefined;
      if (item) {
        setQuotes((current) => {
          if (isEditing) return current.map((entry) => (entry.id === item.id ? item : entry));
          return [item, ...current];
        });

        if (!isEditing && draft.follow_up_date && draft.create_follow_up_task) {
          const taskCreated = await createFollowUpTask(item);
          if (!taskCreated) {
            toast.info('Offerten sparades, men uppföljningsuppgiften kunde inte skapas automatiskt.');
          }
        }
      }

      setModalOpen(false);
      setEditingQuoteId(null);
      setDraft(initialDraft);
      toast.success(isEditing ? 'Offert uppdaterad' : 'Offert skapad');
    } catch {
      toast.error('Fel vid sparande av offert');
    } finally {
      setSubmitting(false);
    }
  }

  async function moveQuoteToStatus(quoteId: string, nextStatus: QuoteItem['status']) {
    const currentItem = quotes.find((item) => item.id === quoteId);
    if (!currentItem || currentItem.status === nextStatus) return;

    setMovingQuoteId(quoteId);
    const optimisticItem = { ...currentItem, status: nextStatus, updated_at: new Date().toISOString() };
    setQuotes((current) => current.map((item) => (item.id === quoteId ? optimisticItem : item)));

    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: currentItem.prospect_id,
          customer_name: currentItem.customer_name,
          quote_type: currentItem.quote_type,
          customer_snapshot: currentItem.customer_snapshot,
          pricing_summary: currentItem.pricing_summary,
          line_items: currentItem.line_items,
          rot_details: currentItem.rot_details,
          internal_handoff: currentItem.internal_handoff,
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
        setQuotes((current) => current.map((item) => (item.id === quoteId ? currentItem : item)));
        toast.error(json?.error || 'Kunde inte flytta offert mellan statusar');
        return;
      }

      const updatedItem = json?.data?.item as QuoteItem | undefined;
      if (updatedItem) {
        setQuotes((current) => current.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
      }
    } catch {
      setQuotes((current) => current.map((item) => (item.id === quoteId ? currentItem : item)));
      toast.error('Kunde inte flytta offert mellan statusar');
    } finally {
      setMovingQuoteId(null);
      setDraggedQuoteId(null);
      setDragTargetStatus(null);
    }
  }

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.16),_transparent_24%),linear-gradient(135deg,#f6fbf4_0%,#e5f4e8_56%,#f5fbf6_100%)] p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-5 xl:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Offerter
              </div>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(1.75rem,3vw,2.8rem)] font-bold tracking-[-0.05em] text-slate-950">Offerter</h1>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
                      {stats.total} i registret
                  </div>
                  {presetProspectId ? (
					<div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
					  Filtrerad på valt prospekt
					</div>
				) : null}
                </div>
                  <p className="m-0 text-sm text-slate-600">Offertytan är ett register över alla offerter. Själva affärsresan bärs av prospektet, medan du här skummar offertläge, belopp och uppföljning.</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button type="button" onClick={openCreateModal} className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900">
                Ny offert
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Alla offerter</div>
                <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.total}</div>
                <div className="mt-1 text-[13px] text-slate-500">Hela offertregistret oavsett utfall</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Aktiva</div>
                <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.active}</div>
                <div className="mt-1 text-[13px] text-slate-500">Utkast, skickade och uppföljning</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Följ upp</div>
                <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.followUp}</div>
                <div className="mt-1 text-[13px] text-slate-500">Behöver nästa offertsteg</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Vunna</div>
                <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.won}</div>
                <div className="mt-1 text-[13px] text-slate-500">Offerter som landat i affär</div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard className={`${quotesSectionClass}`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på offert, prospekt, kund eller anteckning"
            className="max-w-xl"
          />
          <div className="grid gap-2 rounded-[20px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,252,250,0.96))] p-2 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between gap-3 px-2 pt-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Sales cockpit</div>
              <div className="text-xs text-slate-500">{filterCounts[filter]} i vy</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {((['all', 'active', 'follow_up', 'won', 'lost']) as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'grid min-w-[120px] gap-0.5 rounded-[20px] border px-3 py-2 text-left transition',
                    filter === value
                      ? 'border-emerald-900 bg-emerald-900 text-white shadow-[0_14px_24px_rgba(15,23,42,0.16)]'
                      : cn(quoteFilterMeta[value].tone, 'hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(15,23,42,0.08)]'),
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{quoteFilterMeta[value].label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', filter === value ? 'bg-white/16 text-white' : 'bg-white/80 text-current')}>
                      {filterCounts[value]}
                    </span>
                  </div>
                  <span className={cn('text-[11px]', filter === value ? 'text-white/80' : 'text-current/70')}>
                    {quoteFilterMeta[value].hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-500">Laddar offerter…</div> : null}
        {!loading && visibleQuotes.length === 0 ? <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">Inga offerter matchar just nu.</div> : null}

        {!loading && visibleQuotes.length > 0 ? (
          <div className="grid gap-3 2xl:grid-cols-2">
            {sortedVisibleQuotes.map((item) => renderQuoteCard(item))}
          </div>
        ) : null}
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_30px_100px_rgba(15,23,42,0.25)] md:p-6">
            <div className="grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">CRM / Offerter</span>
                  <h2 className="m-0 text-2xl font-bold tracking-[-0.04em] text-slate-950">{editingQuoteId ? 'Redigera offert' : 'Ny offert'}</h2>
                  <p className="m-0 text-sm leading-6 text-slate-500">Registrera eller uppdatera en offert kopplad till ett prospekt. Själva pipelineförflyttningen sker i prospektflödet.</p>
                </div>
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                  Stäng
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Prospekt</span>
                  <select
                    value={draft.prospect_id}
                    onChange={(event) => {
                      const prospectId = event.target.value;
                      const prospect = prospectId ? prospectsById.get(prospectId) || null : null;
                      setDraft((current) => ({
                        ...current,
                        prospect_id: prospectId,
                        customer_name: prospect ? prospect.company_name : current.customer_name,
                      }));
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300"
                  >
                    <option value="">Ingen prospektkoppling</option>
                    {prospects.map((prospect) => (
                      <option key={prospect.id} value={prospect.id}>{prospect.company_name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kundtyp</span>
                  <select value={draft.quote_type} onChange={(event) => setDraft((current) => ({ ...current, quote_type: event.target.value as 'private' | 'business', rot_enabled: event.target.value === 'business' ? false : current.rot_enabled }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300">
                    <option value="business">Företag</option>
                    <option value="private">Privatkund</option>
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kundnamn</span>
                  <Input value={draft.customer_name} onChange={(event) => setDraft((current) => ({ ...current, customer_name: event.target.value }))} placeholder="Företag eller kund" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Företagsnamn</span>
                  <Input value={draft.company_name} onChange={(event) => setDraft((current) => ({ ...current, company_name: event.target.value, customer_name: current.quote_type === 'business' && !current.customer_name ? event.target.value : current.customer_name }))} placeholder="Bolag AB" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Personnummer</span>
                  <Input value={draft.personal_number} onChange={(event) => setDraft((current) => ({ ...current, personal_number: event.target.value }))} placeholder="ÅÅÅÅMMDD-XXXX" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kontaktperson</span>
                  <Input value={draft.contact_name} onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Namn på kontakt" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">E-post</span>
                  <Input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="namn@example.com" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Telefon</span>
                  <Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="070..." />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Gatuadress</span>
                  <Input value={draft.street_address} onChange={(event) => setDraft((current) => ({ ...current, street_address: event.target.value }))} placeholder="Gata 1" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Postnummer</span>
                  <Input value={draft.postal_code} onChange={(event) => setDraft((current) => ({ ...current, postal_code: event.target.value }))} placeholder="123 45" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Ort</span>
                  <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Besöksadress</span>
                  <Input value={draft.visit_address} onChange={(event) => setDraft((current) => ({ ...current, visit_address: event.target.value }))} placeholder="Besöksadress om annan än kundadress" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Leveransadress</span>
                  <Input value={draft.delivery_address} onChange={(event) => setDraft((current) => ({ ...current, delivery_address: event.target.value }))} placeholder="Leveransadress" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fakturaadress</span>
                  <Input value={draft.invoice_address} onChange={(event) => setDraft((current) => ({ ...current, invoice_address: event.target.value }))} placeholder="Fakturaadress" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Offertnamn / projekt</span>
                  <Input value={draft.project_name} onChange={(event) => setDraft((current) => ({ ...current, project_name: event.target.value }))} placeholder="Ex. Takisolering villa Norrköping" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Belopp</span>
                  <Input value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} inputMode="decimal" placeholder="0" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Moms %</span>
                  <Input value={draft.vat_percent} onChange={(event) => setDraft((current) => ({ ...current, vat_percent: event.target.value }))} inputMode="decimal" placeholder="25" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
                  <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as QuoteItem['status'] }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300">
                    {Object.entries(quoteStatusMeta).map(([value, meta]) => (
                      <option key={value} value={value}>{meta.label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Offertdatum</span>
                  <Input value={draft.quote_date} onChange={(event) => setDraft((current) => ({ ...current, quote_date: event.target.value }))} type="date" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Följ upp senast</span>
                  <Input value={draft.follow_up_date} onChange={(event) => setDraft((current) => ({ ...current, follow_up_date: event.target.value }))} type="date" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Giltig till</span>
                  <Input value={draft.valid_until} onChange={(event) => setDraft((current) => ({ ...current, valid_until: event.target.value }))} type="date" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Beskrivning</span>
                  <Textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Kort om omfattning eller vad som offereras" />
                </label>

                <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-white p-4 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Offert­rader</div>
                      <div className="text-sm font-semibold text-slate-900">Artiklar och mängder som bygger beloppet</div>
                    </div>
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, createEmptyLineItem()] }))} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100">
                      + Lägg till rad
                    </button>
                  </div>

                  <div className="grid gap-3">
                    {draft.items.map((row) => {
                      const rowMetrics = effectiveRows.find((item) => item.id === row.id);
                      const isM3 = (row.pricing_mode ?? 'm3') === 'm3';

                      return (
                        <div key={row.id} className="grid gap-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
                          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] xl:items-end">
                            <label className="grid gap-1 text-sm text-slate-600">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Artikel</span>
                              <ArticlePicker
                                value={row.article_name || ''}
                                onSelect={(article) => {
                                  const construction = inferConstructionFromArticle(article.name);
                                  const unitName = getArticleUnitName(article.unit);
                                  const normalizedUnit = unitName.trim().toLowerCase();
                                  const pricingMode: 'm3' | 'item' = normalizedUnit === 'm3' || normalizedUnit === 'm³' || /m\s*³/i.test(normalizedUnit) ? 'm3' : 'item';
                                  setDraft((current) => ({
                                    ...current,
                                    items: current.items.map((item) => item.id === row.id ? {
                                      ...item,
                                      article_id: article.id || null,
                                      article_name: article.name || null,
                                      article_number: article.articleNumber || null,
                                      article_price: typeof article.price === 'number' ? article.price : null,
                                      article_unit_name: unitName || null,
                                      construction: construction || item.construction,
                                      pricing_mode: pricingMode,
                                      auto_price: false,
                                      unit_price: article.price != null ? String(article.price) : item.unit_price,
                                      quantity: pricingMode === 'item' && (!item.quantity || Number(item.quantity) <= 0) ? '1' : item.quantity,
                                    } : item),
                                  }));
                                }}
                                onClear={() => setDraft((current) => ({
                                  ...current,
                                  items: current.items.map((item) => item.id === row.id ? {
                                    ...item,
                                    article_id: null,
                                    article_name: null,
                                    article_number: null,
                                    article_price: null,
                                    article_unit_name: null,
                                  } : item),
                                }))}
                              />
                            </label>

                            {isM3 ? (
                              <label className="grid gap-1 text-sm text-slate-600">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">m²</span>
                                <Input value={row.m2} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, m2: event.target.value } : item) }))} inputMode="decimal" placeholder="0" />
                              </label>
                            ) : (
                              <label className="grid gap-1 text-sm text-slate-600">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Antal</span>
                                <Input value={row.quantity} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item) }))} inputMode="decimal" placeholder="1" />
                              </label>
                            )}

                            {isM3 ? (
                              <label className="grid gap-1 text-sm text-slate-600">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Tjocklek mm</span>
                                <Input value={row.thickness_mm} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, thickness_mm: event.target.value } : item) }))} inputMode="decimal" placeholder="200" />
                              </label>
                            ) : (
                              <div className="hidden xl:block" />
                            )}

                            <div className="grid gap-2">
                              <div className="grid gap-1 text-sm text-slate-600 md:grid-cols-[minmax(0,1fr)_auto_minmax(96px,0.8fr)] md:items-end">
                                <label className="grid gap-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">A-pris</span>
                                  <Input value={row.auto_price ? String(rowMetrics?.unit ?? row.article_price ?? '') : row.unit_price} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, unit_price: event.target.value } : item) }))} inputMode="decimal" placeholder="0" disabled={row.auto_price} />
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                  <input type="checkbox" checked={!row.auto_price} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, auto_price: !event.target.checked } : item) }))} className="h-4 w-4 rounded border-slate-300" />
                                  Manuellt
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Rabatt %</span>
                                  <Input value={row.discount_percent} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === row.id ? { ...item, discount_percent: event.target.value } : item) }))} inputMode="decimal" placeholder="0" />
                                </label>
                              </div>
                            </div>

                            <button type="button" onClick={() => setDraft((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((item) => item.id !== row.id) : [createEmptyLineItem()] }))} className="rounded-full border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50">
                              Ta bort
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{rowMetrics?.label || 'Konfigurera raden'}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">Mängd {rowMetrics?.amount?.toFixed(2) || '0.00'}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">A-pris {formatCurrency(rowMetrics?.effectiveUnit ?? 0, 'SEK')}</span>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-900">Radsumma {formatCurrency(rowMetrics?.rowTotal ?? 0, 'SEK')}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Delsumma {formatCurrency(totals.subtotal, 'SEK')}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Moms {formatCurrency(totals.vat, 'SEK')}</span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-900">Total {formatCurrency(totals.total, 'SEK')}</span>
                  </div>
                </div>

                <div className="grid gap-3 rounded-[22px] border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">ROT</div>
                      <div className="text-sm font-semibold text-slate-900">Privatkund och skatteunderlag</div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={draft.rot_enabled} disabled={draft.quote_type !== 'private'} onChange={(event) => setDraft((current) => ({ ...current, rot_enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                      ROT-avdrag
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">ROT-sökande</span>
                      <Input value={draft.rot_applicant_name} onChange={(event) => setDraft((current) => ({ ...current, rot_applicant_name: event.target.value }))} placeholder="Namn på sökande" disabled={!draft.rot_enabled} />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">ROT personnummer</span>
                      <Input value={draft.rot_personal_number} onChange={(event) => setDraft((current) => ({ ...current, rot_personal_number: event.target.value }))} placeholder="ÅÅÅÅMMDD-XXXX" disabled={!draft.rot_enabled} />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fastighetsbeteckning</span>
                      <Input value={draft.rot_property_designation} onChange={(event) => setDraft((current) => ({ ...current, rot_property_designation: event.target.value }))} placeholder="Fastighetsbeteckning" disabled={!draft.rot_enabled} />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">ROT %</span>
                      <Input value={draft.rot_percent} onChange={(event) => setDraft((current) => ({ ...current, rot_percent: event.target.value }))} inputMode="decimal" placeholder="30" disabled={!draft.rot_enabled} />
                    </label>
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
                      ROT följer med till intern handoff och framtida orderflöde, men ska senare kunna styras separat från PDF-innehållet.
                    </div>
                  </div>
                </div>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Interna anteckningar</span>
                  <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Det här ska vi komma ihåg inför uppföljningen" />
                </label>

                <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Intern handoff</div>
                    <div className="text-sm font-semibold text-slate-900">Fält som följer med till arbetsorder men inte behöver vara med i PDF</div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Önskat installationsdatum</span>
                      <Input value={draft.desired_installation_date} onChange={(event) => setDraft((current) => ({ ...current, desired_installation_date: event.target.value }))} type="date" />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Arbetets scope</span>
                      <Input value={draft.work_scope} onChange={(event) => setDraft((current) => ({ ...current, work_scope: event.target.value }))} placeholder="Kort operativ scope" />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Överlämningsnotering</span>
                      <Textarea value={draft.handoff_notes} onChange={(event) => setDraft((current) => ({ ...current, handoff_notes: event.target.value }))} rows={3} placeholder="Intern information för projekt eller arbetsorder" />
                    </label>
                  </div>
                </div>

                {editingQuoteId ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 md:col-span-2">
                    <div className="grid gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">Arbetsorder</span>
                      <span className="text-sm text-emerald-950">
                        {quotes.find((item) => item.id === editingQuoteId)?.work_order_number
                          ? `Arbetsorder ${quotes.find((item) => item.id === editingQuoteId)?.work_order_number} är redan skapad.`
                          : draft.status === 'won'
                            ? 'Offerten är vunnen och kan nu bli en intern arbetsorder.'
                            : 'Sätt offerten till vunnen för att skapa arbetsorder.'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quotes.find((item) => item.id === editingQuoteId)?.work_order_id ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/crm/arbetsorder?work_order_id=${quotes.find((item) => item.id === editingQuoteId)?.work_order_id}`)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          Öppna arbetsorder
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => editingQuoteId ? createWorkOrderFromQuote(editingQuoteId) : null}
                        disabled={!editingQuoteId || draft.status !== 'won' || Boolean(quotes.find((item) => item.id === editingQuoteId)?.work_order_id || quotes.find((item) => item.id === editingQuoteId)?.work_order_number) || creatingWorkOrderId === editingQuoteId}
                        className="rounded-full border border-emerald-900 bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:border-emerald-300 disabled:bg-white disabled:text-emerald-700 disabled:opacity-70"
                      >
                        {creatingWorkOrderId === editingQuoteId
                          ? 'Skapar arbetsorder...'
                          : quotes.find((item) => item.id === editingQuoteId)?.work_order_number
                            ? 'Arbetsorder skapad'
                            : 'Skapa arbetsorder'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {!editingQuoteId ? (
                <label className="flex items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={draft.create_follow_up_task}
                    onChange={(event) => setDraft((current) => ({ ...current, create_follow_up_task: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    Skapa uppföljningsuppgift automatiskt om ett uppföljningsdatum anges.
                  </span>
                </label>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-slate-500">
                  När offertstatus går till skickad eller följ upp synkas prospektet automatiskt till offertläget.
                </span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                    Avbryt
                  </button>
                  <button type="button" onClick={saveQuote} disabled={submitting} className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? 'Sparar…' : editingQuoteId ? 'Spara offert' : 'Skapa offert'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArticlePicker({ value, onSelect, onClear }: { value: string; onSelect: (article: ArticleLite) => void; onClear: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArticleLite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setItems([]);
      return;
    }

    let cancelled = false;

    async function loadArticles() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/blikk/articles?q=${encodeURIComponent(query)}&page=1&pageSize=10`, { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || 'Kunde inte hämta artiklar');
        if (!cancelled) setItems(Array.isArray(json?.items) ? json.items : Array.isArray(json?.data?.items) ? json.data.items : []);
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Kunde inte hämta artiklar');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadArticles();
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  return (
    <div className="relative grid gap-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={value || 'Sök artikel...'}
        />
        {value ? (
          <button type="button" onClick={onClear} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            Rensa
          </button>
        ) : null}
      </div>

      {value ? <div className="text-xs text-slate-500">Vald artikel: {value}</div> : null}

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 grid overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.12)]">
          {loading ? <div className="px-3 py-2 text-sm text-slate-500">Söker artiklar...</div> : null}
          {error ? <div className="px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!loading && !error && items.length === 0 ? <div className="px-3 py-2 text-sm text-slate-500">Inga artiklar hittades.</div> : null}
          {!loading && !error
            ? items.map((item) => (
                <button
                  key={item.id || item.articleNumber || item.name}
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="grid gap-0.5 border-b border-slate-100 px-3 py-2 text-left transition last:border-b-0 hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900">{item.name || 'Artikel'}</span>
                  <span className="text-xs text-slate-500">
                    {item.articleNumber || 'Utan artikelnummer'}
                    {typeof item.price === 'number' ? ` • ${item.price.toFixed(2)} kr` : ''}
                    {getArticleUnitName(item.unit) ? ` • ${getArticleUnitName(item.unit)}` : ''}
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}