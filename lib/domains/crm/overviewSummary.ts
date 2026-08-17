import type { SupabaseClient } from '@supabase/supabase-js';
import { BOARD_FILTER_STATUSES, type CrmWorkOrderStatus } from './work-orders';
import { QUOTE_FILTER_STATUSES, type CrmQuoteStatus } from './quotes';

// ── The CRM overview's read model ──
//
// One number per figure the overview shows, counted where the rows are instead of in the browser.
//
// The page used to download the quote, order, call, prospect and task lists and count them client
// side. Every one of those lists is capped before the browser sees it — PostgREST answers with at
// most 1000 rows here and the CRM list routes cap lower still — and a cap cuts BEFORE anything can
// be counted, so the totals silently shrank as the tables grew. They were close: measured
// 2026-08-17 the tables held 778 prospects (cap 1000), 69 quotes (cap 100, growing ~52/month) and
// 29 orders (cap 100, ~22/month), so the quote figures were weeks from starting to lie.
//
// Each number is read with the WHERE clause that belongs to it, which is what makes this safe at
// any table size:
//   · a STOCK ("aktiva offerter", "öppna ordrar") is filtered on the statuses that define it, so
//     the result set is bounded by open work — tens of rows — and not by the table.
//   · a WINDOWED figure is filtered on its window, so it is bounded by the window.
//   · a count with no natural bound (prospect buckets, follow-up calls) is a head-only count:
//     exact at any size and no rows transferred.
// Every row-returning query still carries an explicit cap and reports hitting it in `truncated`,
// because the one thing worse than a wrong number is a wrong number that says nothing.

// A quote is "active" while it is still in play. Read from the offer list's own tab definition
// rather than copied: "Aktiva offerter" here and the "Aktiva" tab there must mean the same thing,
// and a fourth in-play status added to one of them would otherwise fall silently out of the other.
export const ACTIVE_QUOTE_STATUSES = QUOTE_FILTER_STATUSES.active ?? [];

// ⚠️ These four buckets are structurally empty today, and were before the counting moved here.
// Prospects are `crm_customers` rows with customer_stage='prospect', and `status` on that table is
// the CUSTOMER status: createCrmProspect writes 'active', and measured 2026-08-17 all 778 prospect
// rows carry exactly that. The pipeline statuses below are a leftover from the standalone prospect
// table — only updateCrmProspect can even write them, and nothing does. So the overview's two
// prospect metric cards read 0 for 778 prospects. Kept as-is deliberately: reproducing today's
// numbers is the job here, and deciding what "öppna prospekt" should mean instead is a product
// decision, not a refactor.
export const PIPELINE_PROSPECT_STATUSES = ['new', 'contacted', 'qualified', 'quoted'];

// Single-sourced from the order board's chip definitions, so a status added to a board group
// cannot silently fall out of the overview's stocks. 'all' is the only filter without a status
// list, and it is not used here.
function boardStatuses(...filters: Array<'draft' | 'scheduled' | 'active' | 'completed' | 'invoiced'>): CrmWorkOrderStatus[] {
  return filters.flatMap((filter) => BOARD_FILTER_STATUSES[filter] ?? []);
}

/** Ordered but not yet in the invoicing stage: not planned, planned, or out on the job. */
export const OPEN_WORK_ORDER_STATUSES = boardStatuses('draft', 'scheduled', 'active');

/** Sitting in the invoicing stage — the board's "Fakturera" chip, including mid-delfakturering. */
export const TO_INVOICE_WORK_ORDER_STATUSES = boardStatuses('completed');

// A plain PostgREST select answers with at most 1000 rows in this project. The queries below are
// filtered to sets that stay far below it; the cap is the backstop, not the plan.
const ROW_CAP = 1000;

export type CrmOverviewWindow = {
  /** Today, local to the reader (YYYY-MM-DD). Buckets the task due dates. */
  today: string;
  /** First day of the rolling 7-day window, inclusive (YYYY-MM-DD). */
  since: string;
  /** Monday of the current week, inclusive (YYYY-MM-DD). */
  weekStart: string;
  /** The Monday after the current week, exclusive (YYYY-MM-DD). */
  weekEnd: string;
};

export type CrmOverviewWeekActuals = {
  calls: number;
  quotes: number;
  quoteValue: number;
  orderCount: number;
  orderValue: number;
  invoicedValue: number;
};

