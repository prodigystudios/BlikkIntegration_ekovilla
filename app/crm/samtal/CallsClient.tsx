"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
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

type OpportunityOption = {
  id: string;
  title: string;
  prospect: { company_name: string } | null;
};

type CallItem = {
  id: string;
  prospect_id: string | null;
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
  prospect: ProspectItem | ProspectItem[] | null;
};

type CallDraft = {
  prospect_id: string;
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

const initialDraft: CallDraft = {
  prospect_id: '',
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

export default function CallsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [promotingCallIds, setPromotingCallIds] = useState<string[]>([]);
  const [promotedCallIds, setPromotedCallIds] = useState<string[]>([]);
  const [promotedProspectIdsByCallId, setPromotedProspectIdsByCallId] = useState<Record<string, string>>({});
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [prefilledProspectId, setPrefilledProspectId] = useState<string | null>(null);
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
        const [prospectsRes, callsRes, opportunitiesRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch(`/api/crm/calls${historySearch.trim() ? `?q=${encodeURIComponent(historySearch.trim())}` : ''}`, { cache: 'no-store' }),
          fetch('/api/crm/opportunities', { cache: 'no-store' }),
        ]);

        const [prospectsJson, callsJson, opportunitiesJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          callsRes.json().catch(() => ({})),
          opportunitiesRes.json().catch(() => ({})),
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
        setOpportunities(Array.isArray(opportunitiesJson?.data?.items) ? opportunitiesJson.data.items : []);
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

  const stats = useMemo(() => ({
    logged: calls.length,
    followUp: calls.filter((item) => item.outcome === 'follow_up').length,
    standalone: calls.filter((item) => isStandaloneCall(item)).length,
    linked: calls.filter((item) => !isStandaloneCall(item)).length,
  }), [calls]);

  function openLogModal(prospect: ProspectItem) {
    setEditingCallId(null);
    setDraft({
      ...initialDraft,
      prospect_id: prospect.id,
    });
    setLogOpen(true);
  }

  function openStandaloneLogModal() {
    setEditingCallId(null);
    setDraft(initialDraft);
    setLogOpen(true);
  }

  function openEditCallModal(call: CallItem) {
    const prospect = getProspectFromCall(call);
    setEditingCallId(call.id);
    setDraft({
      prospect_id: prospect?.id || call.prospect_id || '',
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
        body: JSON.stringify({
          ...draft,
          opportunity_id: draft.opportunity_id || null,
        }),
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
        setPromotedProspectIdsByCallId((current) => ({
          ...current,
          [call.id]: item.id,
        }));

        const attachRes = await fetch(`/api/crm/calls/${call.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prospect_id: item.id,
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

        if (!attachRes.ok || !attachJson.ok) {
          toast.error(attachJson?.error || 'Prospekt skapades men kunde inte kopplas till samtalet');
          return;
        }

        const updatedCall = attachJson?.data?.item as CallItem | undefined;
        if (updatedCall) {
          setCalls((current) => current.map((entry) => (entry.id === updatedCall.id ? updatedCall : entry)));
        }
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
    <div className="grid gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Samtal</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Här kan du boka in och följa upp samtalsaktiviteter med dina prospekt och kunder</p>
        </div>
        <button
          type="button"
          onClick={openStandaloneLogModal}
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Logga samtal
        </button>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Loggade samtal" value={stats.logged} helper="Senaste samtalen i historiken" />
        <MetricCard label="Kräver uppföljning" value={stats.followUp} helper="Utfall som kräver nytt steg" />
        <MetricCard label="Fristående kontakter" value={stats.standalone} helper="Kan lyftas till prospekt" />
        <MetricCard label="Kopplade samtal" value={stats.linked} helper="Samtal med ett prospekt" />
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Activity list */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-bold text-slate-900">Samtalsaktiviteter</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">Alla loggade samtal och uppföljningar</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{calls.length} loggade</span>
              <Input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Sök samtal…"
                className="w-48"
              />
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex gap-3 px-5 py-4">
                <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 grid gap-2">
                  <div className="h-3 w-40 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
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
              const linkedProspect = getProspectFromCall(call);
              const promotedProspectId = promotedProspectIdsByCallId[call.id] || null;
              const canOpenProspect = Boolean(linkedProspect?.id || promotedProspectId);
              return (
                <article key={call.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_200px] md:items-start">
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                        </svg>
                      </div>
                      <div className="grid gap-0">
                        <strong className="text-sm font-semibold text-slate-900">{getCallCompanyName(call)}</strong>
                        {call.contact_name || getProspectFromCall(call)?.contact_name ? (
                          <span className="text-xs text-slate-500">{call.contact_name || getProspectFromCall(call)?.contact_name}</span>
                        ) : null}
                      </div>
                      {standalone ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Lead</span> : null}
                      <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', outcomeMeta[call.outcome].className)}>
                        {outcomeMeta[call.outcome].label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{formatDateTime(call.call_at)}</span>
                      {call.next_step ? <span>· Nästa steg: {call.next_step}</span> : null}
                    </div>
                    {call.summary ? <p className="m-0 text-sm leading-5 text-slate-700">{call.summary}</p> : null}
                    {meta.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {meta.map((item) => (
                          <span key={item} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', standalone ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                            {item}
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
                    {standalone && !canOpenProspect ? (
                      <button
                        type="button"
                        onClick={() => promoteCallToProspect(call)}
                        disabled={promoting || promoted}
                        aria-label={`Skapa prospekt från samtal med ${getCallCompanyName(call)}`}
                        className={cn(
                          'inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition',
                          promoted ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'text-white',
                          promoting ? 'cursor-wait opacity-70' : '',
                        )}
                        style={!promoted ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                      >
                        {promoting ? 'Skapar…' : promoted ? 'Prospekt skapat' : 'Skapa prospekt'}
                      </button>
                    ) : canOpenProspect ? (
                      <button
                        type="button"
                        onClick={() => router.push('/crm/prospekt')}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        Öppna prospekt
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
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setLogOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Logga samtal"
            onClick={(event) => event.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-2xl border border-white/70 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <strong className="text-xl font-bold tracking-tight text-slate-900">
                  {prospects.find((item) => item.id === draft.prospect_id)?.company_name || draft.company_name || 'Nytt samtal'}
                </strong>
                <p className="m-0 text-sm text-slate-500">
                  {editingCallId ? 'Justera uppgifter eller utfall.' : 'Registrera utfallet direkt efter samtalet.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
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
                    <option value="">Inget prospekt</option>
                    {prospects.map((prospect) => (
                      <option key={prospect.id} value={prospect.id}>
                        {prospect.company_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-600">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Affärsmöjlighet (valfritt)</span>
                  <select
                    value={draft.opportunity_id}
                    onChange={(event) => setDraft((current) => ({ ...current, opportunity_id: event.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                  >
                    <option value="">Ingen affärsmöjlighet</option>
                    {opportunities.map((opp) => (
                      <option key={opp.id} value={opp.id}>
                        {opp.title}{opp.prospect?.company_name ? ` – ${opp.prospect.company_name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!draft.prospect_id && !draft.opportunity_id ? (
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
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={submitCall}
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: 'var(--crm-primary)' }}
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