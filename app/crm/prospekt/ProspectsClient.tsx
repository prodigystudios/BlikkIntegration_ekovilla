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
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const statusLabel: Record<ProspectItem['status'], string> = {
  new: 'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const statusClass: Record<ProspectItem['status'], string> = {
  new: 'border-slate-200 bg-slate-100 text-slate-700',
  contacted: 'border-sky-200 bg-sky-50 text-sky-700',
  qualified: 'border-violet-200 bg-violet-50 text-violet-700',
  quoted: 'border-amber-200 bg-amber-50 text-amber-700',
  won: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  lost: 'border-rose-200 bg-rose-50 text-rose-700',
};

type CreateProspectDraft = {
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
  street_address: string;
  postal_code: string;
  city: string;
  source: string;
  notes: string;
  status: ProspectItem['status'];
};

const initialDraft: CreateProspectDraft = {
  company_name: '',
  organization_number: '',
  contact_name: '',
  phone: '',
  email: '',
  street_address: '',
  postal_code: '',
  city: '',
  source: '',
  notes: '',
  status: 'new',
};

type ProspectCallItem = {
  id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at: string;
};

type ProspectQuoteItem = {
  id: string;
  project_name: string;
  amount: number | string;
  currency_code: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
};

const callOutcomeLabel: Record<ProspectCallItem['outcome'], string> = {
  no_answer: 'Ej svar',
  follow_up: 'Följ upp',
  positive: 'Positivt',
  negative: 'Negativt',
};

const quoteStatusLabel: Record<ProspectQuoteItem['status'], string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  follow_up: 'Följ upp',
  won: 'Vunnen',
  lost: 'Förlorad',
};

type ProspectFilter = 'pipeline' | 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';

const prospectFilterMeta: Record<ProspectFilter, { label: string; hint: string }> = {
  pipeline: { label: 'Pipen', hint: 'Aktivt säljarbete' },
  new: { label: 'Nya', hint: 'Första kontakt' },
  contacted: { label: 'Kontaktade', hint: 'Dialog igång' },
  qualified: { label: 'Kvalificerade', hint: 'Bra signal' },
  quoted: { label: 'Offert', hint: 'Väntar beslut' },
  won: { label: 'Vunna', hint: 'Stängda' },
  lost: { label: 'Förlorade', hint: 'Tappade' },
};

function getProspectInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function buildProspectMeta(item: ProspectItem) {
  return [
    item.contact_name ? `Kontakt: ${item.contact_name}` : null,
    item.city ? `Ort: ${item.city}` : null,
    item.source ? `Källa: ${item.source}` : null,
  ].filter(Boolean) as string[];
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

function isPipelineProspect(item: ProspectItem) {
  return item.status === 'new' || item.status === 'contacted' || item.status === 'qualified' || item.status === 'quoted';
}

export default function ProspectsClient() {
  const toast = useToast();
  const [items, setItems] = useState<ProspectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [relatedCalls, setRelatedCalls] = useState<ProspectCallItem[]>([]);
  const [relatedCallsLoading, setRelatedCallsLoading] = useState(false);
  const [relatedQuotes, setRelatedQuotes] = useState<ProspectQuoteItem[]>([]);
  const [relatedQuotesLoading, setRelatedQuotesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProspectFilter>('pipeline');
  const [draft, setDraft] = useState<CreateProspectDraft>(initialDraft);
  const [detailDraft, setDetailDraft] = useState<CreateProspectDraft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/prospects${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda prospekt. Har migrationen körts i databasen?');
          setItems([]);
          return;
        }
        const nextItems = Array.isArray(json?.data?.items) ? json.data.items as ProspectItem[] : [];
        setItems(nextItems);
        setSelectedId((current) => {
          if (current && nextItems.some((item) => item.id === current)) return current;
          return nextItems[0]?.id || null;
        });
      } catch {
        if (!active) return;
        setError('Kunde inte ladda prospekt.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [search]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const selectedMeta = selected ? buildProspectMeta(selected) : [];
  const visibleItems = useMemo(() => {
    if (filter === 'pipeline') return items.filter(isPipelineProspect);
    return items.filter((item) => item.status === filter);
  }, [filter, items]);
  const filterCounts = useMemo<Record<ProspectFilter, number>>(() => ({
    pipeline: items.filter(isPipelineProspect).length,
    new: items.filter((item) => item.status === 'new').length,
    contacted: items.filter((item) => item.status === 'contacted').length,
    qualified: items.filter((item) => item.status === 'qualified').length,
    quoted: items.filter((item) => item.status === 'quoted').length,
    won: items.filter((item) => item.status === 'won').length,
    lost: items.filter((item) => item.status === 'lost').length,
  }), [items]);

  useEffect(() => {
    if (!selected) return;

    setDetailDraft({
      company_name: selected.company_name,
      organization_number: selected.organization_number || '',
      contact_name: selected.contact_name || '',
      phone: selected.phone || '',
      email: selected.email || '',
      street_address: selected.street_address || '',
      postal_code: selected.postal_code || '',
      city: selected.city || '',
      source: selected.source || '',
      notes: selected.notes || '',
      status: selected.status,
    });
  }, [selected]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;

    let active = true;
    const prospectId = selectedId;

    async function loadRelatedActivity() {
      setRelatedCallsLoading(true);
      setRelatedQuotesLoading(true);
      try {
        const [callsRes, quotesRes] = await Promise.all([
          fetch(`/api/crm/calls?prospect_id=${encodeURIComponent(prospectId)}`, { cache: 'no-store' }),
          fetch(`/api/crm/quotes?prospect_id=${encodeURIComponent(prospectId)}`, { cache: 'no-store' }),
        ]);
        const [callsJson, quotesJson] = await Promise.all([
          callsRes.json().catch(() => ({})),
          quotesRes.json().catch(() => ({})),
        ]);

        if (!active) return;

        if (!callsRes.ok || !callsJson.ok) {
          setRelatedCalls([]);
        } else {
          setRelatedCalls(Array.isArray(callsJson?.data?.items) ? callsJson.data.items : []);
        }

        if (!quotesRes.ok || !quotesJson.ok) {
          setRelatedQuotes([]);
        } else {
          setRelatedQuotes(Array.isArray(quotesJson?.data?.items) ? quotesJson.data.items : []);
        }
      } catch {
        if (!active) return;
        setRelatedCalls([]);
        setRelatedQuotes([]);
      } finally {
        if (active) {
          setRelatedCallsLoading(false);
          setRelatedQuotesLoading(false);
        }
      }
    }

    loadRelatedActivity();

    return () => {
      active = false;
    };
  }, [detailOpen, selectedId]);

  useEffect(() => {
    if (!(createPanelOpen || detailOpen)) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [createPanelOpen, detailOpen]);

  async function createProspect() {
    if (!draft.company_name.trim()) {
      toast.error('Företagsnamn krävs');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          status: undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skapa prospekt');
        return;
      }

      const item = json?.data?.item as ProspectItem | undefined;
      if (item) {
        setItems((current) => [item, ...current]);
        setSelectedId(item.id);
      }
      setDraft(initialDraft);
      setCreatePanelOpen(false);
      toast.success('Prospekt skapat');
    } catch {
      toast.error('Fel vid skapande av prospekt');
    } finally {
      setCreating(false);
    }
  }

  async function saveProspectDetail() {
    if (!selected) return;
    if (!detailDraft.company_name.trim()) {
      toast.error('Företagsnamn krävs');
      return;
    }

    setSavingDetail(true);
    try {
      const res = await fetch(`/api/crm/prospects/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detailDraft),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte uppdatera prospekt');
        return;
      }

      const item = json?.data?.item as ProspectItem | undefined;
      if (item) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      }

      setDetailEditing(false);
      toast.success('Prospekt uppdaterat');
    } catch {
      toast.error('Fel vid uppdatering av prospekt');
    } finally {
      setSavingDetail(false);
    }
  }

  return (
    <div className="grid gap-4">
        <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.10),_transparent_28%),linear-gradient(180deg,#fcfffe_0%,#f3f8f6_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
          <div className="grid gap-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="grid gap-3">
                <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                  CRM / Prospekt
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="m-0 text-[clamp(2rem,4vw,3.35rem)] font-bold tracking-[-0.06em] text-slate-950">Prospekt</h1>
                    <div className="rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-xs font-semibold text-emerald-900">
                      {items.length} aktiva
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreatePanelOpen(true)}
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_28px_rgba(16,185,129,0.20)] transition hover:brightness-[0.97]"
                    >
                      Lägg till prospekt
                    </button>
                  </div>
                  <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                    En säljyta för fokus, inte bara registrering. Det ska vara lätt att se vilket prospekt som är hett, vad som saknar uppföljning och var nästa steg ska tas.
                  </p>
                </div>
              </div>

              <div className="grid gap-2 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100/80">Snapshot</span>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Totalt</div>
                    <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{items.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Nya</div>
                    <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{items.filter((item) => item.status === 'new').length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Valt</div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">{selected?.company_name || 'Inget valt'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/70 bg-white/75 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)] backdrop-blur lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Sök på företag, kontakt, e-post eller ort"
                className="rounded-2xl border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-700">{visibleItems.length} i vy</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Senaste aktivitet först</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Öppna detalj för nästa steg</span>
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] p-4 shadow-[0_16px_30px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <strong className="text-sm font-semibold text-slate-950">Säljfilter</strong>
                  <p className="m-0 text-sm leading-6 text-slate-600">Växla snabbt mellan nya leads, pågående dialoger och stängda utfall utan att lämna listan.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {prospectFilterMeta[filter].label} / {prospectFilterMeta[filter].hint}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(prospectFilterMeta) as ProspectFilter[]).map((value) => {
                  const active = filter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={cn(
                        'grid min-h-[78px] gap-1 rounded-[22px] border px-3 py-3 text-left transition-[border-color,box-shadow,transform,background-color]',
                        active
                          ? 'border-emerald-300 bg-[linear-gradient(180deg,rgba(236,253,245,0.95),rgba(255,255,255,0.98))] shadow-[0_16px_30px_rgba(16,185,129,0.12)]'
                          : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_22px_rgba(15,23,42,0.06)]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{prospectFilterMeta[value].label}</span>
                        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
                          {filterCounts[value]}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{prospectFilterMeta[value].hint}</span>
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
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="h-3 w-40 rounded-full bg-slate-200" />
                    <div className="h-3 w-24 rounded-full bg-slate-200" />
                    <div className="h-2.5 w-56 rounded-full bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <strong className="text-base font-bold text-slate-900">Inga prospekt i den här vyn</strong>
                <p className="m-0 text-sm leading-6 text-slate-600">
                  Det finns inga poster som matchar {prospectFilterMeta[filter].label.toLowerCase()} just nu. Testa ett annat filter eller lägg in ett nytt prospekt.
                </p>
              </div>
            ) : (
              visibleItems.map((item) => {
                const active = selectedId === item.id;
                const meta = buildProspectMeta(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setDetailOpen(true);
                    }}
                    className={cn(
                      'grid min-w-0 gap-3 rounded-[22px] border px-3.5 py-3 text-left transition-[border-color,box-shadow,transform,background-color] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)_auto_auto] xl:items-center',
                      active
                        ? 'border-emerald-300 bg-[linear-gradient(135deg,rgba(237,252,245,0.98)_0%,rgba(255,255,255,0.98)_55%,rgba(240,253,250,0.95)_100%)] shadow-[0_22px_40px_rgba(16,185,129,0.14)] ring-1 ring-emerald-100'
                        : 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_100%)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_32px_rgba(15,23,42,0.08)]'
                    )}
                  >
                    <div className="grid min-w-0 gap-2 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center">
                      <div className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-xl border text-xs font-bold tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] md:h-11 md:w-11 md:text-sm',
                        active ? 'border-emerald-200 bg-white text-emerald-800' : 'border-slate-200 bg-white text-slate-600'
                      )}>
                        {getProspectInitials(item.company_name) || 'P'}
                      </div>

                      <div className="grid min-w-0 gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <strong className="break-words text-[15px] font-bold tracking-[-0.03em] text-slate-950 md:text-base">{item.company_name}</strong>
                          <span className={cn('w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', statusClass[item.status])}>
                            {statusLabel[item.status]}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 md:text-xs">
                          {meta.length > 0 ? meta.map((label) => <span key={label} className="break-words">{label}</span>) : <span>Ingen metadata än</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap gap-1.5 text-[11px] text-slate-600 md:text-xs xl:justify-start">
                      {item.phone ? <span className="break-words rounded-full border border-slate-200/90 bg-white/90 px-2 py-1 shadow-[0_4px_10px_rgba(15,23,42,0.03)]">{item.phone}</span> : null}
                      {item.email ? <span className="break-words rounded-full border border-slate-200/90 bg-white/90 px-2 py-1 shadow-[0_4px_10px_rgba(15,23,42,0.03)]">{item.email}</span> : null}
                      {item.organization_number ? <span className="break-words rounded-full border border-slate-200/90 bg-white/90 px-2 py-1 shadow-[0_4px_10px_rgba(15,23,42,0.03)]">Org.nr: {item.organization_number}</span> : null}
                    </div>

                    <div className="grid gap-1 text-[11px] text-slate-500 xl:justify-items-end">
                      <span className="font-medium text-slate-400 md:text-xs">Uppdaterad {formatDateTime(item.updated_at)}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Öppna detalj</span>
                    </div>
                  </button>
                );
              })
            )}
            </div>
          </div>
        </SectionCard>
      {createPanelOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setCreatePanelOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Skapa prospekt"
            onClick={(event) => event.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Skapa prospekt</span>
                <strong className="text-[1.6rem] font-bold tracking-[-0.05em] text-slate-950">Lägg in första datan</strong>
                <p className="m-0 max-w-2xl text-sm leading-6 text-slate-600">
                  Registrera ett nytt prospekt utan att låsa hela arbetsytan. Stäng rutan när du är klar och fortsätt direkt i listan.
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

            <div className="grid gap-3 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <Input value={draft.company_name} onChange={(event) => setDraft((current) => ({ ...current, company_name: event.target.value }))} placeholder="Företagsnamn" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={draft.contact_name} onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Kontaktperson" />
                <Input value={draft.organization_number} onChange={(event) => setDraft((current) => ({ ...current, organization_number: event.target.value }))} placeholder="Org.nr" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
                <Input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="E-post" type="email" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
                <Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa, t.ex. Excel eller manuell" />
              </div>
              <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Anteckning eller sammanhang" className="min-h-[132px]" />
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
                  onClick={createProspect}
                  disabled={creating}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? 'Sparar…' : 'Skapa prospekt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailOpen && selected ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setDetailOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Prospekt ${selected.company_name}`}
            onClick={(event) => event.stopPropagation()}
            className="grid w-full max-w-[860px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Detaljvy</span>
                <strong className="text-[1.6rem] font-bold tracking-[-0.05em] text-slate-950">{selected.company_name}</strong>
                <p className="m-0 text-sm text-slate-500">Skapad {formatDateTime(selected.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass[selected.status])}>
                  {statusLabel[selected.status]}
                </span>
                <button
                  type="button"
                  onClick={() => setDetailEditing((current) => !current)}
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  {detailEditing ? 'Avsluta redigering' : 'Redigera'}
                </button>
                <a
                  href={`/crm/samtal?prospect_id=${selected.id}`}
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.18)] transition hover:brightness-[0.97]"
                >
                  Logga samtal
                </a>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f9fbfc_100%)] p-4 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ecfdf5_0%,#d9fbe8_100%)] text-base font-bold tracking-[0.08em] text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                  {getProspectInitials(selected.company_name) || 'P'}
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="grid min-w-0 gap-1">
                      <strong className="break-words text-xl font-bold tracking-[-0.03em] text-slate-950">{selected.company_name}</strong>
                      <span className="text-sm text-slate-500">Uppdaterad {formatDateTime(selected.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    {selectedMeta.length > 0 ? selectedMeta.map((label) => <span key={label} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-[0_6px_14px_rgba(15,23,42,0.04)]">{label}</span>) : null}
                  </div>
                </div>
              </div>

              {detailEditing ? (
                <div className="grid gap-3">
                  <Input value={detailDraft.company_name} onChange={(event) => setDetailDraft((current) => ({ ...current, company_name: event.target.value }))} placeholder="Företagsnamn" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input value={detailDraft.contact_name} onChange={(event) => setDetailDraft((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Kontaktperson" />
                    <Input value={detailDraft.organization_number} onChange={(event) => setDetailDraft((current) => ({ ...current, organization_number: event.target.value }))} placeholder="Org.nr" />
                    <Input value={detailDraft.phone} onChange={(event) => setDetailDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
                    <Input value={detailDraft.email} onChange={(event) => setDetailDraft((current) => ({ ...current, email: event.target.value }))} placeholder="E-post" type="email" />
                    <Input value={detailDraft.city} onChange={(event) => setDetailDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
                    <Input value={detailDraft.source} onChange={(event) => setDetailDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa" />
                    <Input value={detailDraft.street_address} onChange={(event) => setDetailDraft((current) => ({ ...current, street_address: event.target.value }))} placeholder="Adress" />
                    <Input value={detailDraft.postal_code} onChange={(event) => setDetailDraft((current) => ({ ...current, postal_code: event.target.value }))} placeholder="Postnummer" />
                  </div>
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
                    <select
                      value={detailDraft.status}
                      onChange={(event) => setDetailDraft((current) => ({ ...current, status: event.target.value as ProspectItem['status'] }))}
                      className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                    >
                      {Object.entries(statusLabel).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <Textarea value={detailDraft.notes} onChange={(event) => setDetailDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Anteckningar" className="min-h-[132px]" />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selected) return;
                        setDetailEditing(false);
                        setDetailDraft({
                          company_name: selected.company_name,
                          organization_number: selected.organization_number || '',
                          contact_name: selected.contact_name || '',
                          phone: selected.phone || '',
                          email: selected.email || '',
                          street_address: selected.street_address || '',
                          postal_code: selected.postal_code || '',
                          city: selected.city || '',
                          source: selected.source || '',
                          notes: selected.notes || '',
                          status: selected.status,
                        });
                      }}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={saveProspectDetail}
                      disabled={savingDetail}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingDetail ? 'Sparar…' : 'Spara ändringar'}
                    </button>
                  </div>
                </div>
              ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Kontakt</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.contact_name || '–'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Org.nr</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.organization_number || '–'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Telefon</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.phone || '–'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">E-post</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.email || '–'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Ort</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.city || '–'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Källa</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-900">{selected.source || '–'}</div>
                </div>
              </div>
              )}
            </div>

            <div className="grid gap-2 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)]">
              <strong className="text-sm font-semibold text-slate-900">Anteckningar</strong>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {detailEditing ? (detailDraft.notes || 'Inga anteckningar än.') : (selected.notes || 'Inga anteckningar än.')}
              </p>
            </div>

            <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf2_100%)] px-4 py-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm font-semibold text-slate-900">Offerter på prospektet</strong>
                <a
                  href="/crm/offerter"
                  className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-amber-500 bg-[linear-gradient(180deg,#f59e0b_0%,#d97706_100%)] px-3 py-2 text-xs font-semibold text-white shadow-[0_14px_24px_rgba(217,119,6,0.18)] transition hover:brightness-[0.97]"
                >
                  Öppna offerter
                </a>
              </div>
              {relatedQuotesLoading ? (
                <div className="grid gap-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="h-3 w-32 rounded-full bg-slate-200" />
                      <div className="h-3 w-48 rounded-full bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : relatedQuotes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Inga offerter registrerade ännu för det här prospektet.
                </div>
              ) : (
                <div className="grid gap-2">
                  {relatedQuotes.map((quote) => (
                    <div key={quote.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4">
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

            <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-4 py-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm font-semibold text-slate-900">Samtal på prospektet</strong>
                <a
                  href={`/crm/samtal?prospect_id=${selected.id}`}
                  className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-3 py-2 text-xs font-semibold text-white shadow-[0_14px_24px_rgba(2,132,199,0.18)] transition hover:brightness-[0.97]"
                >
                  Logga nytt samtal
                </a>
              </div>
              {relatedCallsLoading ? (
                <div className="grid gap-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="h-3 w-32 rounded-full bg-slate-200" />
                      <div className="h-3 w-48 rounded-full bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : relatedCalls.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Inga samtal loggade ännu för det här prospektet.
                </div>
              ) : (
                <div className="grid gap-2">
                  {relatedCalls.map((call) => (
                    <div key={call.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{callOutcomeLabel[call.outcome]}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(call.call_at)}</span>
                      </div>
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{call.summary}</p>
                      {call.next_step ? <span className="text-xs text-slate-500">Nästa steg: {call.next_step}</span> : null}
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