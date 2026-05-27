'use client';

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import SectionCard from '../../../components/ui/SectionCard';
import Textarea from '../../../components/ui/Textarea';

type ProspectItem = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
};

type CallProspect = {
  id: string;
  company_name: string;
};

type CallItem = {
  id: string;
  prospect_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  source: string | null;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at: string;
  prospect: CallProspect | CallProspect[] | null;
};

type QuoteProspect = {
  id: string;
  company_name: string;
};

type QuoteItem = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  project_name: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  follow_up_date: string | null;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type LoadState = {
  prospects: ProspectItem[];
  calls: CallItem[];
  quotes: QuoteItem[];
};

type CoachContextType = 'none' | 'prospect' | 'call' | 'quote';

type CoachContextSummary = {
  type: Exclude<CoachContextType, 'none'>;
  id: string;
  label: string;
  summary: string[];
};

type CoachReply = {
  mode: 'mock' | 'ai';
  headline: string;
  lead: string;
  strategy: string[];
  talk_track: string[];
  next_steps: string[];
  context: CoachContextSummary | null;
};

type CoachThreadItem = {
  id: string;
  prompt: string;
  quickActionLabel: string | null;
  contextLabel: string | null;
  reply: CoachReply;
};

type QuickAction = {
  id: string;
  label: string;
  prompt: string;
  helper: string;
};

const quickActions: QuickAction[] = [
  {
    id: 'close_sale',
    label: 'Hjälp mig stänga affären',
    prompt: 'Hjälp mig stänga affären på ett tryggt men tydligt sätt.',
    helper: 'Avslutsteknik, nästa fråga och hur man ber om beslut.',
  },
  {
    id: 'handle_objection',
    label: 'Hjälp mig bemöta invändningen',
    prompt: 'Kunden tycker att det känns dyrt. Hur bemöter jag invändningen?',
    helper: 'Invändningshantering utan att låta defensiv eller pressad.',
  },
  {
    id: 'write_follow_up',
    label: 'Skriv en uppföljning',
    prompt: 'Skriv en kort uppföljning som känns personlig och driver nästa steg.',
    helper: 'Textförslag för sms eller mejl efter samtal eller offert.',
  },
  {
    id: 'next_call',
    label: 'Hur ska jag ta nästa samtal?',
    prompt: 'Hur ska jag lägga upp nästa samtal så att kunden känner förtroende?',
    helper: 'Samtalsstruktur, tempo och vad som är viktigast att fråga om.',
  },
  {
    id: 'motivation',
    label: 'Ge mig motivation och fokus',
    prompt: 'Ge mig ett kort coachande fokus inför nästa säljpass.',
    helper: 'Kort mentalt stöd inför ett samtalspass eller en seg dag.',
  },
];

