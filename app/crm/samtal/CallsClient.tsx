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

export default function CallsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
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

  const stats = useMemo(() => ({
    logged: calls.length,
    followUp: calls.filter((item) => item.outcome === 'follow_up').length,
    standalone: calls.filter((item) => isStandaloneCall(item)).length,
    linked: calls.filter((item) => !isStandaloneCall(item)).length,
  }), [calls]);

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
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.16),_transparent_24%),linear-gradient(135deg,#f6fbf4_0%,#e5f4e8_56%,#f5fbf6_100%)] p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-5 xl:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Samtal
              </div>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(1.75rem,3vw,2.8rem)] font-bold tracking-[-0.05em] text-slate-950">Samtal</h1>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
                    {stats.logged} loggade
                  </div>
                </div>
                <p className="m-0 max-w-3xl text-sm text-slate-600">
                  Logga utfallet direkt efter samtalet, följ upp rätt konversationer och fånga fristående kontakter utan att lämna arbetsytan.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={openStandaloneLogModal}
                className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900"
              >
                Logga nytt samtal
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Loggade</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.logged}</div>
              <div className="mt-1 text-[13px] text-slate-500">Senaste samtalen i historiken</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Följ upp</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.followUp}</div>
              <div className="mt-1 text-[13px] text-slate-500">Utfall som kräver nytt steg</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Fristående</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.standalone}</div>
              <div className="mt-1 text-[13px] text-slate-500">Kan lyftas till prospekt</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,253,252,0.98))] p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Kopplade</div>
              <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{stats.linked}</div>
              <div className="mt-1 text-[13px] text-slate-500">Samtal som redan har ett prospekt</div>
            </div>
          </div>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>
      </SectionCard>

      <SectionCard className="border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5">
        <div className="grid gap-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Historik</span>
              <strong className="text-[1.3rem] font-bold tracking-[-0.04em] text-slate-950">Senaste samtal</strong>
              <p className="m-0 text-sm text-slate-500">Jobba från färska samtal först och fånga fristående kontakter innan de tappas bort.</p>
            </div>
            <div className="grid gap-2 rounded-[20px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,252,250,0.96))] p-2 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3 px-2 pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Historikfilter</div>
                <div className="text-xs text-slate-500">{calls.length} loggade</div>
              </div>
              <Input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Sök i samtalshistoriken"
                className="max-w-xl"
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
                const linkedProspect = getProspectFromCall(call);
                const promotedProspectId = promotedProspectIdsByCallId[call.id] || null;
                const canOpenProspect = Boolean(linkedProspect?.id || promotedProspectId);
                return (
                  <div key={call.id} className="grid gap-2.5 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,249,0.96))] px-3.5 py-2.5 shadow-[0_12px_24px_rgba(15,23,42,0.05)] md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
                    <div className="grid min-w-0 gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-words text-base font-bold tracking-[-0.03em] text-slate-950">{getCallCompanyName(call)}</strong>
                        {standalone ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800">Lead från samtal</span> : null}
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', outcomeMeta[call.outcome].className)}>
                          {outcomeMeta[call.outcome].label}
                        </span>
                      </div>
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-slate-600">{call.summary}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{formatDateTime(call.call_at)}</span>
                        {call.next_step ? <span>Nästa steg: {call.next_step}</span> : null}
                      </div>
                      {meta.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
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
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => openEditCallModal(call)}
                          className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[0_8px_16px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        >
                          Redigera samtal
                        </button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'rounded-[18px] border px-3 py-2.5 text-xs',
                        standalone ? 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,250,247,0.96))] text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.04)]' : 'border-slate-200 bg-slate-50 text-slate-600'
                      )}
                    >
                      <strong className="block text-slate-900">{standalone ? (canOpenProspect ? 'Prospekt skapat' : 'Fristående kontakt') : 'Kopplat prospekt'}</strong>
                      <span>
                        {standalone
                          ? canOpenProspect
                            ? 'Det här samtalet har nu ett prospekt att följa vidare i prospektytan.'
                            : 'Samtalet sparades utan prospekt och bär därför sina egna kontaktuppgifter.'
                          : 'Samtalet är redan kopplat till ett prospekt och följs vidare i prospektytan.'}
                      </span>
                      {standalone && !canOpenProspect ? (
                        <button
                          type="button"
                          onClick={() => promoteCallToProspect(call)}
                          disabled={promoting || promoted}
                          className={cn(
                            'mt-2.5 inline-flex min-h-10 w-full items-center justify-center rounded-full border px-3 py-2 text-sm font-semibold transition',
                            promoted
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-emerald-800 bg-emerald-800 text-white hover:bg-emerald-900',
                            promoting ? 'cursor-wait opacity-70' : '',
                          )}
                        >
                          {promoting ? 'Skapar prospekt…' : promoted ? 'Prospekt skapat' : 'Skapa prospekt'}
                        </button>
                      ) : canOpenProspect ? (
                        <button
                          type="button"
                          onClick={() => router.push('/crm/prospekt')}
                          className="mt-2.5 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-950"
                        >
                          Öppna prospekt
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
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">CRM / Samtal</span>
                <strong className="text-[1.5rem] font-bold tracking-[-0.05em] text-slate-950">
                  {prospects.find((item) => item.id === draft.prospect_id)?.company_name || draft.company_name || 'Nytt samtal'}
                </strong>
                <p className="m-0 max-w-2xl text-sm leading-6 text-slate-600">
                  {editingCallId ? 'Justera uppgifter eller utfall utan att tappa samtalshistoriken.' : 'Registrera utfallet direkt efter samtalet och få historiken på plats utan att lämna arbetsflödet.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:text-slate-900"
              >
                Stäng
              </button>
            </div>

            <div className="grid gap-4 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
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
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={submitCall}
                  disabled={submitting}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
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