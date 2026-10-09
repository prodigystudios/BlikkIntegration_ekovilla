import { describe, it, expect } from 'vitest';
import {
  monthsInRange,
  partitionOrders,
  invoicedAt,
  buildSalesOverTime,
  buildPerSeller,
  buildPerCustomer,
  composeSalesReport,
  buildPeriodTotals,
  type ReportQuoteRow,
  type ReportOrderRow,
  type ReportCallRow,
  type ReportSellerRow,
  type ReportInvoiceRoundRow,
} from '@/lib/domains/crm/reports';
import { buildTypicalOrder } from '@/lib/domains/crm/reportKpis';

// `vat_percent: 0` genomgående: fixturerna nedan prövar perioder, buckets och partitionering,
// och ett belopp som är sitt eget netto låter de förväntningarna handla om just det. Momsbasen
// har egna tester längst ned i filen.
const quotes: ReportQuoteRow[] = [
  { vat_percent: 0, amount: 1000, status: 'won', quote_date: '2026-01-15', assigned_to: 'u1', customer_name: 'Kund A', quote_type: 'business' },
  { vat_percent: 0, amount: '2000', status: 'sent', quote_date: '2026-01-20', assigned_to: 'u2', customer_name: 'Kund B', quote_type: 'business' },
  { vat_percent: 0, amount: 500, status: 'lost', quote_date: '2026-02-03', assigned_to: 'u1', customer_name: 'Kund A', quote_type: 'business' },
];

const orders: ReportOrderRow[] = [
  { vat_percent: 0, amount: 1000, status: 'invoiced', created_at: '2026-01-18T10:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund A', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
  { vat_percent: 0, amount: 3000, status: 'in_progress', created_at: '2026-02-10T10:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u2', client_name: 'Kund B', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
  { vat_percent: 0, amount: 1500, status: 'invoiced', created_at: '2026-02-12T10:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund A', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
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
const split = partitionOrders(orders, RANGE, []);

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
    const result = buildSalesOverTime(quotes, split.created, split.revenue, ['2026-01', '2026-02']);
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
      { vat_percent: 0, amount: 2000, status: 'invoiced', created_at: '2026-01-30T10:00:00Z', fortnox_invoiced_at: '2026-02-04T08:00:00Z', partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund A', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
    ];
    const crossSplit = partitionOrders(crossMonth, RANGE, []);
    const result = buildSalesOverTime([], crossSplit.created, crossSplit.revenue, ['2026-01', '2026-02']);
    expect(result).toEqual([
      { period: '2026-01', quoteValue: 0, orderValue: 2000, invoicedValue: 0 },
      { period: '2026-02', quoteValue: 0, orderValue: 0, invoicedValue: 2000 },
    ]);
  });
});

describe('buildPerSeller', () => {
  it('aggregates calls, quotes and order value per seller', () => {
    const rows = buildPerSeller(quotes, split.created, split.revenue, calls, sellers);
    const anna = rows.find((r) => r.userId === 'u1')!;
    const bjorn = rows.find((r) => r.userId === 'u2')!;
    expect(anna).toMatchObject({ userName: 'Anna', calls: 2, quotes: 2, quoteValue: 1500, won: 1, wonValue: 1000, hitRate: 50, orders: 2, orderValue: 2500, invoicedValue: 2500 });
    expect(bjorn).toMatchObject({ userName: 'Björn', calls: 1, quotes: 1, quoteValue: 2000, won: 0, wonValue: 0, hitRate: 0, orders: 1, orderValue: 3000, invoicedValue: 0 });
  });
  it('sorts by order value descending', () => {
    const rows = buildPerSeller(quotes, split.created, split.revenue, calls, sellers);
    expect(rows[0].userId).toBe('u2'); // 3000 > 2500
  });
});