export type CrmOverviewSummary = {
  // Prospects (metric cards)
  pipelineProspects: number;
  newProspects: number;
  quotedProspects: number;
  qualifiedProspects: number;
  // Quotes — stocks
  activeQuotes: number;
  activeQuoteValue: number;
  quoteFollowUps: number;
  // Work orders — stocks
  openWorkOrders: number;
  openOrderValue: number;
  workOrdersToInvoice: number;
  toInvoiceOrderValue: number;
  // Calls over the rolling 7 days. The only figure on the page still keyed to that window, because
  // it is the only one whose label says so ("Samtal senaste 7 dagar"). Everything measured against
  // a target is keyed to the week instead — see weekTeam.
  callsLast7Days: number;
  followUpCalls: number;
  standaloneCalls: number;
  // Tasks (personal — RLS scopes dashboard_work_items to the reader)
  openTasks: number;
  overdueTasks: number;
  todayTasks: number;
  /**
   * The whole team's actuals for the CURRENT WEEK — the window the weekly targets are set in, and
   * the same window the leaderboard uses per seller. The two must be able to reconcile: a team
   * figure over a rolling 7 days could not equal the sum of per-seller figures over the week, and
   * on any screen showing both, one of them then reads as broken.
   *
   * Unlike weekByUser this includes rows with no assignee, which belong to the team but to nobody.
   */
  weekTeam: CrmOverviewWeekActuals;
  /** Current week's actuals per user id — the leaderboard joins these with each user's goal. */
  weekByUser: Record<string, CrmOverviewWeekActuals>;
  /** Names of queries that hit ROW_CAP. Empty is the normal case; non-empty means read low. */
  truncated: string[];
};

export type QuoteStockRow = { status: string; amount: number | string };
export type QuoteWindowRow = { amount: number | string; quote_date: string; assigned_to: string | null };
export type OrderStockRow = { status: string; amount: number | string };
export type OrderWindowRow = {
  status: string;
  amount: number | string;
  created_at: string;
  fortnox_invoiced_at: string | null;
  assigned_to: string | null;
};
export type CallWindowRow = {
  user_id: string;
  call_at: string;
  outcome: string;
  /** Null = a call logged without a prospect behind it. */
  prospect_id: string | null;
};
export type TaskDueRow = { due_at: string | null };

export type CrmOverviewRows = {
  quoteStocks: QuoteStockRow[];
  quoteWindow: QuoteWindowRow[];
  orderStocks: OrderStockRow[];
  orderWindow: OrderWindowRow[];
  callWindow: CallWindowRow[];
  openTasks: TaskDueRow[];
  counts: {
    pipelineProspects: number;
    newProspects: number;
    quotedProspects: number;
    qualifiedProspects: number;
  };
  truncated: string[];
};

export function toAmount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const numeric = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(numeric) ? numeric : 0;
}

// Day-resolution comparison, the same rule reports.ts uses: take the date part and compare as a
// string. For a `date` column that is exact. For a timestamptz the day is the UTC one, so a row
// written between 00:00 and 02:00 Swedish time counts towards the previous day — measured to be
// empty in this data (the crews work 07–16) and deliberately not chased, see reports.ts.
function dayOf(value: string | null | undefined): string | null {
  return value ? String(value).slice(0, 10) : null;
}

function inWindow(value: string | null | undefined, from: string, toExclusive?: string): boolean {
  const day = dayOf(value);
  if (day == null) return false;
  return day >= from && (toExclusive == null || day < toExclusive);
}

const NO_ACTUALS: CrmOverviewWeekActuals = { calls: 0, quotes: 0, quoteValue: 0, orderCount: 0, orderValue: 0, invoicedValue: 0 };

function addActuals(base: CrmOverviewWeekActuals, patch: Partial<CrmOverviewWeekActuals>): CrmOverviewWeekActuals {
  return {
    calls: base.calls + (patch.calls ?? 0),
    quotes: base.quotes + (patch.quotes ?? 0),
    quoteValue: base.quoteValue + (patch.quoteValue ?? 0),
    orderCount: base.orderCount + (patch.orderCount ?? 0),
    orderValue: base.orderValue + (patch.orderValue ?? 0),
    invoicedValue: base.invoicedValue + (patch.invoicedValue ?? 0),
  };
}

/**
 * Pure: rows in, read model out. The queries are the impure half (fetchCrmOverviewSummary).
 */
