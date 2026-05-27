"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SectionCard from '../../../components/ui/SectionCard';
import type { UserRole } from '@/lib/roles';
import { getVisibleCrmNavItems } from '../_lib/nav';

type ProspectItem = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
  updated_at: string;
};

type CallProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  source: string | null;
  status: ProspectItem['status'];
};

type CallItem = {
  id: string;
  prospect_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  city: string | null;
  source: string | null;
  user_id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at: string;
  prospect: CallProspect | CallProspect[] | null;
};

type TaskItem = {
  id: string;
  prospect_id: string | null;
  title: string;
  details: string | null;
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
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
  amount: number | string;
  currency_code: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  quote_date: string;
  follow_up_date: string | null;
  assigned_to: string;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type LoadState = {
  prospects: ProspectItem[];
  calls: CallItem[];
  tasks: TaskItem[];
  quotes: QuoteItem[];
  goals: GoalItem[];
};

type GoalUser = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'member' | 'konsult';
};

type GoalItem = {
  id: string;
  user_id: string;
  period_type: 'week';
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
  user: GoalUser | GoalUser[] | null;
};

const outcomeLabel: Record<CallItem['outcome'], string> = {
  no_answer: 'Ej svar',
  follow_up: 'Följ upp',
  positive: 'Positivt',
  negative: 'Negativt',
};

const taskPriorityClass: Record<TaskItem['priority'], string> = {
  low: 'border-slate-200 bg-slate-100 text-slate-700',
  normal: 'border-sky-200 bg-sky-50 text-sky-700',
  high: 'border-rose-200 bg-rose-50 text-rose-700',
};

const taskPriorityLabel: Record<TaskItem['priority'], string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
};

