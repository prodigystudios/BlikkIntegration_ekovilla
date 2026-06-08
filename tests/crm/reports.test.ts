import { describe, it, expect } from 'vitest';
import {
  monthsInRange,
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
    const result = buildSalesOverTime(quotes, orders, ['2026-01', '2026-02']);
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
    const result = buildSalesOverTime([], crossMonth, ['2026-01', '2026-02']);
    expect(result).toEqual([
      { period: '2026-01', quoteValue: 0, orderValue: 2000, invoicedValue: 0 },
      { period: '2026-02', quoteValue: 0, orderValue: 0, invoicedValue: 2000 },
    ]);
  });
});

describe('buildPerSeller', () => {
  it('aggregates calls, quotes and order value per seller', () => {
    const rows = buildPerSeller(quotes, orders, calls, sellers);
    const anna = rows.find((r) => r.userId === 'u1')!;
    const bjorn = rows.find((r) => r.userId === 'u2')!;
    expect(anna).toMatchObject({ userName: 'Anna', calls: 2, quotes: 2, quoteValue: 1500, wonValue: 1000, orderValue: 2500, invoicedValue: 2500 });
    expect(bjorn).toMatchObject({ userName: 'Björn', calls: 1, quotes: 1, quoteValue: 2000, wonValue: 0, orderValue: 3000, invoicedValue: 0 });
  });
  it('sorts by order value descending', () => {
    const rows = buildPerSeller(quotes, orders, calls, sellers);
    expect(rows[0].userId).toBe('u2'); // 3000 > 2500
  });
});

describe('buildFunnel', () => {
  it('counts and sums each stage', () => {
    const f = buildFunnel(quotes, orders);
    expect(f.quotes).toEqual({ count: 3, value: 3500 });
    expect(f.won).toEqual({ count: 1, value: 1000 });
    expect(f.orders).toEqual({ count: 3, value: 5500 });
    expect(f.invoiced).toEqual({ count: 2, value: 2500 });
  });
});

describe('buildPerCustomer', () => {
  it('aggregates by customer and sorts by order value', () => {
    const rows = buildPerCustomer(orders);
    // Sorted by order value descending → Kund B (3000) before Kund A (2500).
    expect(rows[0]).toEqual({ customer: 'Kund B', orderValue: 3000, invoicedValue: 0, orderCount: 1 });
    expect(rows[1]).toEqual({ customer: 'Kund A', orderValue: 2500, invoicedValue: 2500, orderCount: 2 });
  });
  it('falls back to a placeholder for missing client names', () => {
    const rows = buildPerCustomer([{ amount: 100, status: 'draft', created_at: '2026-01-01T00:00:00Z', fortnox_invoiced_at: null, assigned_to: null, client_name: null }]);
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