export function composeCrmOverviewSummary(rows: CrmOverviewRows, window: CrmOverviewWindow): CrmOverviewSummary {
  const activeQuotes = rows.quoteStocks.filter((quote) => ACTIVE_QUOTE_STATUSES.includes(quote.status as CrmQuoteStatus));
  const openOrders = rows.orderStocks.filter((order) => OPEN_WORK_ORDER_STATUSES.includes(order.status as CrmWorkOrderStatus));
  const toInvoiceOrders = rows.orderStocks.filter((order) => TO_INVOICE_WORK_ORDER_STATUSES.includes(order.status as CrmWorkOrderStatus));

  const sum = (list: Array<{ amount: number | string }>) => list.reduce((total, row) => total + toAmount(row.amount), 0);

  // Every figure measured against a target is scoped to the current week, for the team and per
  // seller in the same pass — so the team row and the leaderboard row for the same metric are the
  // same arithmetic and can be checked against each other.
  //
  // Order value is attributed to when the order was won, invoiced revenue to when it was BILLED.
  // Bucketing invoiced revenue on created_at was the biggest data error the reports have had (it
  // hid 371 323 kr of 450 101 kr in one month, PR #70) — the lag from order to invoice runs about
  // a month, so the two dates are not interchangeable.
  let weekTeam = NO_ACTUALS;
  const weekByUser: Record<string, CrmOverviewWeekActuals> = {};
  const addWeek = (userId: string | null, patch: Partial<CrmOverviewWeekActuals>) => {
    weekTeam = addActuals(weekTeam, patch);
    // A row with no assignee still belongs to the team; it just belongs to nobody in the list.
    if (userId) weekByUser[userId] = addActuals(weekByUser[userId] ?? NO_ACTUALS, patch);
  };

  for (const call of rows.callWindow) {
    if (inWindow(call.call_at, window.weekStart, window.weekEnd)) addWeek(call.user_id, { calls: 1 });
  }
  for (const quote of rows.quoteWindow) {
    if (!inWindow(quote.quote_date, window.weekStart, window.weekEnd)) continue;
    addWeek(quote.assigned_to, { quotes: 1, quoteValue: toAmount(quote.amount) });
  }
  for (const order of rows.orderWindow) {
    if (inWindow(order.created_at, window.weekStart, window.weekEnd)) {
      addWeek(order.assigned_to, { orderCount: 1, orderValue: toAmount(order.amount) });
    }
    if (order.status === 'invoiced' && inWindow(order.fortnox_invoiced_at, window.weekStart, window.weekEnd)) {
      addWeek(order.assigned_to, { invoicedValue: toAmount(order.amount) });
    }
  }

  const callsInWindow = rows.callWindow.filter((call) => inWindow(call.call_at, window.since));
  const openTaskDays = rows.openTasks.map((task) => dayOf(task.due_at));

  return {
    pipelineProspects: rows.counts.pipelineProspects,
    newProspects: rows.counts.newProspects,
    quotedProspects: rows.counts.quotedProspects,
    qualifiedProspects: rows.counts.qualifiedProspects,

    activeQuotes: activeQuotes.length,
    activeQuoteValue: sum(activeQuotes),
    quoteFollowUps: rows.quoteStocks.filter((quote) => quote.status === 'follow_up').length,

    openWorkOrders: openOrders.length,
    openOrderValue: sum(openOrders),
    workOrdersToInvoice: toInvoiceOrders.length,
    toInvoiceOrderValue: sum(toInvoiceOrders),

    // All three read from the rows and the window alone — no query row-count is trusted, which is
    // what makes them testable without a database. The two follow-up figures are WINDOWED on
    // purpose: they drive "Att agera på", so they have to describe a workload you can still act on.
    // Counted over all time they would only ever grow — `outcome` is a permanent historical fact
    // with no resolution flag, so a call marked "följ upp" in June would still be demanding
    // attention in December.
    callsLast7Days: callsInWindow.length,
    followUpCalls: callsInWindow.filter((call) => call.outcome === 'follow_up').length,
    standaloneCalls: callsInWindow.filter((call) => call.prospect_id == null).length,

    openTasks: rows.openTasks.length,
    overdueTasks: openTaskDays.filter((day) => day != null && day < window.today).length,
    todayTasks: openTaskDays.filter((day) => day === window.today).length,

    weekTeam,
    weekByUser,
    truncated: rows.truncated,
  };
}

