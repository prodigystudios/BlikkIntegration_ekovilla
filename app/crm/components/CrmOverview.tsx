"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../../../components/ui/EmptyState';
import MetricCard from './MetricCard';
import ChangelogCard from './ChangelogCard';
import type { UserRole } from '@/lib/roles';
import { cn } from '@/lib/shared/cn';
import { crm, quoteStatusMeta, workOrderStatusClass, workOrderStatusLabel, type QuoteStatus, type WorkOrderStatus } from '@/app/crm/lib/crmTokens';
import { getCrmOverviewWindow, weeklyFromMonthly } from '@/lib/domains/crm/goals';
import { daysSince, formatRelativeTime } from '@/lib/shared/relativeTime';
import type { CrmOverviewSummary } from '@/lib/domains/crm/overviewSummary';

type ProspectStatus = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';

type CallProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  source: string | null;
  status: ProspectStatus;
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
  status: ProspectStatus;
};

type QuoteItem = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  project_name: string;
  amount: number | string;
  currency_code: string;
  status: QuoteStatus;
  quote_date: string;
  follow_up_date: string | null;
  assigned_to: string;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type WorkOrderItem = {
  id: string;
  project_name: string;
  client_name: string;
  amount: number | string;
  currency_code: string;
  status: WorkOrderStatus;
  assigned_to: string;
  created_at: string;
  fortnox_invoiced_at: string | null;
};

// The page's numbers come pre-counted from /api/crm/overview; the lists are only what the four
// "senaste …"-cards render, five rows each. Counting list rows in the browser is what this
// replaced — see lib/domains/crm/overviewSummary.ts for why that could not hold.
type LoadState = {
  summary: CrmOverviewSummary | null;
  calls: CallItem[];
  tasks: TaskItem[];
  quotes: QuoteItem[];
  goals: GoalItem[];
  workOrders: WorkOrderItem[];
  // Vilka hämtningar som inte gick att läsa. Varje sektion föder sin egen yta, så ett fel i en
  // av dem släcker den ytan och inget mer. Tidigare kastade fyra av sex hämtningar och
  // catch-grenen nollställde HELA state: en blinkande /api/crm/goals tog offertlistan,
  // orderlistan och statusbilden med sig. Arbetsorderhämtningen hade redan undantaget — det
  // här är samma tolerans, för alla.
  failed: SectionKey[];
};

type SectionKey = 'summary' | 'calls' | 'tasks' | 'quotes' | 'goals' | 'workOrders';

// Enda stället ordningen bestäms. Både hämtningarna och failed-listan itererar den här, så de
// kan inte glida isär — och Record<SectionKey, string> nedan gör att en ny sektion inte kan
// läggas till utan att också få en URL.
const SECTION_ORDER: SectionKey[] = ['summary', 'calls', 'tasks', 'quotes', 'goals', 'workOrders'];

const sectionLabel: Record<SectionKey, string> = {
  summary: 'siffrorna',
  calls: 'samtal',
  tasks: 'uppgifter',
  quotes: 'offerter',
  goals: 'mål',
  workOrders: 'arbetsordrar',
};

type Section = { ok: boolean; json: any };

// Ett avvisat löfte och ett icke-ok svar är samma sak här: sektionen gick inte att läsa.
//
// `undefined` som sentinel, inte null: ett svar vars KROPP inte gick att tolka är lika olästbart
// som en 500:a. Utan den skillnaden gav en 200 med trasig kropp ok:true och json:null, summeringen
// föll tillbaka på EMPTY_SUMMARY, och sidan visade "0 kr" och "Läget är lugnt" UTAN felruta —
// exakt den okänt-som-säker-nolla grenen finns för att ta bort.
async function readSection(result: PromiseSettledResult<Response>): Promise<Section> {
  if (result.status !== 'fulfilled') return { ok: false, json: null };
  const json = await result.value.json().catch(() => undefined);
  return { ok: result.value.ok && json !== undefined, json: json ?? null };
}

function itemsOf<T>(section: Section): T[] {
  return section.ok && Array.isArray(section.json?.data?.items) ? section.json.data.items : [];
}

type GoalUser = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'member' | 'konsult';
};

type GoalItem = {
  id: string;
  user_id: string;
  period_type: 'week' | 'month';
  period_start: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
  order_count_target: number;
  order_value_target: number | string;
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
  return goal.calls_target > 0 || goal.quotes_target > 0 || Number(goal.quote_value_target) > 0
    || goal.order_count_target > 0 || Number(goal.order_value_target) > 0;
}

// Rows per "senaste …" card. Five fills the column next to the status panel and the leaderboard
// without turning the overview into a list page — the cards' own "Visa alla" leads there.
const RECENT_ITEM_LIMIT = 5;

// Samma mening på båda ställena den behövs: bandet och statusbilden visar båda nettobelopp, och
// båda utelämnar avbrutna order — stockraderna genom sina statuslistor (OPEN_/TO_INVOICE_ i
// overviewSummary), veckoraden genom isDeadWorkOrder-vakten. Delad konstant så de inte glider isär.
const MONEY_NOTE = 'Belopp exklusive moms. Avbrutna order räknas inte.';

