"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
import CrmModal from '../components/CrmModal';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm, customerStageLabel as stageLabel, customerStageClass as stageClass } from '@/app/crm/lib/crmTokens';

type EntitySearchResult = {
  id: string;
  customer_stage: 'prospect' | 'customer' | 'fortnox_customer';
  customer_type: 'business' | 'private';
  display_name: string;
  organization_number: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  city: string | null;
};

type LinkedCustomer = {
  id: string;
  customer_stage: string;
  customer_type: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_number: string | null;
  contacts: Array<{ name: string; phone: string | null; email: string | null; is_primary: boolean }>;
};

type CallItem = {
  id: string;
  prospect_id: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  company_name: string | null;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  user_id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at: string;
  created_at: string;
  prospect: { id: string; company_name: string; contact_name: string | null; phone: string | null; email: string | null; city: string | null; source: string | null; status: string } | Array<{ id: string; company_name: string; contact_name: string | null; phone: string | null; email: string | null; city: string | null; source: string | null; status: string }> | null;
  customer: LinkedCustomer | null;
};

type CallDraft = {
  customer_id: string | null;
  opportunity_id: string;
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  outcome: CallItem['outcome'];
  summary: string;
  next_step: string;
};

const outcomeMeta: Record<CallItem['outcome'], { label: string; className: string; helper: string }> = {
  no_answer: {
    label: 'Ej svar',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
    helper: 'Ingen kontakt, försök igen senare.',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    helper: 'Kontakt fanns, men behöver nytt steg.',
  },
  positive: {
    label: 'Positivt',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    helper: 'Bra signal eller tydligt nästa steg.',
  },
  negative: {
    label: 'Negativt',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
    helper: 'Inte rätt timing eller tydligt nej.',
  },
};

// Solid accent per outcome — used as a left rail on list rows for quick scanning.
const outcomeAccent: Record<CallItem['outcome'], string> = {
  no_answer: 'bg-slate-300',
  follow_up: 'bg-amber-400',
  positive: 'bg-emerald-500',
  negative: 'bg-rose-400',
};


