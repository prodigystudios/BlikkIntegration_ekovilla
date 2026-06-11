import type { SupabaseClient } from '@supabase/supabase-js';

// Sales reporting domain. The pure aggregation helpers (build*) take plain rows and
// return report-ready shapes so they can be unit-tested in isolation; fetchReportData
// is the only side-effecting part. Reporting is a team-wide aggregated read model, so
// the route runs it with the admin client (profiles RLS only allows self-reads with a
// session client — same reason the goals route uses the admin client).

export type ReportRange = { from: string; to: string }; // YYYY-MM-DD, inclusive

export type ReportQuoteRow = {
  amount: number | string | null;
  status: string | null;
  quote_date: string | null;
  assigned_to: string | null;
  customer_name: string | null;
};

export type ReportOrderRow = {
  amount: number | string | null;
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
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

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

// ── Aggregations (pure) ──

export type SalesOverTimePoint = { period: string; quoteValue: number; orderValue: number; invoicedValue: number };

export function buildSalesOverTime(quotes: ReportQuoteRow[], orders: ReportOrderRow[], months: string[]): SalesOverTimePoint[] {
  const quoteByMonth = new Map<string, number>();
  const orderByMonth = new Map<string, number>();
  const invoicedByMonth = new Map<string, number>();

  for (const q of quotes) {
    const key = monthKey(q.quote_date);
    if (key) quoteByMonth.set(key, (quoteByMonth.get(key) || 0) + num(q.amount));
  }
  for (const o of orders) {
    const key = monthKey(o.created_at);
    if (key) orderByMonth.set(key, (orderByMonth.get(key) || 0) + num(o.amount));
    if (o.status === 'invoiced') {
      // Invoiced revenue belongs to the month it was INVOICED, not when the order was
      // created (those can differ by months). Fall back to the creation month for older
      // rows that predate fortnox_invoiced_at. NOTE: orders are fetched by created_at, so an
      // order invoiced in-range but created before the range isn't included here.
      //
      // DELFAKTURERING CAVEAT (deferred): a `partially_invoiced` order is excluded here, so its
      // already-billed amount is undercounted until the final round flips it to `invoiced` (then
      // the FULL order amount lands in the final round's month). Precise per-round attribution —
      // summing crm_work_order_invoices.amount by each round's created_at — is roadmap D2 and is
      // intentionally not wired in yet. `orderValue` is status-agnostic and unaffected.
      const invoicedKey = monthKey(o.fortnox_invoiced_at) || key;
      if (invoicedKey) invoicedByMonth.set(invoicedKey, (invoicedByMonth.get(invoicedKey) || 0) + num(o.amount));
    }
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
  orderValue: number;
  invoicedValue: number;
};

export function buildPerSeller(
  quotes: ReportQuoteRow[],
  orders: ReportOrderRow[],
  calls: ReportCallRow[],
  sellers: ReportSellerRow[],
): SellerReportRow[] {
  const nameMap = new Map(sellers.map((s) => [s.id, s.full_name || 'Okänd användare']));
  const acc = new Map<string, SellerReportRow>();
  const ensure = (id: string): SellerReportRow => {
    let row = acc.get(id);
    if (!row) {
      row = { userId: id, userName: nameMap.get(id) || 'Okänd användare', calls: 0, quotes: 0, quoteValue: 0, wonValue: 0, orderValue: 0, invoicedValue: 0 };
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
    row.quoteValue += num(q.amount);
    if (q.status === 'won') row.wonValue += num(q.amount);
  }
  for (const o of orders) {
    if (!o.assigned_to) continue;
    const row = ensure(o.assigned_to);
    row.orderValue += num(o.amount);
    if (o.status === 'invoiced') row.invoicedValue += num(o.amount);
  }

  return [...acc.values()].sort((a, b) => b.orderValue - a.orderValue || b.quoteValue - a.quoteValue || a.userName.localeCompare(b.userName, 'sv'));
}

export type FunnelStage = { count: number; value: number };
export type SalesFunnel = { quotes: FunnelStage; won: FunnelStage; orders: FunnelStage; invoiced: FunnelStage };

export function buildFunnel(quotes: ReportQuoteRow[], orders: ReportOrderRow[]): SalesFunnel {
  const won = quotes.filter((q) => q.status === 'won');
  const invoiced = orders.filter((o) => o.status === 'invoiced');
  const sum = (rows: Array<{ amount: number | string | null }>) => rows.reduce((t, r) => t + num(r.amount), 0);
  return {
    quotes: { count: quotes.length, value: sum(quotes) },
    won: { count: won.length, value: sum(won) },
    orders: { count: orders.length, value: sum(orders) },
    invoiced: { count: invoiced.length, value: sum(invoiced) },
  };
}

export type CustomerReportRow = { customer: string; orderValue: number; invoicedValue: number; orderCount: number };

export function buildPerCustomer(orders: ReportOrderRow[], topN = 10): CustomerReportRow[] {
  const acc = new Map<string, CustomerReportRow>();
  for (const o of orders) {
    const customer = (o.client_name || '').trim() || 'Okänd kund';
    let row = acc.get(customer);
    if (!row) {
      row = { customer, orderValue: 0, invoicedValue: 0, orderCount: 0 };
      acc.set(customer, row);
    }
    row.orderValue += num(o.amount);
    row.orderCount += 1;
    if (o.status === 'invoiced') row.invoicedValue += num(o.amount);
  }
  return [...acc.values()].sort((a, b) => b.orderValue - a.orderValue).slice(0, topN);
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
  return {
    range,
    salesOverTime: buildSalesOverTime(data.quotes, data.orders, months),
    perSeller: buildPerSeller(data.quotes, data.orders, data.calls, data.sellers),
    funnel: buildFunnel(data.quotes, data.orders),
    perCustomer: buildPerCustomer(data.orders),
  };
}

// ── Fetch (admin client; team-wide read model) ──
export async function fetchReportData(admin: SupabaseClient, range: ReportRange): Promise<ReportData> {
  const toEnd = `${range.to}T23:59:59.999Z`;
  const [quotesRes, ordersRes, callsRes, sellersRes] = await Promise.all([
    admin.from('crm_quotes').select('amount, status, quote_date, assigned_to, customer_name').gte('quote_date', range.from).lte('quote_date', range.to),
    admin.from('crm_work_orders').select('amount, status, created_at, fortnox_invoiced_at, assigned_to, client_name').gte('created_at', range.from).lte('created_at', toEnd),
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
