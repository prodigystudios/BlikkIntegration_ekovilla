"use client";
import { useEffect, useMemo, useState } from 'react';
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
  project_name: string;
  description: string | null;
  amount: number | string;
  currency_code: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type QuoteDraft = {
  prospect_id: string;
  customer_name: string;
  project_name: string;
  description: string;
  amount: string;
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
    cardClass: 'border-slate-300 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]',
    amountClass: 'border-slate-200 bg-white text-slate-800',
  },
  sent: {
    label: 'Skickad',
    className: 'border-sky-300 bg-sky-100 text-sky-800',
    cardClass: 'border-sky-200 bg-[linear-gradient(180deg,#ffffff_0%,#f0f9ff_100%)]',
    amountClass: 'border-sky-200 bg-white text-sky-900',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-300 bg-amber-100 text-amber-900',
    cardClass: 'border-amber-300 bg-[linear-gradient(180deg,#ffffff_0%,#fff7ed_100%)] ring-1 ring-amber-100',
    amountClass: 'border-amber-200 bg-white text-amber-900',
  },
  won: {
    label: 'Vunnen',
    className: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    cardClass: 'border-emerald-300 bg-[linear-gradient(180deg,#ffffff_0%,#ecfdf5_100%)]',
    amountClass: 'border-emerald-200 bg-white text-emerald-900',
  },
  lost: {
    label: 'Förlorad',
    className: 'border-rose-300 bg-rose-100 text-rose-800',
    cardClass: 'border-rose-200 bg-[linear-gradient(180deg,#ffffff_0%,#fff1f2_100%)]',
    amountClass: 'border-rose-200 bg-white text-rose-900',
  },
};

const initialDraft: QuoteDraft = {
  prospect_id: '',
  customer_name: '',
  project_name: '',
  description: '',
  amount: '',
  status: 'draft',
  quote_date: new Date().toISOString().slice(0, 10),
  follow_up_date: '',
  notes: '',
  create_follow_up_task: true,
};

