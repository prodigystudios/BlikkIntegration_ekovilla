import { describe, it, expect } from 'vitest';
import {
  monthsInRange,
  partitionOrders,
  invoicedAt,
  buildSalesOverTime,
  buildPerSeller,
  buildFunnel,
  buildPerCustomer,
  composeSalesReport,
  type ReportQuoteRow,
  type ReportOrderRow,
  type ReportCallRow,
  type ReportSellerRow,
} from '@/lib/domains/crm/reports';

const quotes: ReportQuoteRow[] = [
  { amount: 1000, status: 'won', quote_date: '2026-01-15', assigned_to: 'u1', customer_name: 'Kund A' },
  { amount: '2000', status: 'sent', quote_date: '2026-01-20', assigned_to: 'u2', customer_name: 'Kund B' },
  { amount: 500, status: 'lost', quote_date: '2026-02-03', assigned_to: 'u1', customer_name: 'Kund A' },
];

const orders: ReportOrderRow[] = [
  { amount: 1000, status: 'invoiced', created_at: '2026-01-18T10:00:00Z', fortnox_invoiced_at: null, assigned_to: 'u1', client_name: 'Kund A' },
  { amount: 3000, status: 'in_progress', created_at: '2026-02-10T10:00:00Z', fortnox_invoiced_at: null, assigned_to: 'u2', client_name: 'Kund B' },
  { amount: 1500, status: 'invoiced', created_at: '2026-02-12T10:00:00Z', fortnox_invoiced_at: null, assigned_to: 'u1', client_name: 'Kund A' },
];

const calls: ReportCallRow[] = [
  { user_id: 'u1', call_at: '2026-01-10T09:00:00Z' },
  { user_id: 'u1', call_at: '2026-01-11T09:00:00Z' },
  { user_id: 'u2', call_at: '2026-02-01T09:00:00Z' },
];

const sellers: ReportSellerRow[] = [
  { id: 'u1', full_name: 'Anna' },
  { id: 'u2', full_name: 'Björn' },
];

// Every fixture order above is both created and invoiced inside this range, so the split
// leaves the original expectations intact — the new behaviour is exercised separately below.
const RANGE = { from: '2026-01-01', to: '2026-02-28' };
const split = partitionOrders(orders, RANGE);