// Efter så här många dygn utan loggat samtal säger kortet ifrån. Sju för att veckomålet är
// teamets mätperiod — en vecka utan ett enda loggat samtal är redan utanför målet.
const CALL_LOG_STALE_DAYS = 7;

// allSettled väntar hur länge som helst. En hängande hämtning lämnade "Uppdatera" utgråad på
// "Uppdaterar…" resten av sessionen — samtidigt som varje felruta bad användaren trycka på den.
const REQUEST_TIMEOUT_MS = 15_000;

// Zeros while the summary is in flight or after a failed load, so the panels render their shape
// rather than blanking. Matches what the empty lists produced before the server did the counting.
const EMPTY_SUMMARY: CrmOverviewSummary = {
  pipelineProspects: 0, newProspects: 0, quotedProspects: 0, qualifiedProspects: 0,
  activeQuotes: 0, activeQuoteValue: 0, quoteFollowUps: 0,
  openWorkOrders: 0, openOrderValue: 0, workOrdersToInvoice: 0, toInvoiceOrderValue: 0,
  callsLast7Days: 0, followUpCalls: 0, standaloneCalls: 0,
  openTasks: 0, overdueTasks: 0, todayTasks: 0,
  weekTeam: { calls: 0, quotes: 0, quoteValue: 0, orderCount: 0, orderValue: 0, invoicedValue: 0 },
  weekByUser: {},
  truncated: [],
};

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

function sortTasks(taskA: TaskItem, taskB: TaskItem) {
  if (taskA.status !== taskB.status) return taskA.status === 'open' ? -1 : 1;
  if (!!taskA.due_date !== !!taskB.due_date) return taskA.due_date ? -1 : 1;
  if (taskA.due_date && taskB.due_date && taskA.due_date !== taskB.due_date) return taskA.due_date.localeCompare(taskB.due_date);
  return taskB.updated_at.localeCompare(taskA.updated_at);
}

// Rubrikerna räknas upp i singular vid 1. Neutrum-substantiv (samtal, prospekt) har samma
// form i båda numerus, men adjektiven och t-orden runt dem har det inte — "1 fristående
// samtal ligger öppna" — så hela frasen står i varje gren. Samtalsraden behöver ingen gren:
// "samtal" böjs inte och svenska presensverb böjs inte efter numerus.
function buildOverviewActions(args: { overdueTasks: number; followUpCalls: number; newProspects: number; standaloneCalls: number; quoteFollowUps: number }) {
  const actions: Array<{ title: string; description: string; href: string }> = [];

  if (args.overdueTasks > 0) {
    actions.push({ title: `${args.overdueTasks} ${args.overdueTasks === 1 ? 'uppgift är sen' : 'uppgifter är sena'}`, description: 'Börja med att stänga sådant som redan borde ha följts upp.', href: '/crm/uppgifter' });
  }
  if (args.followUpCalls > 0) {
    actions.push({ title: `${args.followUpCalls} samtal behöver nästa steg`, description: 'Logga uppföljning eller konvertera till prospekt om signalen är varm.', href: '/crm/samtal' });
  }
  if (args.quoteFollowUps > 0) {
    actions.push({ title: `${args.quoteFollowUps} ${args.quoteFollowUps === 1 ? 'offertläge' : 'offertlägen'} väntar uppföljning`, description: 'Stäm av prospekt där offerten behöver nästa steg innan affären tappar fart.', href: '/crm/offerter' });
  }
  if (args.newProspects > 0) {
    actions.push({ title: `${args.newProspects} ${args.newProspects === 1 ? 'nytt prospekt' : 'nya prospekt'} väntar`, description: 'Bra läge att ta första kontakt och flytta dem ur ny-läget.', href: '/crm/prospekt' });
  }
  if (args.standaloneCalls > 0) {
    actions.push({ title: `${args.standaloneCalls} fristående samtal ligger ${args.standaloneCalls === 1 ? 'öppet' : 'öppna'}`, description: 'Kontrollera om några av dem ska bli riktiga prospekt.', href: '/crm/samtal' });
  }

  return actions.slice(0, 3);
}