const quoteFilterMeta: Record<QuoteFilter, { label: string; hint: string; tone: string }> = {
  all: { label: 'Alla', hint: 'Hela pipen', tone: 'border-slate-300 bg-white text-slate-700' },
  active: { label: 'Aktiva', hint: 'Pågående affärer', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  follow_up: { label: 'Följ upp', hint: 'Nästa steg nu', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  won: { label: 'Vunna', hint: 'Stängda affärer', tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  lost: { label: 'Förlorade', hint: 'Tappade affärer', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
};

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getQuoteCustomerName(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name || item.customer_name || 'Okänd kund';
}

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

function isOverdue(item: QuoteItem) {
  if (!item.follow_up_date || item.status === 'won' || item.status === 'lost') return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return item.follow_up_date < todayIso;
}

export default function QuotesClient() {
  const toast = useToast();
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

  const prospectsById = useMemo(() => new Map(prospects.map((item) => [item.id, item])), [prospects]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());

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
  }, [search]);

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

  const stats = useMemo(() => ({
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

  function openCreateModal() {
    setEditingQuoteId(null);
    setDraft(initialDraft);
    setModalOpen(true);
  }

  function openEditModal(item: QuoteItem) {
    setEditingQuoteId(item.id);
    setDraft({
      prospect_id: item.prospect_id || '',
      customer_name: item.customer_name || '',
      project_name: item.project_name,
      description: item.description || '',
      amount: String(item.amount ?? ''),
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
      toast.error('Ange ett giltigt belopp');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = Boolean(editingQuoteId);
      const payload = {
        prospect_id: draft.prospect_id || null,
        customer_name: draft.customer_name,
        project_name: draft.project_name,
        description: draft.description,
        amount: draft.amount,
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

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.08),_transparent_24%),linear-gradient(180deg,#fcfffe_0%,#f8fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-teal-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Offerter
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">Offerter</h1>
                  <div className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900">
                    {stats.active} aktiva
                  </div>
                </div>
                <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                  Första offertytan fokuserar på pipeline och uppföljning. Du registrerar vad som är skickat, vad som behöver följas upp och vad som faktiskt blir vunnet eller förlorat.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button type="button" onClick={openCreateModal} className="inline-flex items-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-950">
                Ny offert
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Aktiva</div>
              <div className="mt-1 text-3xl font-bold tracking-[-0.04em] text-slate-950">{stats.active}</div>
              <div className="mt-1 text-sm text-slate-500">Utkast, skickade och uppföljning</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Följ upp</div>
              <div className="mt-1 text-3xl font-bold tracking-[-0.04em] text-slate-950">{stats.followUp}</div>
              <div className="mt-1 text-sm text-slate-500">Behöver nästa kontakt</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Vunna</div>
              <div className="mt-1 text-3xl font-bold tracking-[-0.04em] text-slate-950">{stats.won}</div>
              <div className="mt-1 text-sm text-slate-500">Redo för nästa affärssteg</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Sena uppföljningar</div>
              <div className="mt-1 text-3xl font-bold tracking-[-0.04em] text-slate-950">{stats.overdue}</div>
              <div className="mt-1 text-sm text-slate-500">Offerter som borde få ett nytt steg nu</div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="grid gap-4 border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-5 md:p-6">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på offert, kund, prospekt eller anteckning"
            className="max-w-xl"
          />
          <div className="grid gap-2 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.92))] p-2 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
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
                      ? 'border-slate-900 bg-slate-900 text-white shadow-[0_14px_24px_rgba(15,23,42,0.16)]'
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
            {visibleQuotes.map((item) => {
              const prospect = getProspectFromQuote(item);
              const overdue = isOverdue(item);
              const statusMeta = quoteStatusMeta[item.status];

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openEditModal(item)}
                  className={cn(
                    'relative grid gap-3 overflow-hidden rounded-[24px] border p-4 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.10)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_auto] md:items-center',
                    statusMeta.cardClass,
                    overdue && item.status !== 'follow_up' ? 'ring-1 ring-amber-100' : null,
                  )}
                >
                  <span className={cn('absolute inset-y-0 left-0 w-1.5 rounded-l-[24px]', item.status === 'won' ? 'bg-emerald-400' : item.status === 'follow_up' ? 'bg-amber-400' : item.status === 'sent' ? 'bg-sky-400' : item.status === 'lost' ? 'bg-rose-300' : 'bg-slate-300')} />

                  <div className="grid gap-2 pl-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {prospect ? 'Kopplat prospekt' : 'Fristående offert'}
                    </span>
                    <div className="grid gap-1">
                      <strong className="text-lg font-bold tracking-[-0.03em] text-slate-950">{item.project_name}</strong>
                      <p className="m-0 text-sm font-medium text-slate-600">{getQuoteCustomerName(item)}</p>
                    </div>
                  </div>

                  <div className="grid gap-2 pl-2 md:pl-0">
                    {(item.description || item.notes) ? (
                      <p className="m-0 line-clamp-2 text-sm leading-6 text-slate-600">{item.description || item.notes}</p>
                    ) : (
                      <p className="m-0 text-sm text-slate-500">Ingen beskrivning ännu. Klicka för att lägga till offertdetaljer och nästa steg.</p>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 font-medium text-slate-700">Offertdatum {formatDate(item.quote_date)}</span>
                      {item.follow_up_date ? <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 font-medium text-slate-700">Följ upp {formatDate(item.follow_up_date)}</span> : null}
                      {prospect?.city ? <span className="rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1">{prospect.city}</span> : null}
                    </div>
                  </div>

                  <div className="grid content-start justify-items-start gap-2 pl-2 md:justify-items-end md:pl-0">
                    <span className={cn('rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] shadow-[0_10px_18px_rgba(15,23,42,0.06)]', statusMeta.className)}>
                      {statusMeta.label}
                    </span>
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
            })}
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
                  <p className="m-0 text-sm leading-6 text-slate-500">Registrera offertläge och lägg en uppföljning direkt om du vill hålla den i pipeline.</p>
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
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kundnamn</span>
                  <Input value={draft.customer_name} onChange={(event) => setDraft((current) => ({ ...current, customer_name: event.target.value }))} placeholder="Företag eller kund" />
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

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Beskrivning</span>
                  <Textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Kort om omfattning eller vad som offereras" />
                </label>

                <label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Interna anteckningar</span>
                  <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Det här ska vi komma ihåg inför uppföljningen" />
                </label>
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
                  När offertstatus går till skickad eller följ upp synkas prospektet automatiskt till offert-läget.
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