const statusLabel: Record<ProspectItem['status'], string> = {
  new: 'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

function getProspectFromCall(item: CallItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getCallLabel(item: CallItem) {
  return getProspectFromCall(item)?.company_name || item.company_name || 'Fristående samtal';
}

function getQuoteLabel(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name || item.customer_name || item.project_name;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Ingen planerad uppföljning';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ingen planerad uppföljning';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function buildProspectContext(item: ProspectItem): CoachContextSummary {
  return {
    type: 'prospect',
    id: item.id,
    label: item.company_name,
    summary: [
      item.contact_name ? `Kontakt: ${item.contact_name}` : null,
      item.city ? `Ort: ${item.city}` : null,
      `Status: ${statusLabel[item.status]}`,
      item.source ? `Källa: ${item.source}` : null,
    ].filter(Boolean) as string[],
  };
}

function buildCallContext(item: CallItem): CoachContextSummary {
  return {
    type: 'call',
    id: item.id,
    label: getCallLabel(item),
    summary: [
      item.contact_name ? `Kontakt: ${item.contact_name}` : null,
      `Utfall: ${item.outcome}`,
      item.next_step ? `Nästa steg: ${item.next_step}` : null,
      item.source ? `Källa: ${item.source}` : null,
    ].filter(Boolean) as string[],
  };
}

function buildQuoteContext(item: QuoteItem): CoachContextSummary {
  return {
    type: 'quote',
    id: item.id,
    label: getQuoteLabel(item),
    summary: [
      `Projekt: ${item.project_name}`,
      `Status: ${item.status}`,
      `Uppföljning: ${formatDate(item.follow_up_date)}`,
    ],
  };
}

export default function CoachClient({ userName }: { userName: string | null }) {
  const [state, setState] = useState<LoadState>({ prospects: [], calls: [], quotes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [search, setSearch] = useState('');
  const [contextType, setContextType] = useState<CoachContextType>('none');
  const [selectedContextId, setSelectedContextId] = useState('');
  const [activeQuickAction, setActiveQuickAction] = useState<string | null>(null);
  const [thread, setThread] = useState<CoachThreadItem[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [prospectsRes, callsRes, quotesRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch('/api/crm/calls', { cache: 'no-store' }),
          fetch('/api/crm/quotes', { cache: 'no-store' }),
        ]);

        const [prospectsJson, callsJson, quotesJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          callsRes.json().catch(() => ({})),
          quotesRes.json().catch(() => ({})),
        ]);

        if (!prospectsRes.ok) throw new Error(prospectsJson?.error || 'Kunde inte läsa prospekt.');
        if (!callsRes.ok) throw new Error(callsJson?.error || 'Kunde inte läsa samtal.');
        if (!quotesRes.ok) throw new Error(quotesJson?.error || 'Kunde inte läsa offerter.');

        if (!active) return;

        setState({
          prospects: Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : [],
          calls: Array.isArray(callsJson?.data?.items) ? callsJson.data.items : [],
          quotes: Array.isArray(quotesJson?.data?.items) ? quotesJson.data.items : [],
        });
      } catch (loadError: any) {
        if (!active) return;
        setError(loadError?.message || 'Kunde inte ladda coachvyn.');
        setState({ prospects: [], calls: [], quotes: [] });
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const selectedQuickAction = useMemo(
    () => quickActions.find((item) => item.id === activeQuickAction) || null,
    [activeQuickAction],
  );

  const filteredContexts = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (contextType === 'prospect') {
      return state.prospects
        .filter((item) => !term || [item.company_name, item.contact_name, item.city, item.source].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)))
        .slice(0, 10)
        .map(buildProspectContext);
    }

    if (contextType === 'call') {
      return state.calls
        .filter((item) => !term || [getCallLabel(item), item.contact_name, item.summary, item.source].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)))
        .slice(0, 10)
        .map(buildCallContext);
    }

    if (contextType === 'quote') {
      return state.quotes
        .filter((item) => !term || [getQuoteLabel(item), item.project_name].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)))
        .slice(0, 10)
        .map(buildQuoteContext);
    }

    return [] as CoachContextSummary[];
  }, [contextType, search, state.calls, state.prospects, state.quotes]);

  const selectedContext = useMemo(() => {
    if (contextType === 'none' || !selectedContextId) return null;
    return filteredContexts.find((item) => item.id === selectedContextId) || null;
  }, [contextType, filteredContexts, selectedContextId]);

  useEffect(() => {
    setSelectedContextId('');
    setSearch('');
  }, [contextType]);

  async function submitPrompt() {
    if (!prompt.trim()) {
      setError('Skriv en fråga eller välj ett snabbval först.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/crm/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          quick_action: activeQuickAction,
          context: selectedContext ? { type: selectedContext.type, id: selectedContext.id } : null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json?.error || 'Coach kunde inte svara just nu.');
        return;
      }

      const reply = json?.data?.reply as CoachReply | undefined;
      if (!reply) {
        setError('Coach svarade utan innehåll.');
        return;
      }

      setThread((current) => [
        {
          id: `${Date.now()}`,
          prompt: prompt.trim(),
          quickActionLabel: selectedQuickAction?.label || null,
          contextLabel: reply.context?.label || selectedContext?.label || null,
          reply,
        },
        ...current,
      ]);

      setPrompt('');
      setActiveQuickAction(null);
    } catch {
      setError('Coach kunde inte svara just nu.');
    } finally {
      setSubmitting(false);
    }
  }

  function chooseQuickAction(action: QuickAction) {
    setActiveQuickAction(action.id);
    setPrompt(action.prompt);
  }

  const contextCounts = {
    prospect: state.prospects.length,
    call: state.calls.length,
    quote: state.quotes.length,
  };

  const activeModeLabel = selectedQuickAction?.label || 'Fri coachfråga';
  const selectedContextSummary = selectedContext ? selectedContext.summary.slice(0, 2).join(' • ') : null;

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(180deg,#fbfeff_0%,#f8fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid gap-4">
            <div className="inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
              CRM / Coach
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">Säljcoach</h1>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">Coach-beta</div>
              </div>
              <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                Be om hjälp inför nästa samtal, mitt i en invändning eller precis före avslut. Flödet är redan byggt för fri fråga, snabbval och valbar CRM-kontext, så en riktig modell kan kopplas på senare utan att produkten behöver göras om.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.04)]">Fri fråga eller snabbstart</span>
              <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.04)]">Prospekt, samtal eller offert som stöd</span>
              <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.04)]">Svarsformat redo för riktig AI-runtime</span>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/80">I detta pass</span>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
              <strong className="block text-white">{userName || 'Säljare'}</strong>
              Fokus ligger på hur du ska agera i nästa steg, inte på att visa ännu en pipelineöversikt.
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Läge</div>
                <div className="mt-1 text-sm font-semibold text-white">{activeModeLabel}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Kontext</div>
                <div className="mt-1 text-sm font-semibold text-white">{selectedContext?.label || 'Ingen vald'}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Coachsvar i tråden</span>
                <strong className="text-base text-white">{thread.length}</strong>
              </div>
              <p className="mt-2 m-0 text-xs leading-5 text-slate-300">
                {selectedContextSummary || 'Välj kontext först när svaret behöver bli mer situationsbundet än generellt.'}
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_380px]">
        <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
          <div className="grid gap-1">
            <strong className="text-base font-bold text-slate-950">Fråga coachen</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">Skriv som du faktiskt tänker inför ett säljsamtal. Börja från ett snabbval om du vill få fart direkt.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const active = activeQuickAction === action.id;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => chooseQuickAction(action)}
                  className={active
                    ? 'grid gap-1 rounded-[22px] border border-slate-900 bg-slate-900 px-4 py-4 text-left text-white shadow-[0_14px_28px_rgba(15,23,42,0.18)]'
                    : 'grid gap-1 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 text-left text-slate-900 shadow-[0_12px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_32px_rgba(15,23,42,0.08)]'}
                >
                  <strong className="text-sm font-semibold">{action.label}</strong>
                  <span className={active ? 'text-xs text-slate-200' : 'text-xs text-slate-500'}>{action.helper}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700">Läge: {activeModeLabel}</span>
              {selectedContext ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">Kontext: {selectedContext.label}</span>
              ) : null}
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Exempel: Kunden tycker att offerten känns dyr. Hur bemöter jag det utan att tappa fart och utan att låta pressad?"
              className="min-h-[160px] border-slate-200 bg-white"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">Fri fråga eller snabbval</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">Kontext är frivillig</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">Mockat svar via API-kontrakt</span>
              </div>
              <button
                type="button"
                onClick={submitPrompt}
                disabled={submitting || loading}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Coachar…' : 'Få coachsvar'}
              </button>
            </div>
          </div>

          {error ? <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <div className="grid gap-3">
            {thread.length === 0 ? (
              <div className="grid gap-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-6">
                <div className="grid gap-1">
                  <strong className="text-base font-bold text-slate-900">Ingen coachdialog ännu</strong>
                  <p className="m-0 text-sm leading-6 text-slate-600">Börja med ett snabbt coachläge eller skriv frågan precis som den dyker upp i huvudet före samtalet.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[20px] border border-white bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">1</div>
                    <strong className="mt-1 block text-sm text-slate-900">Välj läge</strong>
                    <p className="m-0 mt-1 text-sm leading-6 text-slate-600">Till exempel invändning, uppföljning eller fokus inför passet.</p>
                  </div>
                  <div className="rounded-[20px] border border-white bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">2</div>
                    <strong className="mt-1 block text-sm text-slate-900">Lägg till situation</strong>
                    <p className="m-0 mt-1 text-sm leading-6 text-slate-600">Välj prospekt, samtal eller offert om rådet ska bli mer träffsäkert.</p>
                  </div>
                  <div className="rounded-[20px] border border-white bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">3</div>
                    <strong className="mt-1 block text-sm text-slate-900">Be om konkret hjälp</strong>
                    <p className="m-0 mt-1 text-sm leading-6 text-slate-600">Du får strategi, formuleringar och nästa steg i samma svar.</p>
                  </div>
                </div>
              </div>
            ) : (
              thread.map((item) => (
                <div key={item.id} className="grid gap-3 rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
                  <div className="grid gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">Din fråga</span>
                      {item.quickActionLabel ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">{item.quickActionLabel}</span> : null}
                      {item.contextLabel ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Kontext: {item.contextLabel}</span> : null}
                    </div>
                    <p className="m-0 text-sm leading-6 text-slate-700">{item.prompt}</p>
                  </div>

                  <div className="grid gap-3 rounded-[22px] border border-sky-100 bg-[linear-gradient(180deg,rgba(240,249,255,0.85),rgba(255,255,255,0.98))] px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 font-semibold text-sky-700">Coach svar</span>
                      <span className={item.reply.mode === 'ai'
                        ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700'
                        : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600'}>
                        {item.reply.mode === 'ai' ? 'AI-runtime' : 'Mockad fallback'}
                      </span>
                    </div>
                    <div className="grid gap-1">
                      <strong className="text-lg font-bold tracking-[-0.03em] text-slate-950">{item.reply.headline}</strong>
                      <p className="m-0 text-sm leading-6 text-slate-600">{item.reply.lead}</p>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="grid gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <strong className="text-sm font-semibold text-slate-900">Strategi</strong>
                        <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-slate-600">
                          {item.reply.strategy.map((entry) => <li key={entry}>{entry}</li>)}
                        </ul>
                      </div>
                      <div className="grid gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <strong className="text-sm font-semibold text-slate-900">Så kan du säga</strong>
                        <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-slate-600">
                          {item.reply.talk_track.map((entry) => <li key={entry}>{entry}</li>)}
                        </ul>
                      </div>
                      <div className="grid gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <strong className="text-sm font-semibold text-slate-900">Nästa steg</strong>
                        <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-slate-600">
                          {item.reply.next_steps.map((entry) => <li key={entry}>{entry}</li>)}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
          <div className="grid gap-1">
            <strong className="text-base font-bold text-slate-950">CRM-kontext</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">Lägg till kontext bara när svaret behöver bottna i ett faktiskt prospekt, ett samtal eller ett offertläge.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ['none', 'Ingen'],
              ['prospect', `Prospekt (${contextCounts.prospect})`],
              ['call', `Samtal (${contextCounts.call})`],
              ['quote', `Offerter (${contextCounts.quote})`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setContextType(value)}
                className={contextType === value
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white'
                  : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50'}
              >
                {label}
              </button>
            ))}
          </div>

          {contextType !== 'none' ? (
            <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Sök i vald kontext"
                className="border-slate-200 bg-white"
              />

              <select
                value={selectedContextId}
                onChange={(event) => setSelectedContextId(event.target.value)}
                className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300"
              >
                <option value="">Välj kontext</option>
                {filteredContexts.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>

              {selectedContext ? (
                <div className="grid gap-2 rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-semibold text-slate-950">{selectedContext.label}</strong>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700">Skickas med</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                    {selectedContext.summary.map((entry) => <span key={entry}>{entry}</span>)}
                  </div>
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                  Välj ett prospekt, samtal eller en offert om svaret ska bli mer situationsbundet.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              Ingen CRM-kontext vald. Coachen svarar då mer generellt, vilket ofta räcker för träning, formulering och invändningshantering.
            </div>
          )}

          <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
            <strong className="text-sm font-semibold text-slate-950">Vad som redan är framtidssäkrat</strong>
            <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-slate-600">
              <li>Frågan skickas redan genom en dedikerad coach-route.</li>
              <li>Kontext väljs som tydlig referens i stället för att hårdkodas i UI:t.</li>
              <li>Svaret kommer i ett kontrakt som senare kan fyllas av riktig AI-runtime.</li>
            </ul>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}