export default function CrmOverview({ role }: { role: UserRole | null }) {
  const [state, setState] = useState<LoadState>({ summary: null, calls: [], tasks: [], quotes: [], goals: [], workOrders: [], failed: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Varje laddning får ett nummer; avmontering och nästa laddning räknar upp det. Ett svar från
  // en överkörd omgång skriver alltså inte över en färskare. `active`-flaggan som stod här förut
  // räckte för effektens engångskörning, men Uppdatera kan starta om medan en omgång är i luften.
  const loadIdRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const overviewWindow = getCrmOverviewWindow();
      const summaryQuery = new URLSearchParams({
        today: overviewWindow.today,
        since: overviewWindow.since,
        week_start: overviewWindow.weekStart,
        week_end: overviewWindow.weekEnd,
      });

      const url: Record<SectionKey, string> = {
        summary: `/api/crm/overview?${summaryQuery}`,
        calls: '/api/crm/calls',
        tasks: '/api/crm/tasks',
        // These two lists are now only the cards' five rows. Both sorts have to be asked for:
        // the offer list's default order leads with drafts and lost quotes, the order board's
        // with the earliest installation date — so a brand new order is the table's last row.
        quotes: `/api/crm/quotes?sort=updated_desc&limit=${RECENT_ITEM_LIMIT}`,
        goals: '/api/crm/goals?period_type=month',
        workOrders: `/api/crm/work-orders?sort=created_desc&limit=${RECENT_ITEM_LIMIT}`,
      };

      // allSettled, inte all: ETT avvisat löfte — ett nätverksglapp i en enda hämtning — avvisade
      // hela samlingen och landade i catch-grenen, som tömde sidan. Nu bärs varje utfall för sig.
      const settled = await Promise.allSettled(SECTION_ORDER.map((key) => fetch(url[key], { cache: 'no-store', signal: controller.signal })));
      const read = await Promise.all(settled.map(readSection));

      if (loadId !== loadIdRef.current) return;

      const section = Object.fromEntries(SECTION_ORDER.map((key, index) => [key, read[index]])) as Record<SectionKey, Section>;
      // En 200 utan data.summary i kroppen är inget svar heller — sidans alla siffror kommer
      // därifrån, så den saknade nyttolasten flaggas som ett fel i stället för att bli nollor.
      const summaryData = (section.summary.json?.data?.summary as CrmOverviewSummary | undefined) ?? null;

      setState({
        summary: summaryData,
        calls: itemsOf<CallItem>(section.calls),
        tasks: itemsOf<TaskItem>(section.tasks),
        quotes: itemsOf<QuoteItem>(section.quotes),
        goals: itemsOf<GoalItem>(section.goals),
        workOrders: itemsOf<WorkOrderItem>(section.workOrders),
        failed: SECTION_ORDER.filter((key) => !section[key].ok || (key === 'summary' && summaryData == null)),
      });
    } catch {
      // Bakkant. allSettled avvisar inte, men getCrmOverviewWindow och URLSearchParams ligger
      // utanför den. Faller något där går ingenting på sidan att lita på, så allt flaggas.
      if (loadId !== loadIdRef.current) return;
      setState({ summary: null, calls: [], tasks: [], quotes: [], goals: [], workOrders: [], failed: [...SECTION_ORDER] });
    } finally {
      clearTimeout(timeout);
      if (loadId === loadIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load('initial');
    // Räkna upp vid avmontering så ett svar som landar efteråt räknas som överkört.
    return () => { loadIdRef.current += 1; };
  }, [load]);

  // The figures are counted by /api/crm/overview; what's left here is the team's targets, which
  // come from the goals list, and the flow bars' shared scale.
  const summary = useMemo(() => {
    const counted = state.summary ?? EMPTY_SUMMARY;
    // Monthly budgets → weekly targets (÷4) so the team summary compares against ~one week.
    const callsTarget = Math.round(weeklyFromMonthly(state.goals.reduce((total, goal) => total + goal.calls_target, 0)));
    const quotesTarget = Math.round(weeklyFromMonthly(state.goals.reduce((total, goal) => total + goal.quotes_target, 0)));
    const orderValueTarget = weeklyFromMonthly(state.goals.reduce((total, goal) => total + Number(goal.order_value_target || 0), 0));

    return {
      ...counted,
      callsTarget,
      quotesTarget,
      orderValueTarget,
    };
  }, [state.summary, state.goals]);

  // Quotes and orders arrive already ordered and already five rows long — the fetches ask for
  // sort=updated_desc / sort=created_desc with limit=5, and re-sorting them here would leave two
  // competing definitions of the same card's order, with the query's parameter looking
  // authoritative. Calls and tasks come from routes without those parameters, so they are shaped
  // here: calls arrive newest-first (call_at desc) and only need the slice; tasks need both.
  const recentCalls = useMemo(() => state.calls.slice(0, RECENT_ITEM_LIMIT), [state.calls]);
  // Samtalsloggen SKA användas — att den ligger stilla är säljarnas slarv, inte en död funktion.
  // Kortet visade bara absoluta datum, så två rader från juni läste som färsk aktivitet: gröna
  // "Positivt"-märken och ingenting som sa hur gammalt det var. Åldern är hela poängen med kortet.
  const staleCallDays = useMemo(() => {
    // Listan kommer sorterad call_at desc från rutten, så första raden är den färskaste.
    const days = daysSince(state.calls[0]?.call_at);
    return days != null && days >= CALL_LOG_STALE_DAYS ? days : null;
  }, [state.calls]);
  const nextTasks = useMemo(() => [...state.tasks].filter((task) => task.status === 'open').sort(sortTasks).slice(0, RECENT_ITEM_LIMIT), [state.tasks]);
  const failed = (key: SectionKey) => state.failed.includes(key);
  // Summeringen föder varenda siffra på sidan — nyckeltalen, statusbilden, fokusraderna och
  // topplistans utfall. Fallerar den är EMPTY_SUMMARY:s nollor inte "noll" utan "vi vet inte".
  const summaryFailed = failed('summary');
  const nextActions = buildOverviewActions({ overdueTasks: summary.overdueTasks, followUpCalls: summary.followUpCalls, newProspects: summary.newProspects, standaloneCalls: summary.standaloneCalls, quoteFollowUps: summary.quoteFollowUps });
  const teamLeaderboard = useMemo(() => {
    // Goals are MONTHLY budgets; the leaderboard shows the weekly target (budget ÷ 4) against THIS
    // WEEK's actuals. The actuals are counted per user by /api/crm/overview — summing them here
    // meant reading them out of a capped list, which is exactly what stopped being trustworthy.
    const week = state.summary?.weekByUser ?? {};

    return state.goals
      .filter(hasActiveGoalTarget)
      .map((goal) => {
        const user = getGoalUser(goal.user);
        // Weekly targets derived from the monthly budget (÷4). Count targets are rounded for
        // a clean "x / y" display; value targets stay exact (formatted as currency).
        const callsTarget = Math.round(weeklyFromMonthly(goal.calls_target));
        const quotesTarget = Math.round(weeklyFromMonthly(goal.quotes_target));
        const quoteValueTarget = weeklyFromMonthly(goal.quote_value_target);
        const orderCountTarget = Math.round(weeklyFromMonthly(goal.order_count_target));
        const orderValueTarget = weeklyFromMonthly(goal.order_value_target);

        const actuals = week[goal.user_id];
        const callsDone = actuals?.calls ?? 0;
        const quotesDone = actuals?.quotes ?? 0;
        const quoteValueDone = actuals?.quoteValue ?? 0;
        const orderCountDone = actuals?.orderCount ?? 0;
        const orderValueDone = actuals?.orderValue ?? 0;
        const invoicedValueDone = actuals?.invoicedValue ?? 0;
        const progressValues = [
          callsTarget > 0 ? callsDone / callsTarget : null,
          quotesTarget > 0 ? quotesDone / quotesTarget : null,
          quoteValueTarget > 0 ? quoteValueDone / quoteValueTarget : null,
          orderCountTarget > 0 ? orderCountDone / orderCountTarget : null,
          orderValueTarget > 0 ? orderValueDone / orderValueTarget : null,
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
          callsTarget,
          quotesDone,
          quotesTarget,
          quoteValueDone,
          quoteValueTarget,
          orderCountDone,
          orderCountTarget,
          orderValueDone,
          orderValueTarget,
          invoicedValueDone,
          progressScore,
        };
      })
      .sort((left, right) => {
        if (right.progressScore !== left.progressScore) return right.progressScore - left.progressScore;
        if (right.callsDone !== left.callsDone) return right.callsDone - left.callsDone;
        return left.userName.localeCompare(right.userName, 'sv');
      });
  }, [state.goals, state.summary]);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>CRM-översikt</h1>
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Välkommen tillbaka! Här är vad som händer i ditt CRM idag.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* ?log=1 öppnar formuläret direkt. Utan den landade man bara på samtalssidan och möttes
              av en knapp med exakt samma etikett — två klick där ett räcker, på den knapp som ska
              driva att loggen faktiskt används. */}
          <Link
            href="/crm/samtal?log=1"
            className={cn(crm.primaryButton, 'no-underline')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            + Logga samtal
          </Link>
          <Link
            href="/crm/uppgifter"
            className={cn(crm.ghostButton, 'no-underline')}
          >
            Öppna uppgifter
          </Link>
          {/* Sidan hämtade en gång vid montering och låg sedan still. Den är en dagsöversikt som
              står uppe hela arbetsdagen, så den hann bli tyst gammal. */}
          <button
            type="button"
            onClick={() => void load('refresh')}
            disabled={loading || refreshing}
            className={cn(crm.ghostButton, 'disabled:cursor-not-allowed disabled:opacity-60')}
          >
            {refreshing ? 'Uppdaterar…' : 'Uppdatera'}
          </button>
        </div>
      </div>

      {/* Nyckeltalen. Bandet bär numera de fyra LAGER-raderna — var pengarna står just nu — och
          statusbilden till höger är därmed ren måluppföljning. Förut visade bandet prospekt-,
          samtals- och uppgiftstal som alla stod på noll (prospektstatus är kundstatus, inte
          pipeline-status), samtidigt som statusbilden bredvid bar hela signalen.

          ⚠️ Fortsatt dolt under 640 px, med flit: på telefon går man in för att se en offert eller
          order och ringa en kund, inte för att läsa statistik. Det är också därför beloppen kan
          renderas i full form — de behöver aldrig få plats på en 375 px-skärm.

          Dolt när summeringen fallerat: EMPTY_SUMMARY:s nollor betyder "vi vet inte", inte "noll",
          och fyra nollor bredvid en röd felruta läser som ett tomt CRM. */}
      {loading || !summaryFailed ? (
        <div className="hidden sm:block">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading ? (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-32 animate-pulse rounded-2xl border border-[#e0e8dc] bg-[#dfe6da]" />
                ))}
              </>
            ) : (
              <>
                <MetricCard
                  label="Aktiva offerter"
                  value={formatCurrency(summary.activeQuoteValue, 'SEK')}
                  helper={`${summary.activeQuotes} st`}
                  icon={<QuoteIcon />}
                  iconBg="bg-emerald-100"
                />
                <MetricCard
                  label="Öppna ordrar"
                  value={formatCurrency(summary.openOrderValue, 'SEK')}
                  helper={`${summary.openWorkOrders} st`}
                  icon={<OrderIcon />}
                  iconBg="bg-teal-100"
                />
                <MetricCard
                  label="Att fakturera"
                  value={formatCurrency(summary.toInvoiceOrderValue, 'SEK')}
                  helper={`${summary.workOrdersToInvoice} st`}
                  icon={<InvoiceIcon />}
                  iconBg="bg-amber-100"
                />
                {/* Ingen hjälprad: de tre ovan säger "N st" om sin egen stock, men fakturerat är ett
                    flöde över veckan och summeringen bär inget antal att visa bredvid det. */}
                <MetricCard
                  label="Fakturerat i veckan"
                  value={formatCurrency(summary.weekTeam.invoicedValue, 'SEK')}
                  icon={<InvoicedIcon />}
                  iconBg="bg-violet-100"
                />
              </>
            )}
          </div>
          <p className="m-0 mt-2 text-xs text-slate-500">{MONEY_NOTE}</p>
        </div>
      ) : null}

      {/* Rutan skiljer på grad: faller summeringen är sidans numeriska halva borta, faller en
          lista är det ett kort. Förut var allt samma röda ruta ovanför en tömd sida. */}
      {!loading && state.failed.length > 0 ? (
        <div className={cn(
          'rounded-2xl border px-4 py-3 text-sm',
          summaryFailed ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900',
        )}>
          <strong className="font-semibold">
            {summaryFailed ? 'Siffrorna kunde inte räknas' : 'Delar av översikten kunde inte läsas'}
          </strong>
          <p className="m-0 mt-1">
            Gick inte att läsa: {state.failed.map((key) => sectionLabel[key]).join(', ')}.{' '}
            {summaryFailed
              ? 'Nyckeltalen och statusbilden är dolda tills det går igen.'
              : 'Resten av sidan visas som vanligt.'}
          </p>
        </div>
      ) : null}

      {/* Main content grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.6fr)]">
        {/* ⚠️ `content-start` — utan den STRÄCKS korten här. Kolumnerna är grid-syskon och blir
            lika höga, och den här kolumnens auto-rader ärver `align-content: normal`, som för grid
            löser till stretch: raderna blåses upp och fyller vad statusbilden + topplistan bestämt.
            Effekten är att innehållshöjd inte styr något — en trimning av "Nästa fokus" åt kortet
            upp direkt, och korten under låg kvar. Mätt i Chrome 2026-08-17: fokuskortet 90 px
            naturligt, 317 px utsträckt. */}
        <div className="grid content-start gap-4">
          {/* Next actions. Kortet är medvetet tight: det tar högst tre rader (buildOverviewActions
              kapar där) och allt som ligger under det — offert- och orderkorten — ska synas utan
              att man scrollar förbi en rubrik med luft omkring sig. */}
          <div className={crm.cardInner}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={cn('mb-0.5', crm.sectionTitle)}>Att agera på</p>
                <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">Nästa fokus</h2>
              </div>
              {/* Räknaren är nextActions.length, och den listan räknas fram ur summeringen — utan
                  summaryFailed här stod "0 prioriterade" ovanför felrutan, samma påstående som
                  nyckeltalen och statusbilden döljs för. */}
              {!loading && !summaryFailed && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {nextActions.length} {nextActions.length === 1 ? 'prioriterad' : 'prioriterade'}
                </span>
              )}
            </div>
            {loading ? <OverviewLoadingRows /> : null}
            {/* "Läget är lugnt" räknas fram ur summeringens nollor. Fallerar den är listan tom av
                fel skäl, och lugnbeskedet blir sidans farligaste påstående. */}
            {!loading && summaryFailed ? <SectionError /> : null}
            {!loading && !summaryFailed && nextActions.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                Läget är lugnt — inget blockerande i CRM-flödet just nu.
              </div>
            ) : null}
            {!loading && nextActions.length > 0 ? (
              <div className="grid gap-1.5">
                {nextActions.map((action) => (
                  <Link
                    key={action.title}
                    href={action.href}
                    className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 no-underline transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="text-sm font-semibold text-slate-900">{action.title}</strong>
                      <p className="m-0 text-xs leading-snug text-slate-500">{action.description}</p>
                    </div>
                    <span className="mt-0.5 shrink-0 text-xs font-semibold text-emerald-700">Öppna →</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {/* Recent items grid. Order follows the flow the sellers work in: offert → order on the
              first row, then the two activity lists. Prospects had their own card here until
              2026-08-17 and were dropped — that stage isn't in use right now. */}
          <div className="grid gap-4 xl:grid-cols-2">
            {/* ⚠️ Raderna bär `min-w-0` på själva länken, inte bara på textkolumnen. Raden är ett
                GRID-item i listan nedan, och ett auto-spår får inte bli smalare än itemets
                min-content — som med `truncate` (white-space: nowrap) är hela projektnamnets bredd.
                Textkolumnens min-w-0 räcker alltså inte: raden växte förbi kortet och sköt ut
                statusbadgen utanför kanten så fort namnet var långt. Mätt i Chrome 2026-08-17. */}
            {/* Raderna djuplänkar till posten, inte till listan. Förut gick varje rad till samma
                mål som kortets "Visa alla", så ett klick på "Nyprod Villa HJO" landade i en lista
                där man fick leta upp raden igen — sämst på telefon, där sidan finns för att man
                snabbt ska nå en offert eller order. Parametrarna finns redan i respektive vy:
                ?quote_id= (QuotesClient), ?task_id= (TasksClient), ?call_id= (CallsClient). */}
            <RecentCard title="Senaste offertlägen" href="/crm/offerter" loading={loading} failed={failed('quotes')}>
              {state.quotes.length === 0 ? <EmptyState description="Inga offertsteg registrerade ännu." /> : (
                <div className="grid gap-2">
                  {state.quotes.map((quote) => (
                    <Link key={quote.id} href={`/crm/offerter?quote_id=${quote.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{quote.project_name}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{getQuoteCustomerName(quote)} · {formatCurrency(quote.amount, quote.currency_code)}</p>
                      </div>
                      <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', quoteStatusMeta[quote.status].className)}>{quoteStatusMeta[quote.status].label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Senaste ordrar" href="/crm/arbetsorder" loading={loading} failed={failed('workOrders')}>
              {state.workOrders.length === 0 ? <EmptyState description="Inga arbetsordrar ännu." /> : (
                <div className="grid gap-2">
                  {state.workOrders.map((order) => (
                    <Link key={order.id} href={`/crm/arbetsorder/${order.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{order.project_name}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{order.client_name} · {formatCurrency(order.amount, order.currency_code)}</p>
                      </div>
                      <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', workOrderStatusClass[order.status])}>{workOrderStatusLabel[order.status]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Öppna uppgifter" href="/crm/uppgifter" loading={loading} failed={failed('tasks')}>
              {nextTasks.length === 0 ? <EmptyState description="Inga öppna uppgifter just nu." /> : (
                <div className="grid gap-2">
                  {nextTasks.map((task) => (
                    <Link key={task.id} href={`/crm/uppgifter?task_id=${task.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{task.title}</strong>
                        <p className="m-0 truncate text-xs text-slate-500">{formatDate(task.due_date)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${taskPriorityClass[task.priority]}`}>{taskPriorityLabel[task.priority]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>

            <RecentCard title="Senaste samtal" href="/crm/samtal" loading={loading} failed={failed('calls')}>
              {recentCalls.length === 0 ? <EmptyState description="Inga samtal loggade ännu." /> : (
                <div className="grid gap-2">
                  {staleCallDays != null ? (
                    <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {/* Listan är RLS-filtrerad: en säljare ser bara sina egna samtal, en admin
                          allas. Påståendet måste följa med — "ingen har loggat" är fel när det
                          bara betyder att DU inte har det, och kollegornas samtal rensar det inte. */}
                      {role === 'admin'
                        ? `Ingen har loggat ett samtal på ${staleCallDays} dagar.`
                        : `Du har inte loggat ett samtal på ${staleCallDays} dagar.`}
                    </p>
                  ) : null}
                  {recentCalls.map((call) => (
                    <Link key={call.id} href={`/crm/samtal?call_id=${call.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-slate-900">{getCallCompanyName(call)}</strong>
                        {/* Relativ ålder i raden, exakt tidpunkt på hover. "8 juni 2026 14:27" krävde
                            att läsaren räknade dagar i huvudet, och ingen gör det. */}
                        <p className="m-0 truncate text-xs text-slate-500" title={formatDateTime(call.call_at)}>{formatRelativeTime(call.call_at)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{outcomeLabel[call.outcome]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </RecentCard>
          </div>
        </div>

        {/* Höger kolumn: ETT kort. Måluppföljningen och topplistan visade samma data på två
            aggregeringsnivåer — de tre målraderna ÄR team-summan av de rader topplistan redan
            listade per säljare, i kortet direkt under. För en säljare var det värre än dubblering:
            RLS ger hen bara sitt eget mål, så "Topplista" innehöll exakt EN rad, hen själv, med
            samma siffror som stod ovanför. Nu är teamets rader kortets huvuddel och säljarna en
            lista under dem. */}
        <div className="grid content-start gap-4">
          <div className={crm.cardInner}>
            {/* Kortet var "Fördelning och mål" och bar båda: fyra lagerrader ovanför en avdelare,
                fyra målrader under. Lagerraderna sitter numera i nyckeltalsbandet högst upp, så det
                som är kvar här är enbart måluppföljning.

                🧨 Vad som gick förlorat i flytten: de tre lagerraderna delade nämnare (flowScale =
                den största av dem), så staplarna lästes som en FÖRDELNING — 3,8 Mkr står i offert,
                899 tkr har blivit order. MetricCard har ingen stapel, så den läsningen finns inte
                längre någonstans. Talen är kvar, proportionen är det inte. */}
            {/* ⚠️ INTE "Teamet". /api/crm/overview kör på sessionsklienten (route.ts:66), så RLS
                gäller: crm_calls_select_visible ger en säljare bara sina egna samtal, och
                crm_goals_select_visible bara sitt eget mål. Siffrorna här är teamets för en admin
                och den egna för alla andra — rubriken får inte påstå något om vilket. */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cn('mb-1', crm.sectionTitle)}>Måluppföljning</p>
                <h2 className="m-0 text-lg font-bold tracking-tight text-slate-900">Veckans mål</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{MONEY_NOTE}</p>
              </div>
              {/* Bara admin. /crm/installningar är rollspärrad i _lib/nav.ts och målen är
                  crm_goals_insert_admin_only i RLS — länken skickade en säljare till en sida hen
                  inte kommer in på. */}
              {role === 'admin' ? (
                <Link href="/crm/installningar" className="shrink-0 text-xs font-semibold text-emerald-700 no-underline hover:text-emerald-800">Justera mål</Link>
              ) : null}
            </div>
            {loading ? <OverviewLoadingRows /> : summaryFailed ? <SectionError /> : (
              <div className="grid gap-3">
                {/* Everything below is measured against a WEEKLY target, so the actuals are the
                    week's — the same window the topplista under this card uses per säljare. With a
                    rolling 7 days the team row could never equal the sum of the seller rows beside
                    it, and one of the two would have to be read as broken. */}
                {/* Målen kommer från /api/crm/goals, inte från summeringen. Fallerar den hämtningen
                    blir varje target 0, hasGoal falskt, och raderna tappar sitt "/ mål" tyst — ett
                    500-svar ser då ut som "ingen budget satt". Topplistan fick sin flagga för exakt
                    den tvetydigheten; det här är samma sak en nivå upp. Sena uppgifter räknas av
                    summeringen och står kvar. */}
                {failed('goals') ? <SectionError /> : (
                  <>
                    <StatusStrip label="Offerter mot mål" value={summary.weekTeam.quotes} goal={summary.quotesTarget} tone="emerald" />
                    <StatusStrip label="Ordervärde mot mål" value={summary.weekTeam.orderValue} goal={summary.orderValueTarget} tone="teal" currency />
                    <StatusStrip label="Samtal mot mål" value={summary.weekTeam.calls} goal={summary.callsTarget} tone="sky" />
                  </>
                )}
                {/* Sena uppgifter är inget mål — det är ett larm utan target. Avdelaren som förut
                    skilde lager från mål skiljer nu mål från larm. */}
                <div className="my-1 h-px bg-slate-100" />
                <StatusStrip label="Sena uppgifter" value={summary.overdueTasks} tone="rose" />
                {/* Only ever shows if a query hit its row cap. The point of counting server-side
                    was that a truncated read stops being silent — so it says so. */}
                {summary.truncated.length > 0 ? (
                  <p className="m-0 text-[11px] leading-4 text-amber-700">
                    Räknat på ett kapat urval ({summary.truncated.join(', ')}) — siffrorna kan vara för låga.
                  </p>
                ) : null}

                {/* Mål saknas och mål som inte gick att läsa ger båda en tom lista — utan
                    failed('goals')-grenen ovan hade ett 500-svar renderats som "inga mål satta". */}
                {!failed('goals') && teamLeaderboard.length === 0 ? (
                  <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    Inga veckomål satta ännu. Lägg in mål i Inställningar för att aktivera uppföljningen.
                  </p>
                ) : null}

                {/* Per säljare. Visas bara när listan har MER än en rad: med exakt en är den raden
                    per definition hela summan ovanför, och kortet hade sagt samma sak två gånger —
                    vilket är precis vad en säljare såg innan de två korten slogs ihop. */}
                {!failed('goals') && teamLeaderboard.length > 1 ? (
                  <>
                    <div className="my-1 h-px bg-slate-100" />
                    <p className={cn('m-0', crm.sectionTitle)}>Per säljare</p>
                    <SellerGoalList entries={teamLeaderboard} />
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nytt i appen. Ligger efter innehållet men före snabbnavigeringen: ändringarna ska synas
          utan att man letar, men de är inte det man kom hit för. Kortet döljer sig självt när det
          inte finns något att visa. */}
      <ChangelogCard />

      {/* Här låg ett rutnät med ett kort per CRM-sektion — fjorton stycken, 693 px av sidans
          2177, som pekade exakt på raderna i sidoskenan. På desktop syns skenan alltid, så det var
          ren dubblering; på mobil ligger den bakom hamburgaren, men två tryck där uppe slår ett
          rutnät man måste scrolla förbi hela sidan för att nå. Borta på båda. */}
    </div>
  );
}

// En tom lista och en lista som inte gick att läsa ser likadana ut i data men betyder motsatta
// saker. Utan den här skulle ett 500-svar renderas som "Inga offertsteg registrerade ännu."
function SectionError() {
  return (
    <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/70 px-4 py-3 text-xs text-rose-800">
      Kunde inte läsas just nu. Prova Uppdatera.
    </div>
  );
}

function RecentCard({ title, href, loading, failed, children }: { title: string; href: string; loading: boolean; failed?: boolean; children: React.ReactNode }) {
  return (
    <div className={crm.cardInner}>
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* h2, inte strong: korten är syskon till "Nästa fokus" och statusbilden, så en skärmläsares
            rubriklista tappade annars halva sidan. Preflight nollar h2:ans grad, vikt och marginal,
            så klasserna nedan bestämmer utseendet precis som förut. */}
        <h2 className="m-0 text-sm font-bold text-slate-900">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-emerald-700 no-underline hover:text-emerald-800">Visa alla</Link>
      </div>
      {loading ? <OverviewLoadingRows rows={RECENT_ITEM_LIMIT} /> : failed ? <SectionError /> : children}
    </div>
  );
}

// Skeleton row count is per caller: the recent lists settle on five rows, so a three-row skeleton
// would make the whole column jump when the data lands.
function OverviewLoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl border border-[#e0e8dc] bg-[#dfe6da]" />
      ))}
    </div>
  );
}

function StatusStrip({ label, value, tone, goal, helper, currency = false }: { label: string; value: number; tone: 'slate' | 'sky' | 'amber' | 'rose' | 'emerald' | 'teal' | 'violet'; goal?: number; helper?: string; currency?: boolean }) {
  const toneClass = {
    slate: 'bg-slate-900',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    emerald: 'bg-emerald-500',
    teal: 'bg-teal-500',
    violet: 'bg-violet-500',
  }[tone];

  // The bar needs something to measure against: a goal. Without one, a count keeps the old rough
  // 16-%-per-unit fill and a money row shows a damped full bar — the same convention the
  // leaderboard uses for a figure with no target, since a krona amount has no natural scale of
  // its own. `scale` — den delade nämnaren för lagerraderna — togs bort med dem.
  const hasGoal = goal != null && goal > 0;
  const denominator = hasGoal ? goal! : null;
  const width = denominator != null
    ? value <= 0 ? 0 : Math.min(100, (value / denominator) * 100)
    : currency
      ? value > 0 ? 100 : 0
      : value <= 0 ? 0 : Math.min(100, value * 16);
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayGoal = hasGoal
    ? currency ? formatCurrency(goal!, 'SEK') : String(goal)
    : null;

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="min-w-0 truncate">
          {label}
          {helper ? <span className="text-slate-400"> · {helper}</span> : null}
        </span>
        <strong className="shrink-0 text-slate-800">{displayGoal ? `${displayValue} / ${displayGoal}` : displayValue}</strong>
      </div>
      {/* Staplarna bär ingen egen information: värdet och målet står i klartext på raden ovanför,
          och en skärmläsare som läser upp dem igen som progressbar hade sagt samma sak två gånger
          med sämre ord. De är dekor och deklareras som dekor. */}
      <div className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
        <div className={cn('h-1.5 rounded-full transition-all', toneClass, denominator == null && currency && 'opacity-40')} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

// Hur många säljare som syns innan man ber om resten. Tre räcker för att listan ska läsa som en
// rangordning utan att kortet blir en egen sida — sex säljare à sex rader var 1 080 px, och det
// var i praktiken hela vänsterkolumnens dödyta.
const SELLER_PREVIEW_COUNT = 3;

// Raderna som förut var kortet "Teamöversikt / Topplista". Kortchromet är borta — de bor numera
// inne i måluppföljningskortet, under teamets rader, eftersom de är samma data en nivå ner.
function SellerGoalList({
  entries,
}: {
  entries: Array<{
    id: string;
    userName: string;
    role: string;
    callsDone: number;
    callsTarget: number;
    quotesDone: number;
    quotesTarget: number;
    quoteValueDone: number;
    quoteValueTarget: number;
    orderCountDone: number;
    orderCountTarget: number;
    orderValueDone: number;
    orderValueTarget: number;
    invoicedValueDone: number;
    progressScore: number;
  }>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, SELLER_PREVIEW_COUNT);

  return (
    <>
      <div className="grid gap-2">
        {visible.map((entry, index) => (
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
              <TeamProgressRow label="Antal ordrar" value={entry.orderCountDone} target={entry.orderCountTarget} tone="amber" />
              <TeamProgressRow label="Ordervärde" value={entry.orderValueDone} target={entry.orderValueTarget} tone="amber" currency />
              <TeamProgressRow label="Fakturerat ordervärde" value={entry.invoicedValueDone} tone="violet" currency />
            </div>
          </div>
        ))}
      </div>
      {entries.length > SELLER_PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="mt-2 justify-self-start text-xs font-semibold text-emerald-700 hover:text-emerald-800"
        >
          {showAll ? 'Visa färre' : `Visa alla (${entries.length})`}
        </button>
      ) : null}
    </>
  );
}

function TeamProgressRow({ label, value, target, tone, currency = false }: { label: string; value: number; target?: number; tone: 'sky' | 'emerald' | 'teal' | 'amber' | 'violet'; currency?: boolean }) {
  const toneClass = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    teal: 'bg-teal-500',
    amber: 'bg-amber-500',
    violet: 'bg-violet-500',
  }[tone];

  // Some rows (e.g. order value) are follow-up figures without a weekly target — show the
  // value alone and fill the bar relative to the value itself for a subtle visual.
  const hasTarget = target != null && target > 0;
  const width = hasTarget
    ? value <= 0 ? 0 : Math.min(100, (value / target!) * 100)
    : value > 0 ? 100 : 0;
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayTarget = hasTarget ? (currency ? formatCurrency(target!, 'SEK') : target) : null;

  return (
    <div className="grid gap-0.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{label}</span>
        <strong className="text-slate-700">{displayTarget != null ? `${displayValue} / ${displayTarget}` : displayValue}</strong>
      </div>
      <div className="h-1 rounded-full bg-slate-100" aria-hidden="true">
        <div className={`h-1 rounded-full ${toneClass} ${hasTarget ? '' : 'opacity-40'}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}




// Ikonens färg följer kortets iconBg, som i sin tur ärver tonen raden hade i statusbilden:
// offert emerald, order teal, att fakturera amber, fakturerat violet.
function QuoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function OrderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z" />
      <path d="M16 5h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h2" />
      <path d="M8 11h8" /><path d="M8 15h5" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h8" /><path d="M8 17h5" />
    </svg>
  );
}

function InvoicedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
