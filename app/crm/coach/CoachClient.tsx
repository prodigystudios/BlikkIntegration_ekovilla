'use client';

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
import Textarea from '../../../components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

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
  const selectedContextSummary = selectedContext ? selectedContext.summary.slice(0, 2).join(' · ') : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Säljcoach</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Be om hjälp inför nästa samtal, mitt i en invändning eller precis före avslut. Coachytan är en integrerad del av CRM-arbetsflödet.
          </p>
        </div>
        {userName ? (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
            {userName}
          </span>
        ) : null}
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Läge" value={activeModeLabel} helper="Nuvarande coachspår" />
        <MetricCard label="Kontext" value={selectedContext?.label || 'Ingen vald'} helper="Situationsdata till coachen" />
        <MetricCard label="Svar i tråd" value={thread.length} helper="Coachade steg sparade i vyn" />
        <MetricCard label="Sammanhang" value={selectedContextSummary || '–'} helper="Välj kontext för situationsbundet råd" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_380px]">
        {/* Main coach area */}
        <div className={crm.card}>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="m-0 text-base font-bold text-slate-900">Fråga coachen</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">Skriv som du faktiskt tänker inför ett säljsamtal. Börja från ett snabbval om du vill få fart direkt.</p>
          </div>

          <div className="p-5">
            <div className="grid gap-5">
              {/* Quick actions */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {quickActions.map((action) => {
                  const active = activeQuickAction === action.id;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => chooseQuickAction(action)}
                      className={cn(
                        'grid gap-1 rounded-2xl border px-4 py-3 text-left transition',
                        active
                          ? 'text-white'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50',
                      )}
                      style={active ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                    >
                      <strong className="text-sm font-semibold">{action.label}</strong>
                      <span className={active ? 'text-xs text-white/75' : 'text-xs text-slate-500'}>{action.helper}</span>
                    </button>
                  );
                })}
              </div>

              {/* Input area */}
              <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                    Läge: {activeModeLabel}
                  </span>
                  {selectedContext ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                      Kontext: {selectedContext.label}
                    </span>
                  ) : null}
                </div>
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Exempel: Kunden tycker att offerten känns dyr. Hur bemöter jag det utan att tappa fart och utan att låta pressad?"
                  className="min-h-[160px] border-slate-200 bg-white"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5 text-xs text-slate-400">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-500">Fri fråga eller snabbval</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-500">Kontext är frivillig</span>
                  </div>
                  <button
                    type="button"
                    onClick={submitPrompt}
                    disabled={submitting || loading}
                    className={cn(crm.primaryButton, 'h-10')}
                    style={{ backgroundColor: 'var(--crm-primary)' }}
                  >
                    {submitting ? 'Coachar…' : 'Få coachsvar'}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              {/* Thread */}
              <div className="grid gap-3">
                {thread.length === 0 ? (
                  <div className="grid gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6">
                    <div className="grid gap-1">
                      <strong className="text-base font-bold text-slate-900">Ingen coachdialog ännu</strong>
                      <p className="m-0 text-sm leading-5 text-slate-500">Börja med ett snabbt coachläge eller skriv frågan precis som den dyker upp i huvudet.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { n: '1', title: 'Välj läge', desc: 'Till exempel invändning, uppföljning eller fokus inför passet.' },
                        { n: '2', title: 'Lägg till situation', desc: 'Välj prospekt, samtal eller offert om rådet ska bli mer träffsäkert.' },
                        { n: '3', title: 'Be om konkret hjälp', desc: 'Du får strategi, formuleringar och nästa steg i samma svar.' },
                      ].map(({ n, title, desc }) => (
                        <div key={n} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <p className={crm.sectionTitle}>{n}</p>
                          <strong className="mt-1 block text-sm text-slate-900">{title}</strong>
                          <p className="m-0 mt-1 text-sm leading-5 text-slate-500">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  thread.map((item) => (
                    <div key={item.id} className="grid gap-3 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
                      <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-600">Din fråga</span>
                          {item.quickActionLabel ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">{item.quickActionLabel}</span> : null}
                          {item.contextLabel ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">Kontext: {item.contextLabel}</span> : null}
                        </div>
                        <p className="m-0 text-sm leading-5 text-slate-700">{item.prompt}</p>
                      </div>

                      <div className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 font-semibold text-emerald-700">Coach svar</span>
                          <span className={item.reply.mode === 'ai'
                            ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700'
                            : 'rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-500'}>
                            {item.reply.mode === 'ai' ? 'AI-koppling' : 'Mockat standardsvar'}
                          </span>
                        </div>
                        <div className="grid gap-0.5">
                          <strong className="text-lg font-bold tracking-tight text-slate-900">{item.reply.headline}</strong>
                          <p className="m-0 text-sm leading-5 text-slate-600">{item.reply.lead}</p>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-3">
                          {[
                            { title: 'Strategi', items: item.reply.strategy },
                            { title: 'Så kan du säga', items: item.reply.talk_track },
                            { title: 'Nästa steg', items: item.reply.next_steps },
                          ].map(({ title, items: listItems }) => (
                            <div key={title} className="grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3">
                              <strong className="text-sm font-semibold text-slate-900">{title}</strong>
                              <ul className="m-0 grid gap-1.5 pl-5 text-sm leading-5 text-slate-600">
                                {listItems.map((entry) => <li key={entry}>{entry}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CRM context sidebar */}
        <div className={crm.cardInner}>
          <p className="mb-1 text-base font-bold text-slate-900">CRM-kontext</p>
          <p className="m-0 mb-4 text-sm text-slate-500">Lägg till kontext bara när svaret behöver bottna i ett faktiskt prospekt, samtal eller offertläge.</p>

          <div className="grid gap-4">
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
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                    contextType === value
                      ? 'text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  )}
                  style={contextType === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            {contextType !== 'none' ? (
              <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök i vald kontext"
                />

                <select
                  value={selectedContextId}
                  onChange={(event) => setSelectedContextId(event.target.value)}
                  className="min-h-11 rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-700 transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">Välj kontext</option>
                  {filteredContexts.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>

                {selectedContext ? (
                  <div className="grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-semibold text-slate-900">{selectedContext.label}</strong>
                      <span className={cn(crm.badge, 'border-emerald-200 bg-white text-emerald-700')}>Skickas med</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      {selectedContext.summary.map((entry) => <span key={entry}>{entry}</span>)}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                    Välj ett prospekt, samtal eller en offert om svaret ska bli mer situationsbundet.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Ingen CRM-kontext vald. Coachen svarar då mer generellt, vilket ofta räcker för träning, formulering och invändningshantering.
              </div>
            )}

            <div className="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <p className={crm.sectionTitle}>Framtidssäkrat</p>
              <ul className="m-0 grid gap-2 pl-5 text-sm leading-5 text-slate-600">
                <li>Frågan skickas redan genom en dedikerad coach-route.</li>
                <li>Kontext väljs som tydlig referens i stället för att hårdkodas i UI:t.</li>
                <li>Svaret kommer i ett kontrakt som senare kan fyllas av riktig AI-koppling.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