describe('buildPerCustomer', () => {
  it('aggregates by customer and ranks on total activity in the period', () => {
    const rows = buildPerCustomer(split.created, split.revenue);
    // Ordered on order value + invoiced value, so Kund A (2500 + 2500) outranks Kund B
    // (3000 + 0). Ranking on order value alone would bury customers whose activity in the
    // period was an invoice against an order placed earlier.
    expect(rows[0]).toEqual({ customer: 'Kund A', orderValue: 2500, invoicedValue: 2500, orderCount: 2 });
    expect(rows[1]).toEqual({ customer: 'Kund B', orderValue: 3000, invoicedValue: 0, orderCount: 1 });
  });
  it('falls back to a placeholder for missing client names', () => {
    const rows = buildPerCustomer([{ vat_percent: 0, amount: 100, status: 'draft', created_at: '2026-01-01T00:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null }], []);
    expect(rows[0].customer).toBe('Okänd kund');
  });
});

describe('composeSalesReport', () => {
  it('assembles the report sections', () => {
    const report = composeSalesReport({ quotes, orders, invoiceRounds: [], calls, sellers }, { from: '2026-01-01', to: '2026-02-28' });
    expect(report.salesOverTime).toHaveLength(2);
    expect(report.perSeller).toHaveLength(2);
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
    vat_percent: 0, amount: 9000, status: 'invoiced', created_at: '2026-01-05T10:00:00Z',
    fortnox_invoiced_at: '2026-02-09T08:00:00Z', partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund C', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const febOrder: ReportOrderRow = {
    vat_percent: 0, amount: 1000, status: 'in_progress', created_at: '2026-02-03T10:00:00Z',
    fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u2', client_name: 'Kund D', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const febSplit = partitionOrders([earlierOrder, febOrder], FEB, []);

  it('counts it as invoiced but not as order value', () => {
    expect(febSplit.invoiced).toEqual([earlierOrder]);
    expect(febSplit.created).toEqual([febOrder]);
  });

  it('puts its revenue in the invoiced line and leaves order value alone', () => {
    const result = buildSalesOverTime([], febSplit.created, febSplit.revenue, ['2026-02']);
    expect(result).toEqual([{ period: '2026-02', quoteValue: 0, orderValue: 1000, invoicedValue: 9000 }]);
  });

  it('credits the seller with the revenue without inflating their order value', () => {
    const rows = buildPerSeller([], febSplit.created, febSplit.revenue, [], sellers);
    expect(rows.find((r) => r.userId === 'u1')).toMatchObject({ orderValue: 0, invoicedValue: 9000 });
    expect(rows.find((r) => r.userId === 'u2')).toMatchObject({ orderValue: 1000, invoicedValue: 0 });
  });

  // Antalet order hör ihop med ordervärdet: en order som fakturerades i perioden men skapades
  // tidigare får inte räknas, annars visar kolumnen ett antal som värdet bredvid inte täcker.
  it('counts only the orders created in the range, matching the order value', () => {
    const rows = buildPerSeller([], febSplit.created, febSplit.revenue, [], sellers);
    expect(rows.find((r) => r.userId === 'u1')).toMatchObject({ orders: 0, orderValue: 0 });
    expect(rows.find((r) => r.userId === 'u2')).toMatchObject({ orders: 1, orderValue: 1000 });
  });

  it('lists the customer with the money that moved and no order of its own', () => {
    const rows = buildPerCustomer(febSplit.created, febSplit.revenue);
    expect(rows.find((r) => r.customer === 'Kund C')).toEqual({ customer: 'Kund C', orderValue: 0, invoicedValue: 9000, orderCount: 0 });
  });

  // Ranking on order value alone would drop exactly these rows off the end of the top ten,
  // leaving the per-customer table and CSV short of what the chart above them shows.
  it('keeps a big invoice-only customer inside the top list instead of truncating it', () => {
    const tenOrderingCustomers: ReportOrderRow[] = Array.from({ length: 10 }, (_, i) => ({
      vat_percent: 0, amount: 1000, status: 'in_progress', created_at: '2026-02-05T10:00:00Z',
      fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: `Kund ${i}`, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
    }));
    const rows = buildPerCustomer(tenOrderingCustomers, febSplit.revenue);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ customer: 'Kund C', invoicedValue: 9000 });
  });

  // Below the top-N cut the two must agree to the krona — anything else means the split
  // dropped or double-counted a row. (Above the cut they legitimately differ: the table is
  // a top list, and rows 11+ are simply not shown.)
  it('accounts for every invoiced krona the chart shows when nothing is truncated', () => {
    const rows = buildPerCustomer(febSplit.created, febSplit.revenue);
    const tableTotal = rows.reduce((t, r) => t + r.invoicedValue, 0);
    const chartTotal = buildSalesOverTime([], febSplit.created, febSplit.revenue, ['2026-02'])[0].invoicedValue;
    expect(rows.length).toBeLessThan(10);
    expect(tableTotal).toBe(chartTotal);
  });

  it('survives the whole composition end to end', () => {
    const report = composeSalesReport({ quotes: [], orders: [earlierOrder, febOrder], invoiceRounds: [], calls: [], sellers }, FEB);
    expect(report.salesOverTime[0].invoicedValue).toBe(9000);
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
      fortnox_invoiced_at: '2026-01-10T10:00:00Z', partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
    };
    expect(partitionOrders([odd], RANGE_JAN, []).invoiced).toEqual([]);
  });

  it('includes both ends of the range inclusively — in SWEDISH days', () => {
    // 1 januari 00.00 svensk tid = 31 dec 23.00 UTC; 31 januari 23.59 svensk tid = 22.59 UTC.
    const edges: ReportOrderRow[] = [
      { vat_percent: 0, amount: 1, status: 'invoiced', created_at: '2025-12-31T23:00:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
      { vat_percent: 0, amount: 2, status: 'invoiced', created_at: '2026-01-31T22:59:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null },
    ];
    const result = partitionOrders(edges, RANGE_JAN, []);
    expect(result.created).toHaveLength(2);
    expect(result.invoiced).toHaveLength(2);
  });

  it('en order skapad 00.30 svensk tid den 1 februari hör till februari, fast UTC-datumet är 31 januari', () => {
    // William 2026-10-09: svensk tid överallt. UTC-dygnet lade den i januari.
    const night: ReportOrderRow = { vat_percent: 0, amount: 5, status: 'scheduled', created_at: '2026-01-31T23:30:00Z', fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null };
    expect(partitionOrders([night], RANGE_JAN, []).created).toHaveLength(0);
    expect(partitionOrders([night], { from: '2026-02-01', to: '2026-02-28' }, []).created).toHaveLength(1);
    // Och månadsserien lägger den i februari.
    expect(buildSalesOverTime([], [night], [], ['2026-01', '2026-02']).map((p) => p.orderValue)).toEqual([0, 5]);
  });

  it('drops an order that falls outside the range on both dates', () => {
    const outside: ReportOrderRow = {
      amount: 700, status: 'invoiced', created_at: '2025-11-01T10:00:00Z',
      fortnox_invoiced_at: '2025-12-01T10:00:00Z', partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
    };
    const result = partitionOrders([outside], RANGE_JAN, []);
    expect(result.created).toEqual([]);
    expect(result.invoiced).toEqual([]);
  });
});


describe('rapporten redovisar ex moms', () => {
  // En privatkundsorder (25 %) och en byggmomsorder (0 %) med SAMMA nettovärde. Före den här
  // fixen räknades den första som 25 % större bara för att momsen låg i fältet.
  const privat: ReportOrderRow = {
    amount: 125000, vat_percent: 25, pricing_summary: { subtotal: 100000, total: 125000 },
    status: 'invoiced', created_at: '2026-03-04T10:00:00Z', fortnox_invoiced_at: '2026-03-20T10:00:00Z', partial_invoicing_started_at: null,
    assigned_to: 'u1', client_name: 'Privatkund', quote_type: 'private', customer_id: null, rot_enabled: null, customer: null,
  };
  const byggmoms: ReportOrderRow = {
    amount: 100000, vat_percent: 0, pricing_summary: { subtotal: 100000, total: 100000 },
    status: 'invoiced', created_at: '2026-03-05T10:00:00Z', fortnox_invoiced_at: '2026-03-21T10:00:00Z', partial_invoicing_started_at: null,
    assigned_to: 'u2', client_name: 'Byggbolaget', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const momsQuotes: ReportQuoteRow[] = [
    { amount: 125000, vat_percent: 25, pricing_summary: { subtotal: 100000, total: 125000 }, status: 'won', quote_date: '2026-03-01', assigned_to: 'u1', customer_name: 'Privatkund', quote_type: 'private' },
    { amount: 100000, vat_percent: 0, pricing_summary: { subtotal: 100000, total: 100000 }, status: 'won', quote_date: '2026-03-02', assigned_to: 'u2', customer_name: 'Byggbolaget', quote_type: 'business' },
  ];
  const momsRange = { from: '2026-03-01', to: '2026-03-31' };
  const momsSplit = partitionOrders([privat, byggmoms], momsRange, []);

  it('summerar månadsvärdena netto', () => {
    const [march] = buildSalesOverTime(momsQuotes, momsSplit.created, momsSplit.revenue, ['2026-03']);
    expect(march.quoteValue).toBe(200000);
    expect(march.orderValue).toBe(200000);
    expect(march.invoicedValue).toBe(200000);
  });

  it('rankar två säljare med samma netto lika, oavsett kundens momsläge', () => {
    const rows = buildPerSeller(momsQuotes, momsSplit.created, momsSplit.revenue, [], [
      { id: 'u1', full_name: 'Anna' }, { id: 'u2', full_name: 'Björn' },
    ]);
    const anna = rows.find((r) => r.userId === 'u1')!;
    const bjorn = rows.find((r) => r.userId === 'u2')!;
    expect(anna.orderValue).toBe(bjorn.orderValue);
    expect(anna.quoteValue).toBe(bjorn.quoteValue);
    expect(anna.wonValue).toBe(bjorn.wonValue);
    expect(anna.invoicedValue).toBe(bjorn.invoicedValue);
    expect(anna.orderValue).toBe(100000);
  });

  it('håller kundtabellen netto', () => {
    const rows = buildPerCustomer(momsSplit.created, momsSplit.revenue);
    const p = rows.find((r) => r.customer === 'Privatkund')!;
    const b = rows.find((r) => r.customer === 'Byggbolaget')!;
    expect(p.orderValue).toBe(100000);
    expect(p.invoicedValue).toBe(100000);
    expect(b.orderValue).toBe(100000);
    expect(b.invoicedValue).toBe(100000);
  });
});


// ── Avbrutna order ─────────────────────────────────────────────────────────────
//
// En avbruten order är inte omsättning. Den räknades tidigare med i ordervärdet, i antalet
// order och i trattens ordersteg — mätt i drift 2026-08-21 var det 18 710 kr ex moms. (Tratten är
// borttagen sedan 2026-10-07; den typiska ordern läser nu samma population.)

describe('avbrutna order räknas inte som omsättning', () => {
  const RANGE = { from: '2026-04-01', to: '2026-04-30' };
  const levande: ReportOrderRow = {
    vat_percent: 0, amount: 5000, status: 'scheduled', created_at: '2026-04-10T10:00:00Z',
    fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund A', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const avbruten: ReportOrderRow = {
    vat_percent: 0, amount: 2000, status: 'cancelled', created_at: '2026-04-11T10:00:00Z',
    fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund B', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const split = partitionOrders([levande, avbruten], RANGE, []);

  it('plockas bort redan i partitioneringen', () => {
    expect(split.created).toEqual([levande]);
  });

  it('syns inte i ordervärdet över tid', () => {
    const [april] = buildSalesOverTime([], split.created, split.revenue, ['2026-04']);
    expect(april.orderValue).toBe(5000);
  });

  it('räknas varken som värde eller antal hos säljaren', () => {
    const rows = buildPerSeller([], split.created, split.revenue, [], [{ id: 'u1', full_name: 'Anna' }]);
    expect(rows[0]).toMatchObject({ orders: 1, orderValue: 5000 });
  });

  it('räknas inte i den typiska ordern', () => {
    expect(buildTypicalOrder(split.created).business).toEqual({ count: 1, median: 5000, mean: 5000 });
  });

  it('försvinner ur kundtabellen i stället för att stå där med ett värde', () => {
    const rows = buildPerCustomer(split.created, split.revenue);
    expect(rows.map((r) => r.customer)).toEqual(['Kund A']);
  });

  it('överlever hela kompositionen', () => {
    const report = composeSalesReport({ quotes: [], orders: [levande, avbruten], invoiceRounds: [], calls: [], sellers: [] }, RANGE);
    expect(report.salesOverTime[0].orderValue).toBe(5000);
    expect(report.perSeller[0]).toMatchObject({ orders: 1, orderValue: 5000 });
    expect(report.perCustomer).toHaveLength(1);
  });

  it('rör inte de levande statusarna', () => {
    const alla: ReportOrderRow[] = (['draft','scheduled','ready','in_progress','completed','partially_invoiced','invoiced'] as const)
      .map((status, i) => ({
        vat_percent: 0, amount: 100, status, created_at: `2026-04-0${i + 1}T10:00:00Z`,
        fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: `Kund ${i}`, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
      }));
    expect(partitionOrders(alla, RANGE, []).created).toHaveLength(7);
  });
});

// ── Delfakturerade ordrar ──
//
// Rapporten räknade bara ordrar med status `invoiced`. En order mitt i delfaktureringen gav därför
// 0 kr i Fakturerat, och när sista rundan gick landade HELA ordervärdet i sista rundans månad — en
// order delfakturerad med 30 000 kr i augusti och 20 000 kr i september visade 0 kr i augusti och
// 50 000 kr i september. Nu räknas varje runda i sin egen månad.
describe('delfakturerade ordrar räknas per runda', () => {
  const AUG = { from: '2026-08-01', to: '2026-08-31' };
  const SEP = { from: '2026-09-01', to: '2026-09-30' };
  const AUG_SEP = { from: '2026-08-01', to: '2026-09-30' };

  // Vunnen i juli, delfakturerad i augusti, slutfakturerad i september.
  const closed: ReportOrderRow = {
    id: 'wo-1', vat_percent: 0, amount: 50_000, status: 'invoiced', created_at: '2026-07-10T08:00:00Z',
    fortnox_invoiced_at: '2026-09-12T08:00:00Z', partial_invoicing_started_at: '2026-08-14T08:00:00Z',
    assigned_to: 'u1', client_name: 'Kund D', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };
  const done = { status: 'invoiced', assigned_to: 'u1', client_name: 'Kund D', quote_type: 'business' };
  const rounds: ReportInvoiceRoundRow[] = [
    { amount: 30_000, created_at: '2026-08-14T08:00:00Z', work_order_id: null, work_order: done },
    { amount: '20000.00', created_at: '2026-09-12T08:00:00Z', work_order_id: null, work_order: done },
  ];
  // Varje period hämtar bara sina egna rundor (fetchReportData filtrerar på created_at).
  const inRange = (range: { from: string; to: string }) => rounds.filter((r) => r.created_at.slice(0, 10) >= range.from && r.created_at.slice(0, 10) <= range.to);
  const data = (range: { from: string; to: string }, orders: ReportOrderRow[] = [closed]) => ({ quotes: [], orders, invoiceRounds: inRange(range), calls: [], sellers });

  it('visar augustirundan i augusti, fast ordern inte var färdigfakturerad då', () => {
    // Augustis hämtning ser inte ordern alls — den skapades i juli och slutfakturerades i september.
    const report = composeSalesReport(data(AUG, []), AUG);
    expect(report.salesOverTime).toEqual([{ period: '2026-08', quoteValue: 0, orderValue: 0, invoicedValue: 30_000 }]);
    expect(report.periodSummary.metrics.find((metric) => metric.key === 'invoicedValue')?.actual).toBe(30_000);
    expect(report.perSeller.find((row) => row.userId === 'u1')?.invoicedValue).toBe(30_000);
    expect(report.perCustomer).toEqual([{ customer: 'Kund D', orderValue: 0, invoicedValue: 30_000, orderCount: 0 }]);
  });

  it('visar bara sista rundan i september, inte hela ordervärdet', () => {
    const report = composeSalesReport(data(SEP), SEP);
    expect(report.salesOverTime[0].invoicedValue).toBe(20_000);
    expect(report.perSeller.find((row) => row.userId === 'u1')?.invoicedValue).toBe(20_000);
    expect(report.perCustomer[0].invoicedValue).toBe(20_000);
  });

  it('räknar ordern exakt en gång över hela förloppet', () => {
    const report = composeSalesReport(data(AUG_SEP), AUG_SEP);
    expect(report.salesOverTime.map((point) => point.invoicedValue)).toEqual([30_000, 20_000]);
    expect(report.perSeller.find((row) => row.userId === 'u1')?.invoicedValue).toBe(50_000);
    expect(report.perCustomer[0].invoicedValue).toBe(50_000);
  });

  it('räknar en order mitt i delfaktureringen', () => {
    const midway: ReportOrderRow = { ...closed, status: 'partially_invoiced', fortnox_invoiced_at: null };
    const midwayRound: ReportInvoiceRoundRow = { ...rounds[0], work_order: { ...done, status: 'partially_invoiced' } };
    const report = composeSalesReport({ quotes: [], orders: [midway], invoiceRounds: [midwayRound], calls: [], sellers }, AUG);
    expect(report.salesOverTime[0].invoicedValue).toBe(30_000);
  });

  // Lönsamheten räknar JOBB, och jobbet är färdigt först med sista rundan. Dess population ändras
  // alltså inte av att pengarna nu fördelas per runda.
  it('låter lönsamheten räkna jobbet i månaden det slutfakturerades', () => {
    expect(partitionOrders([closed], AUG, inRange(AUG)).invoiced).toEqual([]);
    expect(partitionOrders([closed], SEP, inRange(SEP)).invoiced).toEqual([closed]);
  });

  // Hämtningen är en supermängd: en order SKAPAD i perioden följer med även om den fakturerades
  // efter den. Dess faktura hör till fakturamånaden och får inte läcka in i perioden.
  it('håller fakturor utanför perioden utanför, både i ett svep och per runda', () => {
    const wonInAugBilledInOct: ReportOrderRow = {
      vat_percent: 0, amount: 9_000, status: 'invoiced', created_at: '2026-08-03T08:00:00Z',
      fortnox_invoiced_at: '2026-10-02T08:00:00Z', partial_invoicing_started_at: null, assigned_to: 'u2', client_name: 'Kund E', quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
    };
    const report = composeSalesReport({ quotes: [], orders: [wonInAugBilledInOct], invoiceRounds: rounds, calls: [], sellers }, AUG);
    expect(report.salesOverTime[0]).toMatchObject({ orderValue: 9_000, invoicedValue: 30_000 });
    expect(report.perSeller.find((row) => row.userId === 'u2')?.invoicedValue).toBe(0);
  });

  it('räknar jämförelseperiodens huvudtal på samma sätt', () => {
    expect(buildPeriodTotals(data(AUG, []), AUG).invoicedValue).toBe(30_000);
    expect(buildPeriodTotals(data(SEP), SEP).invoicedValue).toBe(20_000);
  });
});
