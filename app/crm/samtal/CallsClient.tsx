"use client";

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SectionCard from '../../../components/ui/SectionCard';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type ProspectItem = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
};

type CallItem = {
  id: string;
  prospect_id: string | null;
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
  prospect: ProspectItem | ProspectItem[] | null;
};

type CallDraft = {
  prospect_id: string;
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

const initialDraft: CallDraft = {
  prospect_id: '',
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

function getProspectFromCall(item: CallItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getCallCompanyName(item: CallItem) {
  return getProspectFromCall(item)?.company_name || item.company_name || 'Fristående samtal';
}

function buildCallMeta(item: CallItem) {
  const prospect = getProspectFromCall(item);

  return [
    prospect?.contact_name || item.contact_name ? `Kontakt: ${prospect?.contact_name || item.contact_name}` : null,
    prospect?.phone || item.phone ? `Telefon: ${prospect?.phone || item.phone}` : null,
    prospect?.email || item.email ? `E-post: ${prospect?.email || item.email}` : null,
    prospect?.city || item.city ? `Ort: ${prospect?.city || item.city}` : null,
    prospect?.source || item.source ? `Källa: ${prospect?.source || item.source}` : null,
  ].filter(Boolean) as string[];
}

function isStandaloneCall(item: CallItem) {
  return !getProspectFromCall(item);
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export default function CallsClient() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [promotingCallIds, setPromotingCallIds] = useState<string[]>([]);
  const [promotedCallIds, setPromotedCallIds] = useState<string[]>([]);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [prefilledProspectId, setPrefilledProspectId] = useState<string | null>(null);
  const [queueSearch, setQueueSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState<CallDraft>(initialDraft);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [prospectsRes, callsRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch(`/api/crm/calls${historySearch.trim() ? `?q=${encodeURIComponent(historySearch.trim())}` : ''}`, { cache: 'no-store' }),
        ]);

        const [prospectsJson, callsJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          callsRes.json().catch(() => ({})),
        ]);

        if (!active) return;

        if (!prospectsRes.ok || !prospectsJson.ok) {
          setError(prospectsJson?.error || 'Kunde inte ladda prospekt för samtal.');
          setProspects([]);
          setCalls([]);
          return;
        }

        if (!callsRes.ok || !callsJson.ok) {
          setError(callsJson?.error || 'Kunde inte ladda samtalshistorik.');
          setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
          setCalls([]);
          return;
        }

        setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
        setCalls(Array.isArray(callsJson?.data?.items) ? callsJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda samtalsytan.');
        setProspects([]);
        setCalls([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [historySearch]);

  useEffect(() => {
    if (!logOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [logOpen]);

  useEffect(() => {
    const prospectId = searchParams.get('prospect_id');
    if (!prospectId || prefilledProspectId === prospectId || prospects.length === 0) return;

    const prospect = prospects.find((item) => item.id === prospectId);
    if (!prospect) return;

    openLogModal(prospect);
    setPrefilledProspectId(prospectId);
  }, [prefilledProspectId, prospects, searchParams]);

  const visibleProspects = useMemo(() => {
    const search = queueSearch.trim().toLowerCase();
    if (!search) return prospects;

    return prospects.filter((item) => {
      return [item.company_name, item.contact_name, item.phone, item.email, item.city]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [prospects, queueSearch]);

  function openLogModal(prospect: ProspectItem) {
    setEditingCallId(null);
    setDraft({
      prospect_id: prospect.id,
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
    });
    setLogOpen(true);
  }

  function openStandaloneLogModal() {
    setEditingCallId(null);
    setDraft({
      prospect_id: '',
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
    });
    setLogOpen(true);
  }

  function openEditCallModal(call: CallItem) {
    const prospect = getProspectFromCall(call);
    setEditingCallId(call.id);
    setDraft({
      prospect_id: prospect?.id || call.prospect_id || '',
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
    setLogOpen(true);
  }

  async function submitCall() {
    if (!draft.summary.trim()) {
      toast.error('Samtalsanteckning krävs');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = Boolean(editingCallId);
      const res = await fetch(isEditing ? `/api/crm/calls/${editingCallId}` : '/api/crm/calls', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte logga samtal');
        return;
      }

      const item = json?.data?.item as CallItem | undefined;
      if (item) {
        setCalls((current) => {
          if (isEditing) {
            return current.map((entry) => (entry.id === item.id ? item : entry));
          }

          return [item, ...current].slice(0, 50);
        });
      }

      setLogOpen(false);
      setEditingCallId(null);
      setDraft(initialDraft);
      toast.success(isEditing ? 'Samtal uppdaterat' : 'Samtal loggat');
    } catch {
      toast.error(editingCallId ? 'Fel vid uppdatering av samtal' : 'Fel vid loggning av samtal');
    } finally {
      setSubmitting(false);
    }
  }

  async function promoteCallToProspect(call: CallItem) {
    if (!isStandaloneCall(call)) return;
    if (!call.company_name?.trim()) {
      toast.error('Företagsnamn krävs för att skapa prospekt');
      return;
    }

    setPromotingCallIds((current) => [...current, call.id]);

    try {
      const noteParts = [
        `Skapat från fristående samtal ${formatDateTime(call.call_at)}.`,
        call.summary.trim() ? `Samtalsanteckning: ${call.summary.trim()}` : null,
        call.next_step?.trim() ? `Nästa steg: ${call.next_step.trim()}` : null,
      ].filter(Boolean);

      const res = await fetch('/api/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: call.company_name,
          organization_number: call.organization_number,
          contact_name: call.contact_name,
          phone: call.phone,
          email: call.email,
          city: call.city,
          source: call.source || 'Samtal',
          notes: noteParts.join('\n'),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skapa prospekt från samtalet');
        return;
      }

      const item = json?.data?.item as ProspectItem | undefined;
      if (item) {
        setProspects((current) => [item, ...current.filter((prospect) => prospect.id !== item.id)]);
      }

      setPromotedCallIds((current) => [...current, call.id]);
      toast.success('Prospekt skapat från samtalet');
    } catch {
      toast.error('Fel vid skapande av prospekt');
    } finally {
      setPromotingCallIds((current) => current.filter((id) => id !== call.id));
    }
  }

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_24%),linear-gradient(180deg,#fbfeff_0%,#f4f8fb_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Samtal
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">Samtal</h1>
                  <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">
                    {prospects.length} prospekt i kö
                  </div>
                  <button
                    type="button"
                    onClick={openStandaloneLogModal}
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97]"
                  >
                    Logga nytt samtal
                  </button>
                </div>
                <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                  Ringlistan ska vara snabb att skanna. Öppna ett prospekt, logga utfallet direkt eller registrera ett fristående samtal när det inte ännu finns något kopplat prospekt.
                </p>
              </div>
            </div>

            <div className="grid gap-2 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/80">Snapshot</span>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Kö</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{visibleProspects.length}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Loggade</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{calls.length}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Senast</div>
                  <div className="mt-1 truncate text-sm font-semibold text-white">{calls[0] ? getCallCompanyName(calls[0]) : 'Ingen logg än'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-white/70 bg-white/75 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)] backdrop-blur lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <Input
              value={queueSearch}
              onChange={(event) => setQueueSearch(event.target.value)}
              placeholder="Sök i ringlistan på företag, kontakt, telefon eller ort"
              className="rounded-2xl border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Snabb loggning i modal</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Historik under listan</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Fristående samtal tillåtna</span>
            </div>
          </div>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="grid gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="h-3 w-40 rounded-full bg-slate-200" />
                  <div className="h-3 w-24 rounded-full bg-slate-200" />
                </div>
              ))
            ) : visibleProspects.length === 0 ? (
              <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <strong className="text-base font-bold text-slate-900">Ingen träff i ringlistan</strong>
                <p className="m-0 text-sm leading-6 text-slate-600">Lägg till fler prospekt först eller ändra sökningen.</p>
              </div>
            ) : (
              visibleProspects.map((prospect) => (
                <div key={prospect.id} className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_100%)] px-3.5 py-3 shadow-[0_16px_30px_rgba(15,23,42,0.06)] md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold tracking-[0.08em] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] md:h-11 md:w-11 md:text-sm">
                    {getInitials(prospect.company_name) || 'P'}
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 md:flex-nowrap">
                      <div className="grid min-w-0 gap-1">
                        <strong className="break-words text-base font-bold tracking-[-0.03em] text-slate-950 md:text-[17px]">{prospect.company_name}</strong>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 md:text-xs">
                          {prospect.contact_name ? <span>Kontakt: {prospect.contact_name}</span> : null}
                          {prospect.city ? <span>Ort: {prospect.city}</span> : null}
                          {prospect.source ? <span>Källa: {prospect.source}</span> : null}
                        </div>
                      </div>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', prospect.status === 'new' ? 'border-slate-200 bg-slate-100 text-slate-700' : 'border-sky-200 bg-sky-50 text-sky-700')}>
                        {prospect.status === 'new' ? 'Ny' : prospect.status}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1.5 text-[11px] text-slate-600 md:text-xs">
                      {prospect.phone ? <span className="break-words rounded-full border border-slate-200/90 bg-white/90 px-2 py-1 shadow-[0_4px_10px_rgba(15,23,42,0.03)]">{prospect.phone}</span> : null}
                      {prospect.email ? <span className="break-words rounded-full border border-slate-200/90 bg-white/90 px-2 py-1 shadow-[0_4px_10px_rgba(15,23,42,0.03)]">{prospect.email}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openLogModal(prospect)}
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97]"
                    >
                      Logga samtal
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_22px_54px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Historik</span>
              <strong className="text-[1.4rem] font-bold tracking-[-0.04em] text-slate-950">Senaste samtal</strong>
            </div>
            <div className="w-full max-w-[420px]">
              <Input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Sök i samtalshistoriken"
                className="rounded-2xl border-slate-200 bg-white"
              />
            </div>
          </div>

          <div className="grid gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="h-3 w-40 rounded-full bg-slate-200" />
                  <div className="h-3 w-24 rounded-full bg-slate-200" />
                </div>
              ))
            ) : calls.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-600">
                Inga samtal loggade ännu. Börja med att logga första samtalet från listan ovan eller skapa ett fristående samtal.
              </div>
            ) : (
              calls.map((call) => {
                const meta = buildCallMeta(call);
                const standalone = isStandaloneCall(call);
                const promoting = promotingCallIds.includes(call.id);
                const promoted = promotedCallIds.includes(call.id);
                return (
                  <div key={call.id} className="grid gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_26px_rgba(15,23,42,0.05)] md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="grid gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-words text-base font-bold tracking-[-0.03em] text-slate-950">{getCallCompanyName(call)}</strong>
                        {standalone ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800">Lead från samtal</span> : null}
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', outcomeMeta[call.outcome].className)}>
                          {outcomeMeta[call.outcome].label}
                        </span>
                      </div>
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{call.summary}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{formatDateTime(call.call_at)}</span>
                        {call.next_step ? <span>Nästa steg: {call.next_step}</span> : null}
                      </div>
                      {meta.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {meta.map((item) => (
                            <span
                              key={item}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[0_4px_10px_rgba(15,23,42,0.03)]',
                                standalone ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-slate-50 text-slate-600'
                              )}
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => openEditCallModal(call)}
                          className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-[0_8px_16px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                        >
                          Redigera samtal
                        </button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'rounded-2xl border px-3 py-3 text-xs md:w-[220px]',
                        standalone ? 'border-sky-200 bg-sky-50/80 text-sky-800' : 'border-slate-200 bg-slate-50 text-slate-600'
                      )}
                    >
                      <strong className="block text-slate-900">{standalone ? 'Fristående kontakt' : 'Tolkning'}</strong>
                      <span>{standalone ? 'Samtalet sparades utan prospekt och bär därför sina egna kontaktuppgifter.' : outcomeMeta[call.outcome].helper}</span>
                      {standalone ? (
                        <button
                          type="button"
                          onClick={() => promoteCallToProspect(call)}
                          disabled={promoting || promoted}
                          className={cn(
                            'mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border px-3 py-2 text-sm font-semibold transition',
                            promoted
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] text-white shadow-[0_16px_26px_rgba(2,132,199,0.18)] hover:brightness-[0.97]',
                            promoting ? 'cursor-wait opacity-70' : '',
                          )}
                        >
                          {promoting ? 'Skapar prospekt…' : promoted ? 'Prospekt skapat' : 'Skapa prospekt'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SectionCard>

      {logOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setLogOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Logga samtal"
            onClick={(event) => event.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5f9fc_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{editingCallId ? 'Redigera samtal' : 'Logga samtal'}</span>
                <strong className="text-[1.6rem] font-bold tracking-[-0.05em] text-slate-950">
                  {prospects.find((item) => item.id === draft.prospect_id)?.company_name || draft.company_name || 'Nytt samtal'}
                </strong>
                <p className="m-0 max-w-2xl text-sm leading-6 text-slate-600">
                  {editingCallId ? 'Justera uppgifter eller utfall utan att tappa samtalshistoriken.' : 'Registrera utfallet direkt efter samtalet och få historiken på plats utan att lämna arbetsflödet.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <label className="grid gap-1 text-sm text-slate-600">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Prospekt</span>
                <select
                  value={draft.prospect_id}
                  onChange={(event) => {
                    const prospectId = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      prospect_id: prospectId,
                      ...(prospectId
                        ? {
                            company_name: '',
                            organization_number: '',
                            contact_name: '',
                            phone: '',
                            email: '',
                            city: '',
                            source: '',
                          }
                        : {}),
                    }));
                  }}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/20"
                >
                  <option value="">Inget prospekt valt</option>
                  {prospects.map((prospect) => (
                    <option key={prospect.id} value={prospect.id}>
                      {prospect.company_name}
                    </option>
                  ))}
                </select>
              </label>

              {!draft.prospect_id ? (
                <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Ny kontakt</span>
                    <p className="m-0 text-sm leading-6 text-slate-600">
                      När samtalet inte har ett prospekt ännu sparas kontaktuppgifterna direkt på samtalet så att historiken fortfarande blir användbar.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      value={draft.company_name}
                      onChange={(event) => setDraft((current) => ({ ...current, company_name: event.target.value }))}
                      placeholder="Företagsnamn *"
                    />
                    <Input
                      value={draft.organization_number}
                      onChange={(event) => setDraft((current) => ({ ...current, organization_number: event.target.value }))}
                      placeholder="Organisationsnummer"
                    />
                    <Input
                      value={draft.contact_name}
                      onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))}
                      placeholder="Kontaktperson"
                    />
                    <Input
                      value={draft.phone}
                      onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="Telefon"
                    />
                    <Input
                      value={draft.email}
                      onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                      placeholder="E-post"
                    />
                    <Input
                      value={draft.city}
                      onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))}
                      placeholder="Ort"
                    />
                    <div className="md:col-span-2">
                      <Input
                        value={draft.source}
                        onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
                        placeholder="Källa, t.ex. inbound, mässa eller rekommendation"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Utfall</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(outcomeMeta).map(([key, meta]) => {
                    const outcome = key as CallItem['outcome'];
                    const active = draft.outcome === outcome;
                    return (
                      <button
                        key={outcome}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, outcome }))}
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
                onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
                placeholder="Vad hände i samtalet? Vad sa kunden?"
                className="min-h-[120px]"
              />

              <Input
                value={draft.next_step}
                onChange={(event) => setDraft((current) => ({ ...current, next_step: event.target.value }))}
                placeholder="Nästa steg, t.ex. ring igen torsdag eller skicka offert"
              />

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLogOpen(false);
                    setEditingCallId(null);
                    setDraft(initialDraft);
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={submitCall}
                  disabled={submitting}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Sparar…' : editingCallId ? 'Spara ändringar' : 'Logga samtal'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}