type CountableQuery = PromiseLike<{ count: number | null; error: { message: string } | null }>;
type RowQuery<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function readRows<T>(name: string, query: RowQuery<T>, truncated: string[]): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${name}: ${error.message}`);
  const rows = data ?? [];
  if (rows.length >= ROW_CAP) truncated.push(name);
  return rows;
}

async function readCount(name: string, query: CountableQuery): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`${name}: ${error.message}`);
  return count ?? 0;
}

/**
 * Reads the overview's numbers with the caller's Supabase client, so RLS decides what counts —
 * the same scoping the page had when it counted list rows in the browser. That matters most for
 * the tasks: dashboard_work_items is the reader's PERSONAL board, and its row policy is what keeps
 * these three numbers personal.
 */
export async function fetchCrmOverviewSummary(
  supabase: SupabaseClient,
  window: CrmOverviewWindow,
): Promise<CrmOverviewSummary> {
  const truncated: string[] = [];
  const prospectCount = (build: (q: any) => any, name: string) =>
    readCount(name, build(supabase.from('crm_customers').select('id', { count: 'exact', head: true }).eq('customer_stage', 'prospect')));

  const [
    quoteStocks,
    quoteWindow,
    orderStocks,
    orderWindow,
    callWindow,
    openTasks,
    pipelineProspects,
    newProspects,
    quotedProspects,
    qualifiedProspects,
  ] = await Promise.all([
    readRows<QuoteStockRow>('quote_stocks', supabase
      .from('crm_quotes')
      .select('status, amount')
      .in('status', ACTIVE_QUOTE_STATUSES)
      .limit(ROW_CAP), truncated),
    // Only the week is read: every quote figure on the page is either a stock (above) or measured
    // against the weekly target. `since` would fetch days nothing reads.
    readRows<QuoteWindowRow>('quote_window', supabase
      .from('crm_quotes')
      .select('amount, quote_date, assigned_to')
      .gte('quote_date', window.weekStart)
      .limit(ROW_CAP), truncated),
    readRows<OrderStockRow>('order_stocks', supabase
      .from('crm_work_orders')
      .select('status, amount')
      .in('status', [...OPEN_WORK_ORDER_STATUSES, ...TO_INVOICE_WORK_ORDER_STATUSES])
      .limit(ROW_CAP), truncated),
    // Superset: created in the week OR invoiced in it. An order created in June and invoiced this
    // week belongs to one figure each, and to neither date alone, so it must be fetched on either.
    readRows<OrderWindowRow>('order_window', supabase
      .from('crm_work_orders')
      .select('status, amount, created_at, fortnox_invoiced_at, assigned_to')
      .or(`created_at.gte.${window.weekStart},fortnox_invoiced_at.gte.${window.weekStart}`)
      .limit(ROW_CAP), truncated),
    // The widest window on the page: the calls metric card is explicitly the rolling 7 days, and the
    // week is a subset of it, so one read serves both. outcome + prospect_id come along because the
    // two follow-up figures are counted from these same rows instead of by their own scans.
    readRows<CallWindowRow>('call_window', supabase
      .from('crm_calls')
      .select('user_id, call_at, outcome, prospect_id')
      .gte('call_at', window.since)
      .limit(ROW_CAP), truncated),
    // 'active' is the stored value the task domain maps to 'open'; 'done' and 'cancelled' are out.
    readRows<TaskDueRow>('open_tasks', supabase
      .from('dashboard_work_items')
      .select('due_at')
      .eq('kind', 'note')
      .eq('status', 'active')
      .limit(ROW_CAP), truncated),
    prospectCount((q) => q.in('status', PIPELINE_PROSPECT_STATUSES), 'prospects_pipeline'),
    prospectCount((q) => q.eq('status', 'new'), 'prospects_new'),
    prospectCount((q) => q.eq('status', 'quoted'), 'prospects_quoted'),
    prospectCount((q) => q.in('status', ['qualified', 'quoted']), 'prospects_qualified'),
  ]);

  return composeCrmOverviewSummary(
    {
      quoteStocks,
      quoteWindow,
      orderStocks,
      orderWindow,
      callWindow,
      openTasks,
      counts: { pipelineProspects, newProspects, quotedProspects, qualifiedProspects },
      truncated,
    },
    window,
  );
}
