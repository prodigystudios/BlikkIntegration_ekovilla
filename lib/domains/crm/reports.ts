import type { SupabaseClient } from '@supabase/supabase-js';
import { netAmount, type NetAmountRow } from './pricing';
import { isDeadWorkOrder } from './work-orders';

// Sales reporting domain. The pure aggregation helpers (build*) take plain rows and
// return report-ready shapes so they can be unit-tested in isolation; fetchReportData
// is the only side-effecting part. Reporting is a team-wide aggregated read model, so
// the route runs it with the admin client (profiles RLS only allows self-reads with a
// session client — same reason the goals route uses the admin client).

export type ReportRange = { from: string; to: string }; // YYYY-MM-DD, inclusive

export type ReportQuoteRow = NetAmountRow & {
  status: string | null;
  quote_date: string | null;
  assigned_to: string | null;
  customer_name: string | null;
};

export type ReportOrderRow = NetAmountRow & {
  status: string | null;
  created_at: string;
  fortnox_invoiced_at: string | null;
  assigned_to: string | null;
  client_name: string | null;
};

export type ReportCallRow = { user_id: string | null; call_at: string };
export type ReportSellerRow = { id: string; full_name: string | null };

export type ReportData = {
  quotes: ReportQuoteRow[];
  orders: ReportOrderRow[];
  calls: ReportCallRow[];
  sellers: ReportSellerRow[];
};