describe('monthsInRange', () => {
  it('lists inclusive months across a year boundary', () => {
    expect(monthsInRange('2025-11-01', '2026-02-28')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('returns a single month when from and to share it', () => {
    expect(monthsInRange('2026-01-05', '2026-01-25')).toEqual(['2026-01']);
  });
});

describe('buildSalesOverTime', () => {
  it('buckets quote/order/invoiced value by month', () => {
    const result = buildSalesOverTime(quotes, split.created, split.invoiced, ['2026-01', '2026-02']);
    expect(result).toEqual([
      { period: '2026-01', quoteValue: 3000, orderValue: 1000, invoicedValue: 1000 },
      { period: '2026-02', quoteValue: 500, orderValue: 4500, invoicedValue: 1500 },
    ]);
  });

  // Regression: invoiced revenue is bucketed by the INVOICE date, not the order's creation
  // month. An order created in January but invoiced in February counts toward February's
  // invoiced value (its order value still belongs to January).
  it('buckets invoiced value by fortnox_invoiced_at, not created_at', () => {
    const crossMonth: ReportOrderRow[] = [
      { amount: 2000, status: 'invoiced', created_at: '2026-01-30T10:00:00Z', fortnox_invoiced_at: '2026-02-04T08:00:00Z', assigned_to: 'u1', client_name: 'Kund A' },
    ];
    const crossSplit = partitionOrders(crossMonth, RANGE);
    const result = buildSalesOverTime([], crossSplit.created, crossSplit.invoiced, ['2026-01', '2026-02']);
    expect(result).toEqual([
      { period: '2026-01', quoteValue: 0, orderValue: 2000, invoicedValue: 0 },
      { period: '2026-02', quoteValue: 0, orderValue: 0, invoicedValue: 2000 },
    ]);
  });
});

describe('buildPerSeller', () => {
  it('aggregates calls, quotes and order value per seller', () => {
    const rows = buildPerSeller(quotes, split.created, split.invoiced, calls, sellers);
    const anna = rows.find((r) => r.userId === 'u1')!;
    const bjorn = rows.find((r) => r.userId === 'u2')!;
    expect(anna).toMatchObject({ userName: 'Anna', calls: 2, quotes: 2, quoteValue: 1500, wonValue: 1000, orders: 2, orderValue: 2500, invoicedValue: 2500 });
    expect(bjorn).toMatchObject({ userName: 'Björn', calls: 1, quotes: 1, quoteValue: 2000, wonValue: 0, orders: 1, orderValue: 3000, invoicedValue: 0 });
  });
  it('sorts by order value descending', () => {
    const rows = buildPerSeller(quotes, split.created, split.invoiced, calls, sellers);
    expect(rows[0].userId).toBe('u2'); // 3000 > 2500
  });
});

describe('buildFunnel', () => {
  it('counts and sums each stage', () => {
    const f = buildFunnel(quotes, split.created);
    expect(f.quotes).toEqual({ count: 3, value: 3500 });
    expect(f.won).toEqual({ count: 1, value: 1000 });
    expect(f.orders).toEqual({ count: 3, value: 5500 });
    expect(f.invoiced).toEqual({ count: 2, value: 2500 });
  });
});

describe('buildPerCustomer', () => {
  it('aggregates by customer and ranks on total activity in the period', () => {
    const rows = buildPerCustomer(split.created, split.invoiced);
    // Ordered on order value + invoiced value, so Kund A (2500 + 2500) outranks Kund B
    // (3000 + 0). Ranking on order value alone would bury customers whose activity in the
    // period was an invoice against an order placed earlier.
    expect(rows[0]).toEqual({ customer: 'Kund A', orderValue: 2500, invoicedValue: 2500, orderCount: 2 });
    expect(rows[1]).toEqual({ customer: 'Kund B', orderValue: 3000, invoicedValue: 0, orderCount: 1 });
  });
  it('falls back to a placeholder for missing client names', () => {
    const rows = buildPerCustomer([{ amount: 100, status: 'draft', created_at: '2026-01-01T00:00:00Z', fortnox_invoiced_at: null, assigned_to: null, client_name: null }], []);
    expect(rows[0].customer).toBe('Okänd kund');
  });
});

describe('composeSalesReport', () => {
  it('assembles all four report sections', () => {
    const report = composeSalesReport({ quotes, orders, calls, sellers }, { from: '2026-01-01', to: '2026-02-28' });
    expect(report.salesOverTime).toHaveLength(2);
    expect(report.perSeller).toHaveLength(2);
    expect(report.funnel.quotes.count).toBe(3);
    expect(report.perCustomer).toHaveLength(2);
    expect(report.range).toEqual({ from: '2026-01-01', to: '2026-02-28' });
  });
});

// ── Revenue billed in the range from an order won earlier ──
//
// The regression this whole split exists for. Orders used to be fetched on created_at
// alone, so an order won in June and billed in August vanished from August entirely —
// against live data that hid 371 323 kr of 450 101 kr, i.e. the report showed 18 % of what
// had actually been invoiced. The short-period presets made it a one-click trap.
describe('orders billed in-range but created earlier', () => {
  const FEB = { from: '2026-02-01', to: '2026-02-28' };
  // Won in January for 9000, billed in February — only the invoice lands in February.
  const earlierOrder: ReportOrderRow = {
    amount: 9000, status: 'invoiced', created_at: '2026-01-05T10:00:00Z',
    fortnox_invoiced_at: '2026-02-09T08:00:00Z', assigned_to: 'u1', client_name: 'Kund C',
  };
  const febOrder: ReportOrderRow = {
    amount: 1000, status: 'in_progress', created_at: '2026-02-03T10:00:00Z',
    fortnox_invoiced_at: null, assigned_to: 'u2', client_name: 'Kund D',
  };
  const febSplit = partitionOrders([earlierOrder, febOrder], FEB);

  it('counts it as invoiced but not as order value', () => {
    expect(febSplit.invoiced).toEqual([earlierOrder]);
    expect(febSplit.created).toEqual([febOrder]);
  });

  it('puts its revenue in the invoiced line and leaves order value alone', () => {
    const result = buildSalesOverTime([], febSplit.created, febSplit.invoiced, ['2026-02']);
    expect(result).toEqual([{ period: '2026-02', quoteValue: 0, orderValue: 1000, invoicedValue: 9000 }]);
  });

  it('credits the seller with the revenue without inflating their order value', () => {
    const rows = buildPerSeller([], febSplit.created, febSplit.invoiced, [], sellers);
    expect(rows.find((r) => r.userId === 'u1')).toMatchObject({ orderValue: 0, invoicedValue: 9000 });
    expect(rows.find((r) => r.userId === 'u2')).toMatchObject({ orderValue: 1000, invoicedValue: 0 });
  });

  // Antalet order hör ihop med ordervärdet: en order som fakturerades i perioden men skapades
  // tidigare får inte räknas, annars visar kolumnen ett antal som värdet bredvid inte täcker.
  it('counts only the orders created in the range, matching the order value', () => {
    const rows = buildPerSeller([], febSplit.created, febSplit.invoiced, [], sellers);
    expect(rows.find((r) => r.userId === 'u1')).toMatchObject({ orders: 0, orderValue: 0 });
    expect(rows.find((r) => r.userId === 'u2')).toMatchObject({ orders: 1, orderValue: 1000 });
  });

  it('lists the customer with the money that moved and no order of its own', () => {
    const rows = buildPerCustomer(febSplit.created, febSplit.invoiced);
    expect(rows.find((r) => r.customer === 'Kund C')).toEqual({ customer: 'Kund C', orderValue: 0, invoicedValue: 9000, orderCount: 0 });
  });

  // Ranking on order value alone would drop exactly these rows off the end of the top ten,
  // leaving the per-customer table and CSV short of what the chart above them shows.
  it('keeps a big invoice-only customer inside the top list instead of truncating it', () => {
    const tenOrderingCustomers: ReportOrderRow[] = Array.from({ length: 10 }, (_, i) => ({
      amount: 1000, status: 'in_progress', created_at: '2026-02-05T10:00:00Z',
      fortnox_invoiced_at: null, assigned_to: null, client_name: `Kund ${i}`,
    }));
    const rows = buildPerCustomer(tenOrderingCustomers, [earlierOrder]);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ customer: 'Kund C', invoicedValue: 9000 });
  });

  // Below the top-N cut the two must agree to the krona — anything else means the split
  // dropped or double-counted a row. (Above the cut they legitimately differ: the table is
  // a top list, and rows 11+ are simply not shown.)
  it('accounts for every invoiced krona the chart shows when nothing is truncated', () => {
    const rows = buildPerCustomer(febSplit.created, febSplit.invoiced);
    const tableTotal = rows.reduce((t, r) => t + r.invoicedValue, 0);
    const chartTotal = buildSalesOverTime([], febSplit.created, febSplit.invoiced, ['2026-02'])[0].invoicedValue;
    expect(rows.length).toBeLessThan(10);
    expect(tableTotal).toBe(chartTotal);
  });

  // The funnel is a cohort view on purpose: of what entered in February, how far did it
  // get. Feeding it revenue from January's orders would break the chain and could push the
  // last conversion above 100 %.
  it('keeps the funnel on the period cohort and excludes it', () => {
    const f = buildFunnel([], febSplit.created);
    expect(f.orders).toEqual({ count: 1, value: 1000 });
    expect(f.invoiced).toEqual({ count: 0, value: 0 });
  });

  it('survives the whole composition end to end', () => {
    const report = composeSalesReport({ quotes: [], orders: [earlierOrder, febOrder], calls: [], sellers }, FEB);
    expect(report.salesOverTime[0].invoicedValue).toBe(9000);
    expect(report.funnel.invoiced.value).toBe(0);
  });
});

describe('invoicedAt', () => {
  it('uses the Fortnox invoice date when present', () => {
    expect(invoicedAt({ ...orders[0], fortnox_invoiced_at: '2026-03-01T00:00:00Z' })).toBe('2026-03-01T00:00:00Z');
  });

  // Rows created before the column existed carry no invoice date; attributing them to their
  // creation date is what the report did before and keeps history stable.
  it('falls back to the creation date for legacy rows', () => {
    expect(invoicedAt(orders[0])).toBe('2026-01-18T10:00:00Z');
  });
});

describe('partitionOrders', () => {
  const RANGE_JAN = { from: '2026-01-01', to: '2026-01-31' };

  it('excludes an order that is not invoiced even if it carries an invoice date', () => {
    const odd: ReportOrderRow = {
      amount: 500, status: 'in_progress', created_at: '2025-12-01T10:00:00Z',
      fortnox_invoiced_at: '2026-01-10T10:00:00Z', assigned_to: null, client_name: null,
    };
    expect(partitionOrders([odd], RANGE_JAN).invoiced).toEqual([]);
  });

  it('includes both ends of the range inclusively', () => {
    const edges: ReportOrderRow[] = [
      { amount: 1, status: 'invoiced', created_at: '2026-01-01T00:00:00Z', fortnox_invoiced_at: null, assigned_to: null, client_name: null },
      { amount: 2, status: 'invoiced', created_at: '2026-01-31T23:59:00Z', fortnox_invoiced_at: null, assigned_to: null, client_name: null },
    ];
    const result = partitionOrders(edges, RANGE_JAN);
    expect(result.created).toHaveLength(2);
    expect(result.invoiced).toHaveLength(2);
  });

  it('drops an order that falls outside the range on both dates', () => {
    const outside: ReportOrderRow = {
      amount: 700, status: 'invoiced', created_at: '2025-11-01T10:00:00Z',
      fortnox_invoiced_at: '2025-12-01T10:00:00Z', assigned_to: null, client_name: null,
    };
    const result = partitionOrders([outside], RANGE_JAN);
    expect(result.created).toEqual([]);
    expect(result.invoiced).toEqual([]);
  });
});