const initialDraft: CallDraft = {
  customer_id: null,
  opportunity_id: '',
  company_name: '',
  organization_number: '',
  contact_name: '',
  phone: '',
  email: '',
  city: '',
  source: '',
  outcome: 'follow_up',
  summary: '',
  next_step: '',
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getLinkedEntityFromCall(item: CallItem): { company_name: string | null; contact_name: string | null; phone: string | null; email: string | null; city: string | null; source: string | null; stage?: string } | null {
  if (item.customer) {
    const c = item.customer;
    const primary = Array.isArray(c.contacts) ? (c.contacts.find((ct) => ct.is_primary) || c.contacts[0]) : null;
    const name = c.customer_type === 'business' ? c.company_name : [c.first_name, c.last_name].filter(Boolean).join(' ');
    return { company_name: name || null, contact_name: primary?.name ?? null, phone: primary?.phone ?? null, email: primary?.email ?? null, city: null, source: null, stage: c.customer_stage };
  }
  if (item.prospect) {
    const p = Array.isArray(item.prospect) ? item.prospect[0] : item.prospect;
    return p ? { company_name: p.company_name, contact_name: p.contact_name, phone: p.phone, email: p.email, city: p.city, source: p.source } : null;
  }
  return null;
}

function getCallCompanyName(item: CallItem) {
  const linked = getLinkedEntityFromCall(item);
  return linked?.company_name || item.company_name || 'Fristående samtal';
}

function buildCallMeta(item: CallItem) {
  const linked = getLinkedEntityFromCall(item);
  return [
    linked?.contact_name || item.contact_name ? `Kontakt: ${linked?.contact_name || item.contact_name}` : null,
    linked?.phone || item.phone ? `Telefon: ${linked?.phone || item.phone}` : null,
    linked?.email || item.email ? `E-post: ${linked?.email || item.email}` : null,
    linked?.city || item.city ? `Ort: ${linked?.city || item.city}` : null,
  ].filter(Boolean) as string[];
}

function isStandaloneCall(item: CallItem) {
  return !item.customer && !item.prospect;
}

export default function CallsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [opportunities, setOpportunities] = useState<Array<{ id: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [promotingCallIds, setPromotingCallIds] = useState<string[]>([]);
  const [promotedCallIds, setPromotedCallIds] = useState<string[]>([]);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState<CallDraft>(initialDraft);

  // Entity search state
  const [entityQuery, setEntityQuery] = useState('');
  const [entityResults, setEntityResults] = useState<EntitySearchResult[]>([]);
  const [entitySearching, setEntitySearching] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<EntitySearchResult | null>(null);
  const [entityDropdownOpen, setEntityDropdownOpen] = useState(false);
  const entitySearchRef = useRef<HTMLDivElement>(null);
  const entityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [callsRes, oppsRes] = await Promise.all([
          fetch(`/api/crm/calls${historySearch.trim() ? `?q=${encodeURIComponent(historySearch.trim())}` : ''}`, { cache: 'no-store' }),
          fetch('/api/crm/opportunities', { cache: 'no-store' }),
        ]);
        const [callsJson, oppsJson] = await Promise.all([
          callsRes.json().catch(() => ({})),
          oppsRes.json().catch(() => ({})),
        ]);
        if (!active) return;
        if (!callsRes.ok || !callsJson.ok) {
          setError(callsJson?.error || 'Kunde inte ladda samtalshistorik.');
          setCalls([]);
          return;
        }
        setCalls(Array.isArray(callsJson?.data?.items) ? callsJson.data.items : []);
        setOpportunities(Array.isArray(oppsJson?.data?.items) ? oppsJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda samtalsytan.');
        setCalls([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [historySearch]);

  useEffect(() => {
    if (!logOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [logOpen]);

  // Pre-fill from URL param (customer_id or legacy prospect_id)
  useEffect(() => {
    const customerId = searchParams.get('customer_id');
    if (!customerId || !logOpen) return;
    setDraft((c) => ({ ...c, customer_id: customerId }));
  }, [searchParams, logOpen]);

  // Entity search debounce
  useEffect(() => {
    if (!logOpen) return;
    if (!entityQuery.trim()) {
      setEntityResults([]);
      setEntityDropdownOpen(false);
      return;
    }
    if (entityDebounceRef.current) clearTimeout(entityDebounceRef.current);
    entityDebounceRef.current = setTimeout(async () => {
      setEntitySearching(true);
      try {
        const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(entityQuery.trim())}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          setEntityResults(Array.isArray(json.data?.items) ? json.data.items : []);
          setEntityDropdownOpen(true);
        }
      } catch {
        // ignore
      } finally {
        setEntitySearching(false);
      }
    }, 280);
    return () => { if (entityDebounceRef.current) clearTimeout(entityDebounceRef.current); };
  }, [entityQuery, logOpen]);

  // Close entity dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (entitySearchRef.current && !entitySearchRef.current.contains(e.target as Node)) {
        setEntityDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const stats = useMemo(() => ({
    logged: calls.length,
    followUp: calls.filter((item) => item.outcome === 'follow_up').length,
    standalone: calls.filter((item) => isStandaloneCall(item)).length,
    linked: calls.filter((item) => !isStandaloneCall(item)).length,
  }), [calls]);

  function selectEntity(entity: EntitySearchResult) {
    setSelectedEntity(entity);
    setDraft((c) => ({ ...c, customer_id: entity.id, company_name: '', organization_number: '', contact_name: '', phone: '', email: '', city: '' }));
    setEntityQuery('');
    setEntityDropdownOpen(false);
    setEntityResults([]);
  }

  function clearEntity() {
    setSelectedEntity(null);
    setDraft((c) => ({ ...c, customer_id: null }));
  }

  function openLogModal(entity?: EntitySearchResult) {
    setEditingCallId(null);
    setSelectedEntity(entity || null);
    setDraft({ ...initialDraft, customer_id: entity?.id || null });
    setEntityQuery('');
    setEntityResults([]);
    setLogOpen(true);
  }

  function openEditCallModal(call: CallItem) {
    setEditingCallId(call.id);
    const linked = getLinkedEntityFromCall(call);
    setSelectedEntity(
      call.customer
        ? {
            id: call.customer.id,
            customer_stage: call.customer.customer_stage as EntitySearchResult['customer_stage'],
            customer_type: call.customer.customer_type as EntitySearchResult['customer_type'],
            display_name: linked?.company_name || 'Okänd',
            organization_number: call.customer.organization_number ?? null,
            primary_contact_name: linked?.contact_name ?? null,
            primary_contact_phone: linked?.phone ?? null,
            city: linked?.city ?? null,
          }
        : null
    );
    setDraft({
      customer_id: call.customer_id ?? null,
      opportunity_id: call.opportunity_id || '',
      company_name: call.company_name || '',
      organization_number: call.organization_number || '',
      contact_name: call.contact_name || '',
      phone: call.phone || '',
      email: call.email || '',
      city: call.city || '',
      source: call.source || '',
      outcome: call.outcome,
      summary: call.summary,
      next_step: call.next_step || '',
    });
    setEntityQuery('');
    setEntityResults([]);
    setLogOpen(true);
  }

  async function submitCall() {
    if (!draft.summary.trim()) { toast.error('Samtalsanteckning krävs'); return; }
    if (!draft.customer_id && !draft.opportunity_id && !draft.company_name.trim()) {
      toast.error('Välj en kund/prospekt eller fyll i företagsnamn');
      return;
    }
    setSubmitting(true);
    try {
      const isEditing = Boolean(editingCallId);
      const body: Record<string, unknown> = {
        customer_id: draft.customer_id || null,
        opportunity_id: draft.opportunity_id || null,
        outcome: draft.outcome,
        summary: draft.summary,
        next_step: draft.next_step || null,
      };
      if (!draft.customer_id) {
        body.company_name = draft.company_name || null;
        body.organization_number = draft.organization_number || null;
        body.contact_name = draft.contact_name || null;
        body.phone = draft.phone || null;
        body.email = draft.email || null;
        body.city = draft.city || null;
        body.source = draft.source || null;
      }
      const res = await fetch(isEditing ? `/api/crm/calls/${editingCallId}` : '/api/crm/calls', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte logga samtal'); return; }
      const item = json?.data?.item as CallItem | undefined;
      if (item) {
        setCalls((current) => isEditing
          ? current.map((e) => e.id === item.id ? item : e)
          : [item, ...current].slice(0, 50)
        );
      }
      setLogOpen(false);
      setEditingCallId(null);
      setDraft(initialDraft);
      setSelectedEntity(null);
      toast.success(isEditing ? 'Samtal uppdaterat' : 'Samtal loggat');
    } catch {
      toast.error(editingCallId ? 'Fel vid uppdatering av samtal' : 'Fel vid loggning av samtal');
    } finally {
      setSubmitting(false);
    }
  }

  async function promoteCallToCustomer(call: CallItem) {
    if (!isStandaloneCall(call)) return;
    if (!call.company_name?.trim()) { toast.error('Företagsnamn krävs för att skapa prospekt'); return; }
    setPromotingCallIds((c) => [...c, call.id]);
    try {
      const res = await fetch('/api/crm/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_type: 'business',
          customer_stage: 'prospect',
          company_name: call.company_name,
          organization_number: call.organization_number || null,
          notes: [
            `Skapat från fristående samtal ${formatDateTime(call.call_at)}.`,
            call.summary.trim() ? `Samtalsanteckning: ${call.summary.trim()}` : null,
            call.next_step?.trim() ? `Nästa steg: ${call.next_step.trim()}` : null,
          ].filter(Boolean).join('\n'),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa prospekt från samtalet'); return; }
      const customer = json?.data?.item as { id: string } | undefined;
      if (customer) {
        const attachRes = await fetch(`/api/crm/calls/${call.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: customer.id,
            company_name: call.company_name,
            organization_number: call.organization_number,
            contact_name: call.contact_name,
            phone: call.phone,
            email: call.email,
            city: call.city,
            source: call.source,
            outcome: call.outcome,
            summary: call.summary,
            next_step: call.next_step,
            call_at: call.call_at,
          }),
        });
        const attachJson = await attachRes.json().catch(() => ({}));
        if (!attachRes.ok || !attachJson.ok) { toast.error('Prospekt skapades men kunde inte kopplas till samtalet'); return; }
        const updatedCall = attachJson?.data?.item as CallItem | undefined;
        if (updatedCall) setCalls((c) => c.map((e) => e.id === updatedCall.id ? updatedCall : e));
      }
      setPromotedCallIds((c) => [...c, call.id]);
      toast.success('Prospekt skapat från samtalet');
    } catch {
      toast.error('Fel vid skapande av prospekt');
    } finally {
      setPromotingCallIds((c) => c.filter((id) => id !== call.id));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Samtal</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Här kan du boka in och följa upp samtalsaktiviteter med dina prospekt och kunder</p>
        </div>
        <button
          type="button"
          onClick={() => openLogModal()}
          className="inline-flex items-center rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Logga samtal
        </button>
      </div>

      <div className="hidden gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Loggade samtal" value={stats.logged} helper="Senaste samtalen i historiken" />
        <MetricCard label="Kräver uppföljning" value={stats.followUp} helper="Utfall som kräver nytt steg" />
        <MetricCard label="Fristående kontakter" value={stats.standalone} helper="Kan lyftas till prospekt" />
        <MetricCard label="Kopplade samtal" value={stats.linked} helper="Samtal med länkad kund/prospekt" />
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="m-0 text-base font-bold text-slate-900">Samtalsaktiviteter</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">Alla loggade samtal och uppföljningar</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{calls.length} loggade</span>
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Sök samtal…"
                className="w-48"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-1.5 p-2.5">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-[#e3e9df] bg-[#f6f9f3] px-4 py-4">
                <div className="h-7 w-7 animate-pulse rounded-full bg-[#dfe6da]" />
                <div className="flex-1 grid gap-2">
                  <div className="h-3 w-40 animate-pulse rounded-full bg-[#dfe6da]" />
                  <div className="h-3 w-24 animate-pulse rounded-full bg-[#dfe6da]" />
                </div>
              </div>
            ))
          ) : calls.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              Inga samtal loggade ännu. Logga det första samtalet med knappen ovan.
            </div>
          ) : (
            calls.map((call) => {
              const meta = buildCallMeta(call);
              const standalone = isStandaloneCall(call);
              const promoting = promotingCallIds.includes(call.id);
              const promoted = promotedCallIds.includes(call.id);
              const linked = getLinkedEntityFromCall(call);
              return (
                <article key={call.id} className="relative grid gap-2 overflow-hidden rounded-lg border border-[#e3e9df] bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] md:grid-cols-[minmax(0,1fr)_200px] md:items-start">
                  <span className={cn('absolute inset-y-0 left-0 w-1.5', outcomeAccent[call.outcome])} aria-hidden="true" />
                  <div className="grid min-w-0 gap-1.5 pl-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                        </svg>
                      </div>
                      <div className="grid gap-0">
                        <strong className="text-[13px] font-semibold text-slate-900">{getCallCompanyName(call)}</strong>
                        {linked?.contact_name || call.contact_name ? (
                          <span className="text-[11px] text-slate-500">{linked?.contact_name || call.contact_name}</span>
                        ) : null}
                      </div>
                      {standalone ? <span className={cn(crm.badge, 'border-sky-200 bg-sky-50 text-sky-700')}>Lead</span> : null}
                      {linked?.stage ? (
                        <span className={cn(crm.badge, stageClass[linked.stage as keyof typeof stageClass] || 'border-slate-200 bg-slate-50 text-slate-600')}>
                          {stageLabel[linked.stage as keyof typeof stageLabel] || linked.stage}
                        </span>
                      ) : null}
                      <span className={cn(crm.badge, outcomeMeta[call.outcome].className)}>
                        {outcomeMeta[call.outcome].label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>{formatDateTime(call.call_at)}</span>
                      {call.next_step ? <span>· Nästa steg: {call.next_step}</span> : null}
                    </div>
                    {call.summary ? <p className="m-0 text-[13px] leading-5 text-slate-700">{call.summary}</p> : null}
                    {meta.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {meta.map((m) => (
                          <span key={m} className={cn(crm.badge, standalone ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => openEditCallModal(call)}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      Redigera samtal
                    </button>
                    {standalone && !promoted ? (
                      <button
                        type="button"
                        onClick={() => promoteCallToCustomer(call)}
                        disabled={promoting}
                        className={cn(
                          'inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold text-white transition',
                          promoting ? 'cursor-wait opacity-70' : '',
                        )}
                        style={{ backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' }}
                      >
                        {promoting ? 'Skapar…' : 'Skapa prospekt'}
                      </button>
                    ) : promoted ? (
                      <button
                        type="button"
                        onClick={() => router.push('/crm/kunder?stage=prospect')}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
                      >
                        Prospekt skapat
                      </button>
                    ) : call.customer_id ? (
                      <button
                        type="button"
                        onClick={() => router.push('/crm/kunder')}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        Öppna kund
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      {logOpen ? (
        <CrmModal
          onClose={() => { setLogOpen(false); setEditingCallId(null); setDraft(initialDraft); setSelectedEntity(null); setEntityQuery(''); }}
          ariaLabel="Logga samtal"
          maxWidth="sm:max-w-[760px]"
          header={
            <>
              <strong className="block truncate text-lg font-bold tracking-tight text-slate-900">
                {selectedEntity?.display_name || draft.company_name || 'Nytt samtal'}
              </strong>
              <p className="m-0 mt-0.5 text-sm text-slate-500">
                {editingCallId ? 'Justera uppgifter eller utfall.' : 'Registrera utfallet direkt efter samtalet.'}
              </p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => { setLogOpen(false); setEditingCallId(null); setDraft(initialDraft); setSelectedEntity(null); setEntityQuery(''); }}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={submitCall}
                disabled={submitting}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {submitting ? 'Sparar…' : editingCallId ? 'Spara ändringar' : 'Logga samtal'}
              </button>
            </>
          }
        >
            <div className="grid gap-4">
              {/* Entity search */}
              <div className="grid gap-2">
                <span className={crm.sectionTitle}>Kund eller prospekt</span>
                {selectedEntity ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <div className="grid gap-0.5">
                      <span className="text-sm font-semibold text-slate-900">{selectedEntity.display_name}</span>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={cn(crm.badge, stageClass[selectedEntity.customer_stage] || 'border-slate-200 bg-slate-50 text-slate-600')}>
                          {stageLabel[selectedEntity.customer_stage] || selectedEntity.customer_stage}
                        </span>
                        {selectedEntity.organization_number ? <span className="text-[11px] text-slate-500">{selectedEntity.organization_number}</span> : null}
                      </div>
                    </div>
                    <button type="button" onClick={clearEntity} className="text-xs font-semibold text-slate-500 hover:text-rose-600">
                      Ändra
                    </button>
                  </div>
                ) : (
                  <div ref={entitySearchRef} className="relative">
                    <Input
                      value={entityQuery}
                      onChange={(e) => setEntityQuery(e.target.value)}
                      placeholder="Sök på namn, org-nr eller personnr…"
                      autoComplete="off"
                    />
                    {entitySearching ? (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Söker…</div>
                    ) : null}
                    {entityDropdownOpen && entityResults.length > 0 ? (
                      <div className="absolute left-0 right-0 top-full z-10 mt-1 grid gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
                        {entityResults.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => selectEntity(e)}
                            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-slate-50"
                          >
                            <div className="grid gap-0.5">
                              <span className="text-sm font-semibold text-slate-900">{e.display_name}</span>
                              <span className="text-xs text-slate-500">
                                {[e.organization_number, e.primary_contact_name, e.city].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                            <span className={cn('shrink-0', crm.badge, stageClass[e.customer_stage] || 'border-slate-200 bg-slate-50 text-slate-600')}>
                              {stageLabel[e.customer_stage] || e.customer_stage}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : entityDropdownOpen && !entitySearching && entityQuery.trim() ? (
                      <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
                        <p className="text-sm text-slate-500">Ingen träff — fyll i uppgifterna manuellt nedan.</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Affärsmöjlighet */}
              <label className="grid gap-1 text-sm text-slate-600">
                <span className={crm.sectionTitle}>Affärsmöjlighet (valfritt)</span>
                <select
                  value={draft.opportunity_id}
                  onChange={(e) => setDraft((c) => ({ ...c, opportunity_id: e.target.value }))}
                  className="min-h-11 w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">Ingen affärsmöjlighet</option>
                  {opportunities.map((opp) => (
                    <option key={opp.id} value={opp.id}>{opp.title}</option>
                  ))}
                </select>
              </label>

              {/* Manuell inmatning — visas om ingen kund/prospekt är vald */}
              {!draft.customer_id ? (
                <div className="grid gap-3 rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4">
                  <div className="grid gap-1">
                    <span className={crm.sectionTitle}>Ny kontakt</span>
                    <p className="m-0 text-sm leading-6 text-slate-600">
                      Hittades ingen kund ovan? Fyll i uppgifterna — du kan lyfta kontakten till prospekt efter samtalet.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={draft.company_name} onChange={(e) => setDraft((c) => ({ ...c, company_name: e.target.value }))} placeholder="Företagsnamn *" />
                    <Input value={draft.organization_number} onChange={(e) => setDraft((c) => ({ ...c, organization_number: e.target.value }))} placeholder="Organisationsnummer" />
                    <Input value={draft.contact_name} onChange={(e) => setDraft((c) => ({ ...c, contact_name: e.target.value }))} placeholder="Kontaktperson" />
                    <Input value={draft.phone} onChange={(e) => setDraft((c) => ({ ...c, phone: e.target.value }))} placeholder="Telefon" />
                    <Input value={draft.email} onChange={(e) => setDraft((c) => ({ ...c, email: e.target.value }))} placeholder="E-post" />
                    <Input value={draft.city} onChange={(e) => setDraft((c) => ({ ...c, city: e.target.value }))} placeholder="Ort" />
                    <div className="md:col-span-2">
                      <Input value={draft.source} onChange={(e) => setDraft((c) => ({ ...c, source: e.target.value }))} placeholder="Källa, t.ex. inbound, mässa eller rekommendation" />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Utfall */}
              <div className="grid gap-2">
                <span className={crm.sectionTitle}>Utfall</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(outcomeMeta).map(([key, meta]) => {
                    const outcome = key as CallItem['outcome'];
                    const active = draft.outcome === outcome;
                    return (
                      <button
                        key={outcome}
                        type="button"
                        onClick={() => setDraft((c) => ({ ...c, outcome }))}
                        className={cn(
                          'grid gap-1 rounded-2xl border px-4 py-3 text-left transition',
                          active ? meta.className : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        )}
                      >
                        <strong className="text-sm font-semibold">{meta.label}</strong>
                        <span className="text-xs leading-5 opacity-80">{meta.helper}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Textarea
                value={draft.summary}
                onChange={(e) => setDraft((c) => ({ ...c, summary: e.target.value }))}
                placeholder="Vad hände i samtalet? Vad sa kunden?"
                className="min-h-[120px]"
              />

              <Input
                value={draft.next_step}
                onChange={(e) => setDraft((c) => ({ ...c, next_step: e.target.value }))}
                placeholder="Nästa steg, t.ex. ring igen torsdag eller skicka offert"
              />
            </div>
        </CrmModal>
      ) : null}
    </div>
  );
}
