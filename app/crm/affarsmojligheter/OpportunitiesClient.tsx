"use client";

import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../components/MetricCard';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type OpportunityStatus = 'qualified' | 'quoted' | 'won' | 'lost';

type OpportunityItem = {
  id: string;
  prospect_id: string | null;
  title: string;
  status: OpportunityStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  prospect: {
    id: string;
    company_name: string;
    contact_name: string | null;
    city: string | null;
    source: string | null;
  } | null;
};

const statusLabel: Record<OpportunityStatus, string> = {
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const statusClass: Record<OpportunityStatus, string> = {
  qualified: 'border-violet-200 bg-violet-50 text-violet-700',
  quoted: 'border-amber-200 bg-amber-50 text-amber-700',
  won: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  lost: 'border-rose-200 bg-rose-50 text-rose-700',
};

const boardMeta: Record<OpportunityStatus, { hint: string; empty: string }> = {
  qualified: { hint: 'Köpintresse bekräftat, affären är igång', empty: 'Skapa en affärsmöjlighet från ett prospekt' },
  quoted: { hint: 'Offert ute eller på väg ut', empty: 'Dra hit när offerten är del av affären' },
  won: { hint: 'Affären är klar', empty: 'Dra hit när affären är vunnen' },
  lost: { hint: 'Stängd utan affär', empty: 'Dra hit om affären inte gick vidare' },
};

const boardOrder: OpportunityStatus[] = ['qualified', 'quoted', 'won', 'lost'];

type OpportunityFilter = 'alla' | OpportunityStatus;

const filterMeta: Record<OpportunityFilter, { label: string }> = {
  alla: { label: 'Alla' },
  qualified: { label: 'Kvalificerade' },
  quoted: { label: 'Offert' },
  won: { label: 'Vunna' },
  lost: { label: 'Förlorade' },
};

type CreateDraft = {
  prospect_id: string;
  title: string;
  status: OpportunityStatus;
  notes: string;
};

const initialDraft: CreateDraft = {
  prospect_id: '',
  title: '',
  status: 'qualified',
  notes: '',
};

type ProspectOption = {
  id: string;
  company_name: string;
  contact_name: string | null;
};

type RelatedQuote = {
  id: string;
  project_name: string;
  amount: number | string;
  currency_code: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
};

const quoteStatusLabel: Record<RelatedQuote['status'], string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  follow_up: 'Följ upp',
  won: 'Vunnen',
  lost: 'Förlorad',
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function compareByUpdated(a: OpportunityItem, b: OpportunityItem) {
  return b.updated_at.localeCompare(a.updated_at);
}

export default function OpportunitiesClient() {
  const toast = useToast();
  const [items, setItems] = useState<OpportunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<OpportunityFilter>('alla');
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState<Omit<CreateDraft, 'prospect_id'>>({ title: '', status: 'qualified', notes: '' });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTargetStatus, setDragTargetStatus] = useState<OpportunityStatus | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [prospectOptions, setProspectOptions] = useState<ProspectOption[]>([]);
  const [relatedQuotes, setRelatedQuotes] = useState<RelatedQuote[]>([]);
  const [relatedQuotesLoading, setRelatedQuotesLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/opportunities${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda affärsmöjligheter. Har SQL-migrationen körts?');
          setItems([]);
          return;
        }
        const nextItems = Array.isArray(json?.data?.items) ? (json.data.items as OpportunityItem[]) : [];
        setItems(nextItems);
        setSelectedId((current) => {
          if (current && nextItems.some((item) => item.id === current)) return current;
          return nextItems[0]?.id || null;
        });
      } catch {
        if (!active) return;
        setError('Kunde inte ladda affärsmöjligheter.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [search]);

  useEffect(() => {
    async function loadProspects() {
      try {
        const res = await fetch('/api/crm/prospects', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          setProspectOptions(
            (json.data?.items || []).map((p: any) => ({
              id: p.id,
              company_name: p.company_name,
              contact_name: p.contact_name,
            }))
          );
        }
      } catch {
        // prospektlistan är valfri i formuläret
      }
    }
    loadProspects();
  }, []);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;
    let active = true;

    async function loadQuotes() {
      setRelatedQuotesLoading(true);
      try {
        const res = await fetch(`/api/crm/quotes?opportunity_id=${encodeURIComponent(selectedId!)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        setRelatedQuotes(res.ok && json.ok ? (json.data?.items || []) : []);
      } catch {
        if (active) setRelatedQuotes([]);
      } finally {
        if (active) setRelatedQuotesLoading(false);
      }
    }

    loadQuotes();
    return () => { active = false; };
  }, [detailOpen, selectedId]);

  useEffect(() => {
    if (!detailOpen) setRelatedQuotes([]);
  }, [detailOpen]);

  useEffect(() => {
    if (!(createPanelOpen || detailOpen)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [createPanelOpen, detailOpen]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDetailDraft({ title: selected.title, status: selected.status, notes: selected.notes || '' });
  }, [selected]);

  const visibleItems = useMemo(() => {
    if (filter === 'alla') return items.sort(compareByUpdated);
    return items.filter((item) => item.status === filter).sort(compareByUpdated);
  }, [filter, items]);

  const visibleBoardStatuses = useMemo(
    () => (filter === 'alla' ? boardOrder : boardOrder.filter((s) => s === filter)),
    [filter]
  );

  const groupedItems = useMemo(
    () => visibleBoardStatuses.map((status) => ({
      status,
      items: items.filter((item) => item.status === status).sort(compareByUpdated),
    })),
    [items, visibleBoardStatuses]
  );

  const filterCounts = useMemo<Record<OpportunityFilter, number>>(() => ({
    alla: items.length,
    qualified: items.filter((i) => i.status === 'qualified').length,
    quoted: items.filter((i) => i.status === 'quoted').length,
    won: items.filter((i) => i.status === 'won').length,
    lost: items.filter((i) => i.status === 'lost').length,
  }), [items]);

  const stats = useMemo(() => ({
    open: items.filter((i) => i.status === 'qualified' || i.status === 'quoted').length,
    qualified: items.filter((i) => i.status === 'qualified').length,
    quoted: items.filter((i) => i.status === 'quoted').length,
    won: items.filter((i) => i.status === 'won').length,
  }), [items]);

  async function createOpportunity() {
    if (!draft.title.trim()) {
      toast.error('Titel krävs');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/crm/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: draft.prospect_id || null,
          title: draft.title,
          status: draft.status,
          notes: draft.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skapa affärsmöjlighet');
        return;
      }
      const item = json?.data?.item as OpportunityItem | undefined;
      if (item) {
        setItems((current) => [item, ...current]);
        setSelectedId(item.id);
      }
      setDraft(initialDraft);
      setCreatePanelOpen(false);
      toast.success('Affärsmöjlighet skapad');
    } catch {
      toast.error('Fel vid skapande av affärsmöjlighet');
    } finally {
      setCreating(false);
    }
  }

  async function saveDetail() {
    if (!selected) return;
    if (!detailDraft.title.trim()) {
      toast.error('Titel krävs');
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: selected.prospect_id,
          title: detailDraft.title,
          status: detailDraft.status,
          notes: detailDraft.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte uppdatera affärsmöjlighet');
        return;
      }
      const item = json?.data?.item as OpportunityItem | undefined;
      if (item) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      }
      setDetailEditing(false);
      toast.success('Affärsmöjlighet uppdaterad');
    } catch {
      toast.error('Fel vid uppdatering');
    } finally {
      setSavingDetail(false);
    }
  }

  async function moveToStatus(opportunityId: string, nextStatus: OpportunityStatus) {
    const current = items.find((item) => item.id === opportunityId);
    if (!current || current.status === nextStatus) return;

    setMovingId(opportunityId);
    setItems((prev) => prev.map((item) => item.id === opportunityId ? { ...item, status: nextStatus, updated_at: new Date().toISOString() } : item));

    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: current.prospect_id,
          title: current.title,
          status: nextStatus,
          notes: current.notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setItems((prev) => prev.map((item) => item.id === opportunityId ? current : item));
        toast.error(json?.error || 'Kunde inte flytta affärsmöjligheten');
        return;
      }
      const updated = json?.data?.item as OpportunityItem | undefined;
      if (updated) {
        setItems((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      }
    } catch {
      setItems((prev) => prev.map((item) => item.id === opportunityId ? current : item));
      toast.error('Kunde inte flytta affärsmöjligheten');
    } finally {
      setMovingId(null);
      setDraggedId(null);
      setDragTargetStatus(null);
    }
  }

  function renderCard(item: OpportunityItem) {
    const active = selectedId === item.id;
    const companyName = item.prospect?.company_name || null;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setSelectedId(item.id); setDetailOpen(true); }}
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); setDraggedId(item.id); }}
        onDragEnd={() => { setDraggedId(null); setDragTargetStatus(null); }}
        className={cn(
          'relative grid min-h-[150px] grid-rows-[minmax(0,1fr)_auto] items-start gap-2 overflow-hidden rounded-[18px] border p-3 text-left shadow-[0_10px_22px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_28px_rgba(15,23,42,0.08)] cursor-grab active:cursor-grabbing bg-[linear-gradient(180deg,#ffffff_0%,#fcfefd_100%)]',
          movingId === item.id || draggedId === item.id ? 'opacity-60' : null,
          active ? 'ring-1 ring-emerald-200 shadow-[0_18px_34px_rgba(16,185,129,0.14)]' : null,
          item.status === 'won' ? 'border-emerald-200/80' : item.status === 'quoted' ? 'border-amber-200/80' : item.status === 'lost' ? 'border-rose-200/80' : 'border-violet-200/80',
        )}
      >
        <span className={cn(
          'absolute inset-y-0 left-0 w-1 rounded-l-[18px]',
          item.status === 'won' ? 'bg-emerald-400' : item.status === 'quoted' ? 'bg-amber-400' : item.status === 'lost' ? 'bg-rose-300' : 'bg-violet-400'
        )} />

        <div className="grid min-h-[56px] w-full content-start gap-1 pl-2">
          <strong className="line-clamp-2 text-[15px] font-bold tracking-[-0.03em] text-slate-950">{item.title}</strong>
          {companyName ? (
            <span className="text-[12px] text-slate-500">{companyName}{item.prospect?.city ? ` · ${item.prospect.city}` : ''}</span>
          ) : null}
        </div>

        <div className="mt-auto grid gap-1 pl-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-400">Uppdaterad {formatDateTime(item.updated_at)}</span>
        </div>
      </button>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Affärsmöjligheter</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Aktiva affärer med bekräftat köpintresse</p>
        </div>
        <button
          type="button"
          onClick={() => setCreatePanelOpen(true)}
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Ny affärsmöjlighet
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Aktiva affärer" value={stats.open} helper="Kvalificerade och i offertläge" />
        <MetricCard label="Kvalificerade" value={stats.qualified} helper="Köpintresse bekräftat" />
        <MetricCard label="I offertläge" value={stats.quoted} helper="Offert ute eller på väg" />
        <MetricCard label="Vunna" value={stats.won} helper="Klara att lämna vidare mot order" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="mb-4">
          <h2 className="m-0 text-base font-bold text-slate-900">Pipeline</h2>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på titel eller företag"
            className="max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(filterMeta) as OpportunityFilter[]).map((value) => {
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
                  {filterMeta[value].label}
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600')}>
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-3">
          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="h-3 w-40 rounded-full bg-slate-200" />
                  <div className="h-3 w-24 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <strong className="text-base font-bold text-slate-900">Inga affärsmöjligheter i den här vyn</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">
                Skapa din första affärsmöjlighet eller välj ett annat filter.
              </p>
            </div>
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-2 2xl:grid-cols-4">
              {groupedItems.map((section) => (
                <div
                  key={section.status}
                  onDragOver={(e) => {
                    if (!draggedId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragTargetStatus !== section.status) setDragTargetStatus(section.status);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = draggedId || e.dataTransfer.getData('text/plain');
                    if (!id) return;
                    void moveToStatus(id, section.status);
                  }}
                  className={cn(
                    'grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 transition-[border-color,background-color]',
                    dragTargetStatus === section.status ? 'border-emerald-300 bg-emerald-50/40' : null,
                  )}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <strong className="text-sm font-bold text-slate-800">{statusLabel[section.status]}</strong>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', statusClass[section.status])}>
                      {section.items.length}
                    </span>
                  </div>
                  <p className="m-0 text-[11px] text-slate-400">{boardMeta[section.status].hint}</p>
                  <div className="grid gap-3">
                    {section.items.length > 0
                      ? section.items.map((item) => renderCard(item))
                      : <div className="rounded-[16px] border border-dashed border-slate-200 bg-white/70 px-3 py-6 text-center text-sm text-slate-500">{boardMeta[section.status].empty}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Skapa-panel */}
      {createPanelOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setCreatePanelOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Skapa affärsmöjlighet"
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[660px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ny affärsmöjlighet</span>
                <strong className="text-[1.5rem] font-bold tracking-[-0.05em] text-slate-950">Registrera affären</strong>
                <p className="m-0 text-sm leading-6 text-slate-600">
                  Koppla till ett prospekt och ge affären ett beskrivande namn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreatePanelOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <Input
                value={draft.title}
                onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
                placeholder="Titel, t.ex. Takisolering 2026"
              />
              <label className="grid gap-1 text-sm text-slate-600">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Koppla till prospekt (valfritt)</span>
                <select
                  value={draft.prospect_id}
                  onChange={(e) => setDraft((c) => ({ ...c, prospect_id: e.target.value }))}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                >
                  <option value="">— Inget prospekt —</option>
                  {prospectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.company_name}{p.contact_name ? ` (${p.contact_name})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-slate-600">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value as OpportunityStatus }))}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                >
                  {(Object.entries(statusLabel) as [OpportunityStatus, string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <Textarea
                value={draft.notes}
                onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))}
                placeholder="Anteckningar om affären"
                className="min-h-[100px]"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreatePanelOpen(false)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={createOpportunity}
                  disabled={creating}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? 'Sparar…' : 'Skapa affärsmöjlighet'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Detaljpanel */}
      {detailOpen && selected ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setDetailOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Affärsmöjlighet ${selected.title}`}
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Affärsmöjlighet</span>
                <strong className="text-[1.4rem] font-bold tracking-[-0.05em] text-slate-950">{selected.title}</strong>
                {selected.prospect ? (
                  <p className="m-0 text-sm text-slate-500">{selected.prospect.company_name}{selected.prospect.contact_name ? ` · ${selected.prospect.contact_name}` : ''}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass[selected.status])}>
                  {statusLabel[selected.status]}
                </span>
                <button
                  type="button"
                  onClick={() => setDetailEditing((c) => !c)}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  {detailEditing ? 'Avsluta redigering' : 'Redigera'}
                </button>
                <a
                  href={`/crm/offerter?opportunity_id=${selected.id}&new=1`}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-amber-500 bg-[linear-gradient(180deg,#f59e0b_0%,#d97706_100%)] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-[0.97]"
                >
                  Skapa offert
                </a>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  Stäng
                </button>
              </div>
            </div>

            {detailEditing ? (
              <div className="grid gap-3 rounded-[20px] border border-white/80 bg-white/90 p-3 shadow-[0_12px_24px_rgba(15,23,42,0.04)]">
                <Input
                  value={detailDraft.title}
                  onChange={(e) => setDetailDraft((c) => ({ ...c, title: e.target.value }))}
                  placeholder="Titel"
                />
                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
                  <select
                    value={detailDraft.status}
                    onChange={(e) => setDetailDraft((c) => ({ ...c, status: e.target.value as OpportunityStatus }))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                  >
                    {(Object.entries(statusLabel) as [OpportunityStatus, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <Textarea
                  value={detailDraft.notes}
                  onChange={(e) => setDetailDraft((c) => ({ ...c, notes: e.target.value }))}
                  placeholder="Anteckningar"
                  className="min-h-[100px]"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setDetailEditing(false); setDetailDraft({ title: selected.title, status: selected.status, notes: selected.notes || '' }); }}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300"
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={saveDetail}
                    disabled={savingDetail}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:opacity-60"
                  >
                    {savingDetail ? 'Sparar…' : 'Spara ändringar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="grid gap-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Anteckningar</span>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                    {selected.notes || 'Inga anteckningar än.'}
                  </p>
                </div>
                <div className="grid gap-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Skapad</span>
                  <span className="text-sm font-semibold text-slate-900">{formatDateTime(selected.created_at)}</span>
                </div>
              </div>
            )}

            {selected.prospect ? (
              <div className="grid gap-2 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kopplat prospekt</span>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="m-0 text-sm font-semibold text-slate-900">{selected.prospect.company_name}</p>
                    {selected.prospect.contact_name ? <p className="m-0 text-xs text-slate-500">{selected.prospect.contact_name}</p> : null}
                  </div>
                  <a
                    href={`/crm/prospekt`}
                    className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.04)] transition hover:border-slate-300"
                  >
                    Gå till prospektregister
                  </a>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-[20px] border border-amber-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf2_100%)] px-4 py-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid gap-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700/70">Offerter</span>
                  <strong className="text-sm font-semibold text-slate-900">Offerter på affärsmöjligheten</strong>
                </div>
                <a
                  href={`/crm/offerter?opportunity_id=${selected.id}&new=1`}
                  className="inline-flex min-h-9 items-center justify-center rounded-full border border-amber-500 bg-[linear-gradient(180deg,#f59e0b_0%,#d97706_100%)] px-3 py-2 text-xs font-semibold text-white shadow-[0_14px_24px_rgba(217,119,6,0.18)] transition hover:brightness-[0.97]"
                >
                  Skapa offert
                </a>
              </div>
              {relatedQuotesLoading ? (
                <div className="grid gap-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="grid gap-2 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="h-3 w-32 rounded-full bg-slate-200" />
                      <div className="h-3 w-48 rounded-full bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : relatedQuotes.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Ingen offert registrerad ännu för den här affärsmöjligheten.
                </div>
              ) : (
                <div className="grid gap-2">
                  {relatedQuotes.map((quote) => (
                    <div key={quote.id} className="grid gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-4 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm font-semibold text-slate-900">{quote.project_name}</strong>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                          {quoteStatusLabel[quote.status]}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{formatCurrency(quote.amount, quote.currency_code)}</span>
                        <span>Offertdatum: {formatDate(quote.quote_date)}</span>
                        {quote.follow_up_date ? <span>Följ upp: {formatDate(quote.follow_up_date)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