const quoteStatusLabel: Record<QuoteItem['status'], string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  follow_up: 'Följ upp',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const prospectStatusLabel: Record<ProspectItem['status'], string> = {
  new: 'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const overviewPanelClass = 'grid gap-2.5 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-3 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-3.5';
const overviewItemCardClass = 'rounded-[16px] border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#fdfefe_100%)] p-2.5 no-underline shadow-[0_14px_28px_rgba(15,23,42,0.08)] ring-1 ring-white/95 transition-[transform,border-color,box-shadow,background-color] hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-[0_20px_34px_rgba(15,23,42,0.12)]';

function getProspectFromCall(item: CallItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getCallCompanyName(item: CallItem) {
  return getProspectFromCall(item)?.company_name || item.company_name || 'Fristående samtal';
}

function getProspectFromQuote(item: QuoteItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getQuoteCustomerName(item: QuoteItem) {
  return getProspectFromQuote(item)?.company_name || item.customer_name || 'Okänd kund';
}

function getGoalUser(value: GoalItem['user']) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function hasActiveGoalTarget(goal: GoalItem) {
  return goal.calls_target > 0 || goal.quotes_target > 0 || Number(goal.quote_value_target) > 0;
}

function isPipelineProspect(prospect: ProspectItem) {
  return prospect.status === 'new' || prospect.status === 'contacted' || prospect.status === 'qualified' || prospect.status === 'quoted';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Ingen deadline';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'Ingen deadline';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function formatCurrency(value: number | string, currencyCode: string) {
  const numeric = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(numeric)) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currencyCode || 'SEK', maximumFractionDigits: 0 }).format(numeric);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isWithinLastDays(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const from = addDays(startOfToday(), -days);
  return date >= from;
}

function isOverdue(task: TaskItem) {
  if (task.status === 'done' || !task.due_date) return false;
  const today = startOfToday();
  const dueDate = new Date(`${task.due_date}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate < today;
}

function isDueToday(task: TaskItem) {
  if (task.status === 'done' || !task.due_date) return false;
  const today = startOfToday();
  const dueDate = new Date(`${task.due_date}T00:00:00`);
  return dueDate.getFullYear() === today.getFullYear()
    && dueDate.getMonth() === today.getMonth()
    && dueDate.getDate() === today.getDate();
}

function sortTasks(taskA: TaskItem, taskB: TaskItem) {
  if (taskA.status !== taskB.status) return taskA.status === 'open' ? -1 : 1;
  if (!!taskA.due_date !== !!taskB.due_date) return taskA.due_date ? -1 : 1;
  if (taskA.due_date && taskB.due_date && taskA.due_date !== taskB.due_date) return taskA.due_date.localeCompare(taskB.due_date);
  return taskB.updated_at.localeCompare(taskA.updated_at);
}

function buildOverviewActions(args: { overdueTasks: number; followUpCalls: number; newProspects: number; standaloneCalls: number; quoteFollowUps: number }) {
  const actions: Array<{ title: string; description: string; href: string }> = [];

  if (args.overdueTasks > 0) {
    actions.push({ title: `${args.overdueTasks} uppgifter är sena`, description: 'Börja med att stänga sådant som redan borde ha följts upp.', href: '/crm/uppgifter' });
  }
  if (args.followUpCalls > 0) {
    actions.push({ title: `${args.followUpCalls} samtal behöver nästa steg`, description: 'Logga uppföljning eller konvertera till prospekt om signalen är varm.', href: '/crm/samtal' });
  }
  if (args.quoteFollowUps > 0) {
    actions.push({ title: `${args.quoteFollowUps} offerter väntar uppföljning`, description: 'Stäm av skickade offerter innan de tappar fart i pipen.', href: '/crm/offerter' });
  }
  if (args.newProspects > 0) {
    actions.push({ title: `${args.newProspects} nya prospekt väntar`, description: 'Bra läge att ta första kontakt och flytta dem ur ny-läget.', href: '/crm/prospekt' });
  }
  if (args.standaloneCalls > 0) {
    actions.push({ title: `${args.standaloneCalls} fristående samtal ligger öppna`, description: 'Kontrollera om några av dem ska bli riktiga prospekt.', href: '/crm/samtal' });
  }

  return actions.slice(0, 3);
}

export default function CrmOverview({ role }: { role: UserRole | null }) {
  const items = getVisibleCrmNavItems(role).filter((item) => item.href !== '/crm');
  const [state, setState] = useState<LoadState>({ prospects: [], calls: [], tasks: [], quotes: [], goals: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [prospectsRes, callsRes, tasksRes, quotesRes, goalsRes] = await Promise.all([
          fetch('/api/crm/prospects', { cache: 'no-store' }),
          fetch('/api/crm/calls', { cache: 'no-store' }),
          fetch('/api/crm/tasks', { cache: 'no-store' }),
          fetch('/api/crm/quotes', { cache: 'no-store' }),
          fetch('/api/crm/goals?period_type=week', { cache: 'no-store' }),
        ]);

        const [prospectsJson, callsJson, tasksJson, quotesJson, goalsJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          callsRes.json().catch(() => ({})),
          tasksRes.json().catch(() => ({})),
          quotesRes.json().catch(() => ({})),
          goalsRes.json().catch(() => ({})),
        ]);

        if (!prospectsRes.ok) throw new Error(prospectsJson?.error || 'Kunde inte läsa prospekt.');
        if (!callsRes.ok) throw new Error(callsJson?.error || 'Kunde inte läsa samtal.');
        if (!tasksRes.ok) throw new Error(tasksJson?.error || 'Kunde inte läsa uppgifter.');
        if (!quotesRes.ok) throw new Error(quotesJson?.error || 'Kunde inte läsa offerter.');
        if (!goalsRes.ok) throw new Error(goalsJson?.error || 'Kunde inte läsa mål.');

        if (!active) return;

        setState({
          prospects: Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : [],
          calls: Array.isArray(callsJson?.data?.items) ? callsJson.data.items : [],
          tasks: Array.isArray(tasksJson?.data?.items) ? tasksJson.data.items : [],
          quotes: Array.isArray(quotesJson?.data?.items) ? quotesJson.data.items : [],
          goals: Array.isArray(goalsJson?.data?.items) ? goalsJson.data.items : [],
        });
      } catch (loadError: any) {
        if (!active) return;
        setError(loadError?.message || 'Kunde inte ladda CRM-översikten.');
        setState({ prospects: [], calls: [], tasks: [], quotes: [], goals: [] });
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const openTasks = state.tasks.filter((task) => task.status === 'open');
    const overdueTasks = openTasks.filter(isOverdue);
    const todayTasks = openTasks.filter(isDueToday);
    const recentCalls = state.calls.filter((call) => isWithinLastDays(call.call_at, 7));
    const followUpCalls = state.calls.filter((call) => call.outcome === 'follow_up');
    const standaloneCalls = state.calls.filter((call) => !getProspectFromCall(call));
    const activeQuotes = state.quotes.filter((quote) => quote.status === 'draft' || quote.status === 'sent' || quote.status === 'follow_up');
    const quoteFollowUps = state.quotes.filter((quote) => quote.status === 'follow_up');
    const wonQuotes = state.quotes.filter((quote) => quote.status === 'won');
    const recentQuotes = state.quotes.filter((quote) => isWithinLastDays(quote.quote_date, 7));
    const quoteValueLast7Days = recentQuotes.reduce((total, quote) => {
      const numeric = typeof quote.amount === 'number' ? quote.amount : Number(String(quote.amount));
      return total + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
    const pipelineProspects = state.prospects.filter(isPipelineProspect);
    const newProspects = state.prospects.filter((prospect) => prospect.status === 'new');
    const qualifiedProspects = state.prospects.filter((prospect) => prospect.status === 'qualified' || prospect.status === 'quoted');
    const wonProspects = state.prospects.filter((prospect) => prospect.status === 'won');
    const callsTarget = state.goals.reduce((total, goal) => total + goal.calls_target, 0);
    const quotesTarget = state.goals.reduce((total, goal) => total + goal.quotes_target, 0);
    const quoteValueTarget = state.goals.reduce((total, goal) => total + Number(goal.quote_value_target || 0), 0);

    return {
      prospectsTotal: state.prospects.length,
      pipelineProspects: pipelineProspects.length,
      newProspects: newProspects.length,
      qualifiedProspects: qualifiedProspects.length,
      wonProspects: wonProspects.length,
      callsLast7Days: recentCalls.length,
      followUpCalls: followUpCalls.length,
      standaloneCalls: standaloneCalls.length,
      activeQuotes: activeQuotes.length,
      quoteFollowUps: quoteFollowUps.length,
      wonQuotes: wonQuotes.length,
      quotesLast7Days: recentQuotes.length,
      quoteValueLast7Days,
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
      todayTasks: todayTasks.length,
      callsTarget,
      quotesTarget,
      quoteValueTarget,
    };
  }, [state.calls, state.goals, state.prospects, state.quotes, state.tasks]);

  const recentProspects = useMemo(() => [...state.prospects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3), [state.prospects]);
  const recentCalls = useMemo(() => [...state.calls].sort((a, b) => b.call_at.localeCompare(a.call_at)).slice(0, 3), [state.calls]);
  const recentQuotes = useMemo(() => [...state.quotes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3), [state.quotes]);
  const nextTasks = useMemo(() => [...state.tasks].filter((task) => task.status === 'open').sort(sortTasks).slice(0, 3), [state.tasks]);
  const prospectNames = useMemo(() => Object.fromEntries(state.prospects.map((prospect) => [prospect.id, prospect.company_name])), [state.prospects]);
  const nextActions = buildOverviewActions({ overdueTasks: summary.overdueTasks, followUpCalls: summary.followUpCalls, newProspects: summary.newProspects, standaloneCalls: summary.standaloneCalls, quoteFollowUps: summary.quoteFollowUps });
  const teamLeaderboard = useMemo(() => {
    const callsByUser = new Map<string, number>();
    const quotesByUser = new Map<string, number>();
    const quoteValueByUser = new Map<string, number>();

    for (const call of state.calls) {
      callsByUser.set(call.user_id, (callsByUser.get(call.user_id) || 0) + 1);
    }

    for (const quote of state.quotes) {
      quotesByUser.set(quote.assigned_to, (quotesByUser.get(quote.assigned_to) || 0) + 1);
      const numericAmount = typeof quote.amount === 'number' ? quote.amount : Number(String(quote.amount));
      quoteValueByUser.set(
        quote.assigned_to,
        (quoteValueByUser.get(quote.assigned_to) || 0) + (Number.isFinite(numericAmount) ? numericAmount : 0),
      );
    }

    return state.goals
      .filter(hasActiveGoalTarget)
      .map((goal) => {
        const user = getGoalUser(goal.user);
        const callsDone = callsByUser.get(goal.user_id) || 0;
        const quotesDone = quotesByUser.get(goal.user_id) || 0;
        const quoteValueDone = quoteValueByUser.get(goal.user_id) || 0;
        const progressValues = [
          goal.calls_target > 0 ? callsDone / goal.calls_target : null,
          goal.quotes_target > 0 ? quotesDone / goal.quotes_target : null,
          Number(goal.quote_value_target) > 0 ? quoteValueDone / Number(goal.quote_value_target) : null,
        ].filter((value): value is number => value != null);
        const progressScore = progressValues.length > 0
          ? progressValues.reduce((total, value) => total + value, 0) / progressValues.length
          : 0;

        return {
          id: goal.id,
          userId: goal.user_id,
          userName: user?.full_name || 'Okänd användare',
          role: user?.role || 'sales',
          callsDone,
          callsTarget: goal.calls_target,
          quotesDone,
          quotesTarget: goal.quotes_target,
          quoteValueDone,
          quoteValueTarget: Number(goal.quote_value_target) || 0,
          progressScore,
        };
      })
      .sort((left, right) => {
        if (right.progressScore !== left.progressScore) return right.progressScore - left.progressScore;
        if (right.callsDone !== left.callsDone) return right.callsDone - left.callsDone;
        return left.userName.localeCompare(right.userName, 'sv');
      });
  }, [state.calls, state.goals, state.quotes]);
  return (
    <div className="grid gap-3">
      <SectionCard className="grid gap-2.5 overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.24),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.18),_transparent_28%),linear-gradient(135deg,_#f6fbf4,_#e4f4e8_52%,_#f3faf4)] p-3 md:p-3.5 xl:p-4">
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.76fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.78fr)]">
          <div className="grid gap-2.5">
            <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">CRM / Översikt</span>
                <div className="grid gap-1">
                  <h1 className="m-0 max-w-[11ch] text-[clamp(1.55rem,2.25vw,2.45rem)] font-bold tracking-[-0.045em] text-slate-950">Dagens läge och nästa steg</h1>
                  <p className="m-0 max-w-4xl text-[12px] leading-5 text-slate-600 md:text-[13px] md:leading-5">
                    Översikten ska styra blicken till rätt arbete först. Därför lyfter den nu fram pipen, uppföljningar, mål och de delar som kräver ett beslut eller nästa steg.
                  </p>
                </div>
            </div>
              <div className="flex flex-wrap gap-1.5 xl:justify-end">
                <Link href="/crm/samtal" className="inline-flex min-h-9 items-center rounded-full border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-[12px] font-semibold text-white no-underline transition hover:bg-slate-950">
                  Logga samtal
                </Link>
                <Link href="/crm/uppgifter" className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 no-underline transition hover:border-slate-300 hover:bg-slate-50">
                  Öppna uppgifter
                </Link>
                <Link href="/crm/prospekt" className="inline-flex min-h-9 items-center rounded-full border border-white/70 bg-white/75 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 no-underline transition hover:border-slate-300 hover:bg-white">
                  Gå till pipen
                </Link>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              <OverviewMetricCard label="Prospekt i pipen" value={summary.pipelineProspects} helper={`${summary.newProspects} nya · ${summary.qualifiedProspects} varma`} tone="teal" />
              <OverviewMetricCard label="Samtal senaste 7 dagar" value={summary.callsLast7Days} helper={summary.callsTarget > 0 ? `${summary.callsLast7Days}/${summary.callsTarget} mot veckomål` : `${summary.followUpCalls} kräver nästa steg`} tone="sky" />
              <OverviewMetricCard label="Öppna uppgifter" value={summary.openTasks} helper={summary.overdueTasks > 0 ? `${summary.overdueTasks} sena just nu` : `${summary.todayTasks} förfaller idag`} tone="amber" />
              <OverviewMetricCard label="Offerter senaste 7 dagar" value={summary.quotesLast7Days} helper={summary.quotesTarget > 0 ? `${summary.quotesLast7Days}/${summary.quotesTarget} mot veckomål` : `${summary.quoteFollowUps} väntar uppföljning`} tone="emerald" />
            </div>
          </div>

          <div className="grid gap-2 rounded-[22px] border border-slate-200/60 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(30,41,59,0.96))] p-2.5 text-white shadow-[0_24px_44px_rgba(15,23,42,0.22)] xl:self-stretch">
            <div className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-100/75">Operativ puls</span>
              <strong className="text-[15px] font-bold tracking-[-0.03em] text-white">Läs detta först</strong>
              <p className="m-0 text-[12px] leading-5 text-slate-300">
                Snabb sammanfattning av det som faktiskt påverkar dagen: rörelse i pipen, uppföljningar och hur långt teamet ligger från veckomålen.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <DashboardPulseCard title="Pipeline" value={`${summary.pipelineProspects}`} helper={summary.newProspects > 0 ? `${summary.newProspects} nya att ta först` : 'Ingen ny lead i kö just nu'} />
              <DashboardPulseCard title="Följ upp" value={`${summary.followUpCalls + summary.quoteFollowUps}`} helper={summary.followUpCalls > 0 ? `${summary.followUpCalls} samtal behöver nästa steg` : 'Samtal är under kontroll'} />
              <DashboardPulseCard title="Måltryck" value={summary.quoteValueTarget > 0 ? `${Math.round((summary.quoteValueLast7Days / summary.quoteValueTarget) * 100)}%` : '–'} helper={summary.quoteValueTarget > 0 ? `${formatCurrency(summary.quoteValueLast7Days, 'SEK')} av ${formatCurrency(summary.quoteValueTarget, 'SEK')}` : 'Inget veckomål satt än'} />
            </div>

            <div className="grid gap-2 rounded-[18px] border border-white/10 bg-white/5 p-2.5 text-sm text-slate-200">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-white">Dagens fokus</span>
                <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-100">Live</span>
              </div>
              <div className="grid gap-2">
                <DashboardSignalRow label="Sena uppgifter" value={summary.overdueTasks} tone="rose" />
                <DashboardSignalRow label="Varma prospekt" value={summary.qualifiedProspects} tone="sky" />
                <DashboardSignalRow label="Vunna prospekt" value={summary.wonProspects} tone="emerald" />
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {error ? (
        <SectionCard className="grid gap-2 border-rose-200 bg-rose-50 p-5 text-rose-900">
          <strong className="text-sm font-semibold">CRM-översikten kunde inte laddas</strong>
          <p className="m-0 text-sm leading-6">{error}</p>
        </SectionCard>
      ) : null}

      <div className="grid items-start gap-2.5 2xl:grid-cols-[minmax(0,1.16fr)_minmax(300px,0.62fr)]">
        <div className="grid gap-2.5">
          <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.92fr)]">
            <SectionCard className={`${overviewPanelClass} self-start`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Att agera på</span>
                  <strong className="text-lg font-bold tracking-[-0.02em] text-slate-900">Nästa fokus</strong>
                </div>
                <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">{nextActions.length} prioriterade spår</span>
              </div>

              {loading ? <OverviewLoadingRows /> : null}
              {!loading && nextActions.length === 0 ? <div className="rounded-[20px] border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-950">Läget är lugnt just nu. Det finns inget som sticker ut som blockerande i CRM-flödet.</div> : null}
              {!loading && nextActions.length > 0 ? (
                <div className="grid gap-2.5">
                  {nextActions.map((action) => (
                    <Link key={action.title} href={action.href} className="rounded-[18px] border border-slate-300 bg-white p-3 no-underline shadow-[0_12px_24px_rgba(15,23,42,0.07)] ring-1 ring-white/80 transition-[transform,border-color,box-shadow,background-color] hover:-translate-y-0.5 hover:border-teal-400 hover:bg-white hover:shadow-[0_18px_32px_rgba(15,118,110,0.14)]">
                      <div className="grid gap-1">
                        <strong className="text-[14px] font-semibold text-slate-950">{action.title}</strong>
                        <p className="m-0 text-sm leading-5 text-slate-700">{action.description}</p>
                        <span className="text-[13px] font-semibold text-teal-800">Öppna</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
            </SectionCard>

            <SectionCard className={`${overviewPanelClass} self-start`}>
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Statusbild</span>
                <strong className="text-lg font-bold tracking-[-0.02em] text-slate-950">Fördelning och mål</strong>
              </div>
              {loading ? <OverviewLoadingRows /> : null}
              {!loading ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <StatusStrip label="Samtal mot mål" value={summary.callsLast7Days} goal={summary.callsTarget} tone="sky" />
                  <StatusStrip label="Offerter mot mål" value={summary.quotesLast7Days} goal={summary.quotesTarget} tone="emerald" />
                  <StatusStrip label="Offertvärde mot mål" value={summary.quoteValueLast7Days} goal={summary.quoteValueTarget} tone="teal" currency />
                  <StatusStrip label="Nya prospekt" value={summary.newProspects} tone="slate" />
                  <StatusStrip label="Varma prospekt" value={summary.qualifiedProspects} tone="sky" />
                  <StatusStrip label="Offerter att följa upp" value={summary.quoteFollowUps} tone="amber" />
                  <StatusStrip label="Följ upp-samtal" value={summary.followUpCalls} tone="amber" />
                  <StatusStrip label="Sena uppgifter" value={summary.overdueTasks} tone="rose" />
                </div>
              ) : null}
            </SectionCard>
          </div>

          <div className="2xl:hidden">
            <LeaderboardPanel loading={loading} teamLeaderboard={teamLeaderboard} />
          </div>

          <div className="mt-1 grid gap-x-2.5 gap-y-4 border-t border-slate-200/80 pt-3 xl:grid-cols-2 xl:gap-y-5 xl:pt-3.5">
            <SectionCard className={`${overviewPanelClass} h-full`}>
          <SectionHeader title="Senaste prospekt" href="/crm/prospekt" />
          {loading ? <OverviewLoadingRows /> : null}
          {!loading && recentProspects.length === 0 ? <EmptyState text="Inga prospekt ännu." /> : null}
          {!loading && recentProspects.length > 0 ? (
            <div className="grid gap-2.5">
              {recentProspects.map((prospect) => (
                <Link key={prospect.id} href="/crm/prospekt" className={overviewItemCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[15px] font-semibold text-slate-950">{prospect.company_name}</strong>
                      <p className="m-0 truncate text-sm text-slate-700">{[prospect.contact_name, prospect.city, prospect.source].filter(Boolean).join(' • ') || 'Ingen extra info ännu'}</p>
                    </div>
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">{prospectStatusLabel[prospect.status]}</span>
                  </div>
                  <span className="mt-2 block text-xs font-medium text-slate-500">Uppdaterad {formatDateTime(prospect.updated_at)}</span>
                </Link>
              ))}
            </div>
          ) : null}
            </SectionCard>

            <SectionCard className={`${overviewPanelClass} h-full`}>
          <SectionHeader title="Senaste samtal" href="/crm/samtal" />
          {loading ? <OverviewLoadingRows /> : null}
          {!loading && recentCalls.length === 0 ? <EmptyState text="Inga samtal loggade ännu." /> : null}
          {!loading && recentCalls.length > 0 ? (
            <div className="grid gap-2.5">
              {recentCalls.map((call) => (
                <Link key={call.id} href="/crm/samtal" className={overviewItemCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[15px] font-semibold text-slate-950">{getCallCompanyName(call)}</strong>
                      <span className="text-xs font-medium text-slate-500">{formatDateTime(call.call_at)}</span>
                    </div>
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">{outcomeLabel[call.outcome]}</span>
                  </div>
                  <div className="mt-2 grid gap-1">
                    <p className="m-0 truncate text-sm text-slate-700">{call.summary}</p>
                    {call.next_step ? <p className="m-0 truncate text-xs font-medium text-slate-500">Nästa steg: {call.next_step}</p> : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
            </SectionCard>

            <SectionCard className={`${overviewPanelClass} h-full`}>
          <SectionHeader title="Öppna uppgifter" href="/crm/uppgifter" />
          {loading ? <OverviewLoadingRows /> : null}
          {!loading && nextTasks.length === 0 ? <EmptyState text="Inga öppna uppgifter just nu." /> : null}
          {!loading && nextTasks.length > 0 ? (
            <div className="grid gap-2.5">
              {nextTasks.map((task) => (
                <Link key={task.id} href="/crm/uppgifter" className={overviewItemCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[15px] font-semibold text-slate-950">{task.title}</strong>
                      <p className="m-0 truncate text-sm text-slate-700">{task.prospect_id ? prospectNames[task.prospect_id] || 'Kopplat prospekt' : task.source || 'Allmän CRM-uppgift'}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${taskPriorityClass[task.priority]}`}>{taskPriorityLabel[task.priority]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
                    <span>{formatDate(task.due_date)}</span>
                    {task.remind_at ? <span className="truncate">Påminnelse {formatDateTime(task.remind_at)}</span> : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
            </SectionCard>

            <SectionCard className={`${overviewPanelClass} h-full`}>
          <SectionHeader title="Senaste offerter" href="/crm/offerter" />
          {loading ? <OverviewLoadingRows /> : null}
          {!loading && recentQuotes.length === 0 ? <EmptyState text="Inga offerter registrerade ännu." /> : null}
          {!loading && recentQuotes.length > 0 ? (
            <div className="grid gap-2.5">
              {recentQuotes.map((quote) => (
                <Link key={quote.id} href="/crm/offerter" className={overviewItemCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[15px] font-semibold text-slate-950">{quote.project_name}</strong>
                      <p className="m-0 truncate text-sm text-slate-700">{getQuoteCustomerName(quote)}</p>
                    </div>
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">{quoteStatusLabel[quote.status]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
                    <span>{formatCurrency(quote.amount, quote.currency_code)}</span>
                    <span>{formatDate(quote.quote_date)}</span>
                    {quote.follow_up_date ? <span className="truncate">Följ upp {formatDate(quote.follow_up_date)}</span> : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
            </SectionCard>
          </div>
        </div>

        <div className="hidden 2xl:block">
          <LeaderboardPanel loading={loading} teamLeaderboard={teamLeaderboard} />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="no-underline">
            <SectionCard className="grid h-full gap-2 rounded-[22px] border-slate-200 p-4 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_16px_34px_rgba(15,118,110,0.12)]">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">CRM-sektion</span>
              <strong className="text-lg font-bold tracking-[-0.02em] text-slate-900">{item.label}</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">{item.description}</p>
              <span className="text-sm font-semibold text-teal-700">Öppna</span>
            </SectionCard>
          </Link>
        ))}
      </div>
    </div>
  );
}

function OverviewMetricCard({ label, value, helper, tone }: { label: string; value: number; helper: string; tone: 'teal' | 'sky' | 'amber' | 'emerald' }) {
  const toneClass = {
    teal: 'border-teal-200 bg-white/90 text-teal-900',
    sky: 'border-sky-200 bg-white/90 text-sky-900',
    amber: 'border-amber-200 bg-white/90 text-amber-900',
    emerald: 'border-emerald-200 bg-white/90 text-emerald-900',
  }[tone];

  return (
    <div className={`grid gap-1 rounded-[16px] border p-2.5 shadow-[0_14px_26px_rgba(15,23,42,0.05)] ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</span>
      <strong className="text-[clamp(1.3rem,1.9vw,1.8rem)] font-bold tracking-[-0.035em]">{value}</strong>
      <span className="text-[12px] leading-5 opacity-80">{helper}</span>
    </div>
  );
}

function DashboardPulseCard({ title, value, helper }: { title: string; value: string; helper: string }) {
  return (
    <div className="grid gap-1 rounded-[16px] border border-white/10 bg-white/5 px-2.5 py-2 backdrop-blur-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">{title}</span>
      <strong className="text-[15px] font-bold tracking-[-0.03em] text-white">{value}</strong>
      <span className="text-xs leading-5 text-slate-300">{helper}</span>
    </div>
  );
}

function DashboardSignalRow({ label, value, tone }: { label: string; value: number; tone: 'rose' | 'sky' | 'emerald' }) {
  const toneClass = {
    rose: 'bg-rose-400',
    sky: 'bg-sky-400',
    emerald: 'bg-emerald-400',
  }[tone];

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm text-slate-200">
        <span>{label}</span>
        <strong className="text-white">{value}</strong>
      </div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div className={`h-1.5 rounded-full ${toneClass}`} style={{ width: `${Math.max(value === 0 ? 12 : Math.min(100, value * 16), 12)}%` }} />
      </div>
    </div>
  );
}

function LeaderboardPanel({
  loading,
  teamLeaderboard,
}: {
  loading: boolean;
  teamLeaderboard: Array<{
    id: string;
    userName: string;
    role: string;
    callsDone: number;
    callsTarget: number;
    quotesDone: number;
    quotesTarget: number;
    quoteValueDone: number;
    quoteValueTarget: number;
    progressScore: number;
  }>;
}) {
  return (
    <SectionCard className={overviewPanelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Teamöversikt</span>
          <strong className="text-lg font-bold tracking-[-0.02em] text-slate-900">Topplista mot veckomål</strong>
        </div>
        <Link href="/crm/installningar" className="text-sm font-semibold text-teal-700 no-underline">Justera mål</Link>
      </div>

      {loading ? <OverviewLoadingRows /> : null}
      {!loading && teamLeaderboard.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm font-medium text-slate-700">
          Inga veckomål är satta ännu. Lägg in mål i Inställningar för att låsa upp teamöversikt och topplista.
        </div>
      ) : null}
      {!loading && teamLeaderboard.length > 0 ? (
        <div className="grid gap-2.5 2xl:max-h-[960px] 2xl:overflow-y-auto 2xl:pr-1">
          {teamLeaderboard.map((entry, index) => (
            <div key={entry.id} className="grid gap-2 rounded-[18px] border border-slate-300 bg-white p-2.5 shadow-[0_12px_22px_rgba(15,23,42,0.07)] ring-1 ring-white/80">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700">#{index + 1}</span>
                    <strong className="text-sm font-semibold text-slate-950">{entry.userName}</strong>
                  </div>
                  <p className="m-0 text-[12px] text-slate-600">{entry.role === 'admin' ? 'Admin' : 'Sälj'} med aktivt veckomål</p>
                </div>
                <span className="rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
                  {Math.round(entry.progressScore * 100)}%
                </span>
              </div>

              <div className="grid gap-1.5 text-sm text-slate-600">
                <TeamProgressRow label="Samtal" value={entry.callsDone} target={entry.callsTarget} tone="sky" />
                <TeamProgressRow label="Offerter" value={entry.quotesDone} target={entry.quotesTarget} tone="emerald" />
                <TeamProgressRow label="Offertvärde" value={entry.quoteValueDone} target={entry.quoteValueTarget} tone="teal" currency />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3">
      <strong className="text-lg font-bold leading-tight tracking-[-0.02em] text-slate-950">{title}</strong>
      <Link href={href} className="text-sm font-semibold text-teal-800 no-underline hover:text-teal-900">Visa alla</Link>
    </div>
  );
}

function StatusStrip({ label, value, tone, goal, currency = false }: { label: string; value: number; tone: 'slate' | 'sky' | 'amber' | 'rose' | 'emerald' | 'teal'; goal?: number; currency?: boolean }) {
  const toneClass = {
    slate: 'bg-slate-900',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    emerald: 'bg-emerald-500',
    teal: 'bg-teal-500',
  }[tone];

  const width = goal && goal > 0
    ? value <= 0 ? 0 : Math.min(100, (value / goal) * 100)
    : value <= 0 ? 0 : Math.min(100, value * 16);
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayGoal = goal != null && goal > 0
    ? currency ? formatCurrency(goal, 'SEK') : String(goal)
    : null;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
        <span>{label}</span>
        <strong className="text-slate-950">{displayGoal ? `${displayValue} / ${displayGoal}` : displayValue}</strong>
      </div>
      <div className="h-2 rounded-full bg-slate-200/90">
        <div className={`h-2 rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function OverviewLoadingRows() {
  return (
    <div className="grid gap-2.5">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-[22px] border border-slate-200 bg-slate-100" />
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="m-0 rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-medium leading-6 text-slate-700">{text}</p>;
}

function TeamProgressRow({ label, value, target, tone, currency = false }: { label: string; value: number; target: number; tone: 'sky' | 'emerald' | 'teal'; currency?: boolean }) {
  const toneClass = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    teal: 'bg-teal-500',
  }[tone];

  const width = target > 0
    ? value <= 0 ? 0 : Math.min(100, (value / target) * 100)
    : 0;
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayTarget = currency ? formatCurrency(target, 'SEK') : target;

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2 text-[12px] text-slate-700">
        <span>{label}</span>
        <strong className="text-slate-950">{displayValue} / {displayTarget}</strong>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200/90">
        <div className={`h-1.5 rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}