// ── Helpers ──
// Ingen rå beloppsläsare här med flit: varje krontal i rapporten går genom netAmount, och en
// lokal num() hade varit en öppen dörr tillbaka till bruttot.
function monthKey(date: string | null | undefined): string | null {
  if (!date) return null;
  const key = String(date).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

// Inclusive list of YYYY-MM between from and to (capped to avoid runaway ranges).
export function monthsInRange(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const out: string[] = [];
  let year = fy;
  let month = fm;
  for (let i = 0; i < 240 && (year < ty || (year === ty && month <= tm)); i++) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return out;
}

// ── Order partitioning ──
//
// An order billed in August was usually created weeks or months earlier — median lag is a
// month. Fetching orders on created_at alone therefore dropped that revenue from the
// period it was actually billed in: for August 2026 it hid 371 323 kr of 450 101 kr, so
// the report showed 18 % of what had really been invoiced. The fetch now pulls a superset
// (created in range OR invoiced in range) and the rows are split here, so every figure is
// keyed to the date that belongs to it: order value to when the order was won, invoiced
// revenue to when it was billed.

/** The date an order's revenue is attributed to. Rows predating fortnox_invoiced_at fall back to their creation date. */
export function invoicedAt(order: ReportOrderRow): string {
  return order.fortnox_invoiced_at || order.created_at;
}

/** Inclusive day comparison against the range, matching how the fetch filters. */
function withinRange(timestamp: string | null | undefined, range: ReportRange): boolean {
  if (!timestamp) return false;
  const day = String(timestamp).slice(0, 10);
  return day >= range.from && day <= range.to;
}

export type PartitionedOrders = {
  /** Orders created inside the range, minus the cancelled ones — the basis for order value and the conversion funnel. */
  created: ReportOrderRow[];
  /** Orders billed inside the range, whenever they were created — the basis for invoiced revenue. */
  invoiced: ReportOrderRow[];
};

export function partitionOrders(orders: ReportOrderRow[], range: ReportRange): PartitionedOrders {
  return {
    // Avbrutna order faller bort här och inte i varje aggregat: en order som aldrig blev av är
    // ingen omsättning, och då ska den inte synas som ordervärde, som ett antal order eller som
    // ett steg i tratten. Ett enda ställe att hålla rätt på i stället för fyra.
    created: orders.filter((o) => !isDeadWorkOrder(o.status) && withinRange(o.created_at, range)),
    // Ingen motsvarande vakt behövs här: status kan inte vara både 'invoiced' och 'cancelled'.
    // En order som fakturerats och SEDAN avbrutits faller alltså ur fakturerat helt — rätt så
    // länge en avbeställning krediteras, och det finns ingen sådan rad i drift (mätt 2026-08-21).
    invoiced: orders.filter((o) => o.status === 'invoiced' && withinRange(invoicedAt(o), range)),
  };
}

// ── Aggregations (pure) ──

export type SalesOverTimePoint = { period: string; quoteValue: number; orderValue: number; invoicedValue: number };

export function buildSalesOverTime(
  quotes: ReportQuoteRow[],
  ordersCreated: ReportOrderRow[],
  ordersInvoiced: ReportOrderRow[],
  months: string[],
): SalesOverTimePoint[] {
  const quoteByMonth = new Map<string, number>();
  const orderByMonth = new Map<string, number>();
  const invoicedByMonth = new Map<string, number>();

  for (const q of quotes) {
    const key = monthKey(q.quote_date);
    if (key) quoteByMonth.set(key, (quoteByMonth.get(key) || 0) + netAmount(q));
  }
  for (const o of ordersCreated) {
    const key = monthKey(o.created_at);
    if (key) orderByMonth.set(key, (orderByMonth.get(key) || 0) + netAmount(o));
  }
  // Invoiced revenue belongs to the month it was INVOICED, not when the order was created.
  //
  // DELFAKTURERING CAVEAT (deferred): a `partially_invoiced` order is excluded here, so its
  // already-billed amount is undercounted until the final round flips it to `invoiced` (then
  // the FULL order amount lands in the final round's month). Precise per-round attribution —
  // summing crm_work_order_invoices.amount by each round's created_at — is roadmap D2 and is
  // intentionally not wired in yet. `orderValue` is status-agnostic and unaffected.
  for (const o of ordersInvoiced) {
    const key = monthKey(invoicedAt(o));
    if (key) invoicedByMonth.set(key, (invoicedByMonth.get(key) || 0) + netAmount(o));
  }

  return months.map((period) => ({
    period,
    quoteValue: quoteByMonth.get(period) || 0,
    orderValue: orderByMonth.get(period) || 0,
    invoicedValue: invoicedByMonth.get(period) || 0,
  }));
}

export type SellerReportRow = {
  userId: string;
  userName: string;
  calls: number;
  quotes: number;
  quoteValue: number;
  wonValue: number;
  // Antal arbetsordrar SKAPADE i perioden — samma rader som orderValue summerar, så talet och
  // värdet bredvid varandra svarar på samma fråga. En order som fakturerades i perioden men
  // skapades tidigare räknas alltså inte här; den syns i invoicedValue, precis som avsett.
  orders: number;
  orderValue: number;
  invoicedValue: number;
};

export function buildPerSeller(
  quotes: ReportQuoteRow[],
  ordersCreated: ReportOrderRow[],
  ordersInvoiced: ReportOrderRow[],
  calls: ReportCallRow[],
  sellers: ReportSellerRow[],
): SellerReportRow[] {
  const nameMap = new Map(sellers.map((s) => [s.id, s.full_name || 'Okänd användare']));
  const acc = new Map<string, SellerReportRow>();
  const ensure = (id: string): SellerReportRow => {
    let row = acc.get(id);
    if (!row) {
      row = { userId: id, userName: nameMap.get(id) || 'Okänd användare', calls: 0, quotes: 0, quoteValue: 0, wonValue: 0, orders: 0, orderValue: 0, invoicedValue: 0 };
      acc.set(id, row);
    }
    return row;
  };

  for (const c of calls) {
    if (c.user_id) ensure(c.user_id).calls += 1;
  }
  for (const q of quotes) {
    if (!q.assigned_to) continue;
    const row = ensure(q.assigned_to);
    row.quotes += 1;
    row.quoteValue += netAmount(q);
    if (q.status === 'won') row.wonValue += netAmount(q);
  }
  // A seller can show invoiced revenue this period from an order won in an earlier one —
  // that is the point of the split, not a bug.
  for (const o of ordersCreated) {
    if (!o.assigned_to) continue;
    const row = ensure(o.assigned_to);
    row.orders += 1;
    row.orderValue += netAmount(o);
  }
  for (const o of ordersInvoiced) {
    if (!o.assigned_to) continue;
    ensure(o.assigned_to).invoicedValue += netAmount(o);
  }

  return [...acc.values()].sort((a, b) => b.orderValue - a.orderValue || b.quoteValue - a.quoteValue || a.userName.localeCompare(b.userName, 'sv'));
}

export type FunnelStage = { count: number; value: number };
export type SalesFunnel = { quotes: FunnelStage; won: FunnelStage; orders: FunnelStage; invoiced: FunnelStage };

/**
 * A cohort view, deliberately: of what ENTERED in this period, how far did it get. The
 * invoiced stage therefore counts orders created in the range that have since been billed,
 * not everything billed during it — a stage fed from other periods would break the chain
 * and could push the last conversion above 100 %. That is why this figure can differ from
 * the invoiced revenue in the chart and the per-seller table; they answer different
 * questions, and the section subtitles say which.
 */
export function buildFunnel(quotes: ReportQuoteRow[], ordersCreated: ReportOrderRow[]): SalesFunnel {
  const won = quotes.filter((q) => q.status === 'won');
  const invoiced = ordersCreated.filter((o) => o.status === 'invoiced');
  const sum = (rows: NetAmountRow[]) => rows.reduce((t, r) => t + netAmount(r), 0);
  return {
    quotes: { count: quotes.length, value: sum(quotes) },
    won: { count: won.length, value: sum(won) },
    orders: { count: ordersCreated.length, value: sum(ordersCreated) },
    invoiced: { count: invoiced.length, value: sum(invoiced) },
  };
}

export type CustomerReportRow = { customer: string; orderValue: number; invoicedValue: number; orderCount: number };

export function buildPerCustomer(
  ordersCreated: ReportOrderRow[],
  ordersInvoiced: ReportOrderRow[],
  topN = 10,
): CustomerReportRow[] {
  const acc = new Map<string, CustomerReportRow>();
  const ensure = (order: ReportOrderRow): CustomerReportRow => {
    const customer = (order.client_name || '').trim() || 'Okänd kund';
    let row = acc.get(customer);
    if (!row) {
      row = { customer, orderValue: 0, invoicedValue: 0, orderCount: 0 };
      acc.set(customer, row);
    }
    return row;
  };

  for (const o of ordersCreated) {
    const row = ensure(o);
    row.orderValue += netAmount(o);
    row.orderCount += 1;
  }
  // A customer billed this period whose order was placed in an earlier one lands here with
  // no order value of its own. Truthful: the money moved this period, the order did not.
  for (const o of ordersInvoiced) {
    ensure(o).invoicedValue += netAmount(o);
  }

  // Ranked on total activity, not order value alone: a customer billed 330 480 kr this
  // period on an order placed earlier has no order value at all, and sorting on that field
  // would push exactly the rows this split exists to surface off the end of the top ten —
  // leaving the table and its CSV short of what the chart above them shows.
  const activity = (row: CustomerReportRow) => row.orderValue + row.invoicedValue;
  return [...acc.values()]
    .sort((a, b) => activity(b) - activity(a) || b.orderValue - a.orderValue || a.customer.localeCompare(b.customer, 'sv'))
    .slice(0, topN);
}

export type SalesReport = {
  range: ReportRange;
  salesOverTime: SalesOverTimePoint[];
  perSeller: SellerReportRow[];
  funnel: SalesFunnel;
  perCustomer: CustomerReportRow[];
};

export function composeSalesReport(data: ReportData, range: ReportRange): SalesReport {
  const months = monthsInRange(range.from, range.to);
  const orders = partitionOrders(data.orders, range);
  return {
    range,
    salesOverTime: buildSalesOverTime(data.quotes, orders.created, orders.invoiced, months),
    perSeller: buildPerSeller(data.quotes, orders.created, orders.invoiced, data.calls, data.sellers),
    funnel: buildFunnel(data.quotes, orders.created),
    perCustomer: buildPerCustomer(orders.created, orders.invoiced),
  };
}

// ── Fetch (admin client; team-wide read model) ──
//
// `vat_percent` och `pricing_summary` hämtas för att varje belopp ska kunna redovisas ex moms —
// se netAmount. Utan dem faller nettot tillbaka på en antagen momssats, vilket bara är en
// nödutgång och inte den väg någon rad ska ta.
export async function fetchReportData(admin: SupabaseClient, range: ReportRange): Promise<ReportData> {
  const toEnd = `${range.to}T23:59:59.999Z`;
  const [quotesRes, ordersRes, callsRes, sellersRes] = await Promise.all([
    admin.from('crm_quotes').select('amount, vat_percent, pricing_summary, status, quote_date, assigned_to, customer_name').gte('quote_date', range.from).lte('quote_date', range.to),
    // Superset: created in range OR billed in range. Filtering on created_at alone dropped
    // revenue from every order billed later than the period it was won in — see
    // partitionOrders. The rows are split back apart there.
    admin.from('crm_work_orders')
      .select('amount, vat_percent, pricing_summary, status, created_at, fortnox_invoiced_at, assigned_to, client_name')
      .or(`and(created_at.gte.${range.from},created_at.lte.${toEnd}),and(fortnox_invoiced_at.gte.${range.from},fortnox_invoiced_at.lte.${toEnd})`),
    admin.from('crm_calls').select('user_id, call_at').gte('call_at', range.from).lte('call_at', toEnd),
    admin.from('profiles').select('id, full_name, role').in('role', ['sales', 'admin', 'konsult']),
  ]);

  const firstError = quotesRes.error || ordersRes.error || callsRes.error || sellersRes.error;
  if (firstError) throw new Error(firstError.message);

  return {
    quotes: (quotesRes.data as ReportQuoteRow[]) || [],
    orders: (ordersRes.data as ReportOrderRow[]) || [],
    calls: (callsRes.data as ReportCallRow[]) || [],
    sellers: (sellersRes.data as ReportSellerRow[]) || [],
  };
}
