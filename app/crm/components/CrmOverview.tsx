"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import EmptyState from '../../../components/ui/EmptyState';
import MetricCard from './MetricCard';
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
    actions.push({ title: `${args.quoteFollowUps} offertlägen väntar uppföljning`, description: 'Stäm av prospekt där offerten behöver nästa steg innan affären tappar fart.', href: '/crm/offerter' });
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
    const quotedProspects = state.prospects.filter((prospect) => prospect.status === 'quoted');
    const qualifiedProspects = state.prospects.filter((prospect) => prospect.status === 'qualified' || prospect.status === 'quoted');
    const wonProspects = state.prospects.filter((prospect) => prospect.status === 'won');
    const callsTarget = state.goals.reduce((total, goal) => total + goal.calls_target, 0);
    const quotesTarget = state.goals.reduce((total, goal) => total + goal.quotes_target, 0);
    const quoteValueTarget = state.goals.reduce((total, goal) => total + Number(goal.quote_value_target || 0), 0);

    return {
      prospectsTotal: state.prospects.length,
      pipelineProspects: pipelineProspects.length,
      newProspects: newProspects.length,
      quotedProspects: quotedProspects.length,
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
    <div className="grid gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Dashboard Overview</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Välkommen tillbaka! Här är vad som händer i ditt CRM idag.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/crm/samtal"
            className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white no-underline transition"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            + Logga samtal
          </Link>
          <Link
            href="/crm/uppgifter"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 no-underline transition hover:border-slate-300"
          >
            Öppna uppgifter
          </Link>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-100 bg-white" />
            ))}
          </>
        ) : (
          <>
            <MetricCard
              label="Öppna prospekt"
              value={summary.pipelineProspects}
              helper={`${summary.newProspects} nya · ${summary.qualifiedProspects} varma`}
              icon={<ProspectIcon />}
              iconBg="bg-emerald-100"
            />
            <MetricCard
              label="Samtal senaste 7 dagar"
              value={summary.callsLast7Days}
              helper={summary.callsTarget > 0 ? `${summary.callsLast7Days}/${summary.callsTarget} mot mål` : `${summary.followUpCalls} kräver nästa steg`}
              icon={<CallIcon />}
              iconBg="bg-blue-100"
            />
            <MetricCard
              label="Öppna uppgifter"
              value={summary.openTasks}
              helper={summary.overdueTasks > 0 ? `${summary.overdueTasks} sena just nu` : `${summary.todayTasks} förfaller idag`}
              icon={<TaskIcon />}
              iconBg="bg-purple-100"
            />
            <MetricCard
              label="Prospekt i offertläge"
              value={summary.quotedProspects}
              helper={summary.quoteFollowUps > 0 ? `${summary.quoteFollowUps} väntar uppföljning` : 'Inga blockerande offertlägen'}
              icon={<QuoteIcon />}
              iconBg="bg-orange-100"
            />
          </>
        )}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong className="font-semibold">Kunde inte ladda översikten</strong>
          <p className="m-0 mt-1">{error}</p>
        </div>
      ) : null}

      {/* Main content grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.6fr)]">
        <div className="grid gap-4">
          {/* Next actions */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Att agera på</p>
                <h2 className="m-0 mt-0.5 text-lg font-bold tracking-tight text-slate-900">Nästa fokus</h2>
              </div>
              {!loading && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {nextActions.length} prioriterade
                </span>
              )}
            </div>
            {loading ? <OverviewLoadingRows /> : null}
            {!loading && nextActions.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                Läget är lugnt — inget blockerande i CRM-flödet just nu.
              </div>
            ) : null}
            {!loading && nextActions.length > 0 ? (
              <div className="grid gap-2">
                {nextActions.map((action) => (
                  <Link
                    key={action.title}
                    href={action.href}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 no-underline transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="grid gap-0.5">
                      <strong className="text-sm font-semibold text-slate-900">{action.title}</strong>
                      <p className="m-0 text-xs leading-5 text-slate-500">{action.description}</p>
                    </div>
                    <span className="mt-0.5 shrink-0 text-xs font-semibold text-emerald-700">Öppna →</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {/* Recent items grid */}
          <div className="grid gap-4 xl:grid-cols-2">
            <RecentCard title="Senaste prospekt" href="/crm/prospekt" loading={loading}>
              {recentProspects.length === 0 ? <EmptyState description="Inga prospekt ännu." /> : (
                <div className="grid gap-2">
                  {recentProspects.map((prospect) => (
                    <Link key={prospect.id} href="/crm/prospekt" className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{prospect.company_name}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{[prospect.contact_name, prospect.city, prospect.source].filter(Boolean).join(' · ') || 'Ingen extra info'}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{prospectStatusLabel[prospect.status]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Senaste samtal" href="/crm/samtal" loading={loading}>
              {recentCalls.length === 0 ? <EmptyState description="Inga samtal loggade ännu." /> : (
                <div className="grid gap-2">
                  {recentCalls.map((call) => (
                    <Link key={call.id} href="/crm/samtal" className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{getCallCompanyName(call)}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{formatDateTime(call.call_at)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{outcomeLabel[call.outcome]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Öppna uppgifter" href="/crm/uppgifter" loading={loading}>
              {nextTasks.length === 0 ? <EmptyState description="Inga öppna uppgifter just nu." /> : (
                <div className="grid gap-2">
                  {nextTasks.map((task) => (
                    <Link key={task.id} href="/crm/uppgifter" className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{task.title}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{formatDate(task.due_date)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${taskPriorityClass[task.priority]}`}>{taskPriorityLabel[task.priority]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Senaste offertlägen" href="/crm/offerter" loading={loading}>
              {recentQuotes.length === 0 ? <EmptyState description="Inga offertsteg registrerade ännu." /> : (
                <div className="grid gap-2">
                  {recentQuotes.map((quote) => (
                    <Link key={quote.id} href="/crm/offerter" className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{quote.project_name}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{getQuoteCustomerName(quote)} · {formatCurrency(quote.amount, quote.currency_code)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{quoteStatusLabel[quote.status]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>
          </div>
        </div>

        {/* Right column: status + leaderboard */}
        <div className="grid gap-4">
          {/* Status strips */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Statusbild</p>
            <h2 className="m-0 mb-4 mt-0.5 text-lg font-bold tracking-tight text-slate-900">Fördelning och mål</h2>
            {loading ? <OverviewLoadingRows /> : (
              <div className="grid gap-3">
                <StatusStrip label="Öppna prospekt" value={summary.pipelineProspects} tone="teal" />
                <StatusStrip label="Nya prospekt" value={summary.newProspects} tone="slate" />
                <StatusStrip label="Prospekt i offertläge" value={summary.quotedProspects} tone="amber" />
                <StatusStrip label="Vunna prospekt" value={summary.wonProspects} tone="emerald" />
                <StatusStrip label="Samtal mot mål" value={summary.callsLast7Days} goal={summary.callsTarget} tone="sky" />
                <StatusStrip label="Offerter mot mål" value={summary.quotesLast7Days} goal={summary.quotesTarget} tone="emerald" />
                <StatusStrip label="Sena uppgifter" value={summary.overdueTasks} tone="rose" />
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <LeaderboardPanel loading={loading} teamLeaderboard={teamLeaderboard} />
        </div>
      </div>

      {/* Quick nav */}
      {items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="no-underline">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
                <p className="m-0 text-xs font-semibold uppercase tracking-widest text-slate-400">CRM-sektion</p>
                <strong className="mt-1 block text-base font-bold text-slate-900">{item.label}</strong>
                <p className="m-0 mt-1 text-sm leading-5 text-slate-500">{item.description}</p>
                <span className="mt-2 block text-sm font-semibold text-emerald-700">Öppna →</span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RecentCard({ title, href, loading, children }: { title: string; href: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <strong className="text-sm font-bold text-slate-900">{title}</strong>
        <Link href={href} className="text-xs font-semibold text-emerald-700 no-underline hover:text-emerald-800">Visa alla</Link>
      </div>
      {loading ? <OverviewLoadingRows /> : children}
    </div>
  );
}

function OverviewLoadingRows() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
      ))}
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
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span>{label}</span>
        <strong className="text-slate-800">{displayGoal ? `${displayValue} / ${displayGoal}` : displayValue}</strong>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full transition-all ${toneClass}`} style={{ width: `${width}%` }} />
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Teamöversikt</p>
          <h2 className="m-0 mt-0.5 text-lg font-bold tracking-tight text-slate-900">Topplista</h2>
        </div>
        <Link href="/crm/installningar" className="text-xs font-semibold text-emerald-700 no-underline hover:text-emerald-800">Justera mål</Link>
      </div>
      {loading ? <OverviewLoadingRows /> : null}
      {!loading && teamLeaderboard.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
          Inga veckomål satta ännu. Lägg in mål i Inställningar för att aktivera topplistan.
        </div>
      ) : null}
      {!loading && teamLeaderboard.length > 0 ? (
        <div className="grid gap-2">
          {teamLeaderboard.map((entry, index) => (
            <div key={entry.id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">#{index + 1}</span>
                  <strong className="text-sm font-semibold text-slate-900">{entry.userName}</strong>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {Math.round(entry.progressScore * 100)}%
                </span>
              </div>
              <div className="mt-2 grid gap-1">
                <TeamProgressRow label="Samtal" value={entry.callsDone} target={entry.callsTarget} tone="sky" />
                <TeamProgressRow label="Offerter" value={entry.quotesDone} target={entry.quotesTarget} tone="emerald" />
                <TeamProgressRow label="Offertvärde" value={entry.quoteValueDone} target={entry.quoteValueTarget} tone="teal" currency />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
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
    <div className="grid gap-0.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{label}</span>
        <strong className="text-slate-700">{displayValue} / {displayTarget}</strong>
      </div>
      <div className="h-1 rounded-full bg-slate-100">
        <div className={`h-1 rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ProspectIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
