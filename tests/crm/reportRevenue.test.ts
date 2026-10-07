import { describe, it, expect } from 'vitest';
import {
  STOCK_STAGES,
  bookToBill,
  buildCustomerConcentration,
  buildInvoicedByMonth,
  buildLeadTime,
  buildReportRevenue,
  buildRotShare,
  buildSegments,
  buildStockByStage,
  countOrdersPerCustomer,
  customerKey,
  customerSegmentOf,
  invoicedByCustomerType,
  orderLeadDays,
  sniDigits,
} from '@/lib/domains/crm/reportRevenue';
import { buildOrderStock, buildSalesTrend, type OrderStockRow } from '@/lib/domains/crm/reportKpis';
import { ORDER_STOCK_STATUSES } from '@/lib/domains/crm/overviewSummary';
import { partitionOrders, type ReportInvoiceRoundRow, type ReportOrderRow } from '@/lib/domains/crm/reports';
import type { InvoicedRevenue } from '@/lib/domains/crm/invoicedRevenue';

// `vat_percent: 0` där inget annat sägs: beloppet är då sitt eget netto.
const order = (over: Partial<ReportOrderRow> = {}): ReportOrderRow => ({
  amount: 10_000,
  vat_percent: 0,
  status: 'scheduled',
  created_at: '2026-09-10T08:00:00Z',
  fortnox_invoiced_at: null,
  partial_invoicing_started_at: null,
  assigned_to: null,
  client_name: 'Kund A',
  quote_type: 'business',
  customer_id: null,
  rot_enabled: null,
  customer: null,
  ...over,
});

const invoice = (amount: number, quote_type: string | null, at = '2026-09-15T08:00:00Z'): InvoicedRevenue => ({
  amount, at, assigned_to: null, client_name: null, quote_type,
});

describe('invoicedByCustomerType — fakturerat och andelen privat', () => {
  it('delar fakturorna på kundtyp och räknar andelen privat', () => {
    const split = invoicedByCustomerType([invoice(30_000, 'business'), invoice(10_000, 'private')]);
    expect(split).toEqual({ total: 40_000, business: 30_000, private: 10_000, privateShare: 25 });
  });

  it('ingen andel — null, inte 0 % — när inget fakturerats', () => {
    expect(invoicedByCustomerType([]).privateShare).toBeNull();
  });

  it('räknar en delfakturarunda med sin orders kundtyp', () => {
    const rounds: ReportInvoiceRoundRow[] = [
      { amount: 4000, created_at: '2026-09-20T08:00:00Z', work_order: { status: 'partially_invoiced', assigned_to: null, client_name: 'P', quote_type: 'private' } },
    ];
    const { revenue } = partitionOrders([], { from: '2026-09-01', to: '2026-09-30' }, rounds);
    expect(invoicedByCustomerType(revenue)).toMatchObject({ private: 4000, privateShare: 100 });
  });
});

describe('bookToBill', () => {
  it('= orderingång ÷ fakturerat', () => {
    expect(bookToBill(6_847_649, 2_319_976)).toBeCloseTo(2.95, 2);
  });
  it('null när inget fakturerats — ingen kvot mot noll', () => {
    expect(bookToBill(100_000, 0)).toBeNull();
  });
});

describe('orderLeadDays — från order till faktura i svenska dagar', () => {
  it('räknar på SVENSK dag: skapad kl. 00.30 svensk tid hör till den dagen, inte UTC-dagen före', () => {
    // 2026-09-09T22:30Z är 00.30 den 10 september i Sverige. UTC-dagen (9 sep) hade gett 8 dagar.
    expect(orderLeadDays({ created_at: '2026-09-09T22:30:00Z', fortnox_invoiced_at: '2026-09-17T08:00:00Z' })).toBe(7);
  });

  it('räknar hela dygn över höstens sommartidsväxling', () => {
    // 00.30 den 25 oktober (sommartid) till 09.00 den 1 november (normaltid): sju kalenderdagar.
    expect(orderLeadDays({ created_at: '2026-10-24T22:30:00Z', fortnox_invoiced_at: '2026-11-01T08:00:00Z' })).toBe(7);
  });

  it('samma dag är 0 dagar, och utan fakturadatum går det inte att mäta', () => {
    expect(orderLeadDays({ created_at: '2026-09-10T06:00:00Z', fortnox_invoiced_at: '2026-09-10T15:00:00Z' })).toBe(0);
    expect(orderLeadDays({ created_at: '2026-09-10T06:00:00Z', fortnox_invoiced_at: null })).toBeNull();
  });
});

describe('buildLeadTime', () => {
  it('median och snitt över de mätbara ordrarna — en utan fakturadatum räknas inte', () => {
    const lead = buildLeadTime([
      order({ created_at: '2026-09-01T08:00:00Z', fortnox_invoiced_at: '2026-09-03T08:00:00Z' }), // 2
      order({ created_at: '2026-09-01T08:00:00Z', fortnox_invoiced_at: '2026-09-08T08:00:00Z' }), // 7
      order({ created_at: '2026-09-01T08:00:00Z', fortnox_invoiced_at: '2026-10-01T08:00:00Z' }), // 30
      order({ status: 'invoiced', fortnox_invoiced_at: null }),
    ]);
    expect(lead).toEqual({ count: 3, median: 7, mean: 13 });
  });

  it('null — inte 0 dagar — utan mätbara order', () => {
    expect(buildLeadTime([])).toEqual({ count: 0, median: null, mean: null });
  });
});

describe('buildRotShare', () => {
  it('privatorder med ROT ikryssat ÷ alla privatorder — företagsorder räknas inte', () => {
    const rot = buildRotShare([
      order({ quote_type: 'private', rot_enabled: true, amount: 12_500, vat_percent: 25 }),
      order({ quote_type: 'private', rot_enabled: false }),
      order({ quote_type: 'private', rot_enabled: null }),
      order({ quote_type: 'private' }),
      order({ quote_type: 'business', rot_enabled: true }),
    ]);
    expect(rot).toEqual({ privateOrders: 4, withRot: 1, share: 25, value: 10_000 });
  });

  it('bara JSON-värdet true räknas som ikryssat', () => {
    expect(buildRotShare([order({ quote_type: 'private', rot_enabled: 'true' })]).withRot).toBe(0);
  });

  it('ingen andel utan privatorder', () => {
    expect(buildRotShare([order()]).share).toBeNull();
  });
});

describe('buildInvoicedByMonth — fakturerat per månad, företag och privat', () => {
  const window = { from: '2026-06-29', to: '2026-10-07' };
  const september = { from: '2026-09-01', to: '2026-09-30' };
  const orders = [
    order({ status: 'invoiced', amount: 20_000, fortnox_invoiced_at: '2026-08-12T08:00:00Z', created_at: '2026-08-01T08:00:00Z' }),
    order({ status: 'invoiced', amount: 5_000, quote_type: 'private', fortnox_invoiced_at: '2026-09-02T08:00:00Z', created_at: '2026-08-20T08:00:00Z' }),
    order({ status: 'invoiced', amount: 9_000, fortnox_invoiced_at: '2026-06-20T08:00:00Z', created_at: '2026-06-10T08:00:00Z' }), // före fönstret
  ];
  const rounds: ReportInvoiceRoundRow[] = [
    { amount: 3_000, created_at: '2026-10-02T08:00:00Z', work_order: { status: 'partially_invoiced', assigned_to: null, client_name: 'P', quote_type: 'private' } },
  ];
  const months = buildInvoicedByMonth({ data: { orders, invoiceRounds: rounds }, window, selected: september });

  it('en punkt per månad i fönstret, staplad på kundtyp', () => {
    expect(months.map((m) => [m.period, m.business, m.private])).toEqual([
      ['2026-06', 0, 0],
      ['2026-07', 0, 0],
      ['2026-08', 20_000, 0],
      ['2026-09', 0, 5_000],
      ['2026-10', 0, 3_000],
    ]);
  });

  it('summerar per månad till exakt trendens fakturerat', () => {
    const trend = buildSalesTrend({ data: { quotes: [], orders, invoiceRounds: rounds }, window, selected: september, goals: null });
    expect(months.map((m) => m.business + m.private)).toEqual(trend.points.map((p) => p.invoicedValue));
  });

  it('märker delmånaderna och den valda perioden', () => {
    expect(months.filter((m) => m.partial).map((m) => m.period)).toEqual(['2026-06', '2026-10']);
    expect(months.filter((m) => m.inPeriod).map((m) => m.period)).toEqual(['2026-09']);
  });
});

describe('buildStockByStage — orderstock efter läge', () => {
  const stockRow = (status: string, amount: number, rounds: number[] = []): OrderStockRow => ({
    status, amount, vat_percent: 0, pricing_summary: null, invoice_rounds: rounds.map((a) => ({ amount: a })),
  });
  const rows = [
    stockRow('draft', 1_000),
    stockRow('scheduled', 2_000),
    stockRow('ready', 500),
    stockRow('in_progress', 4_000),
    stockRow('partially_invoiced', 10_000, [7_000]),
    stockRow('completed', 300),
    stockRow('invoiced', 99_000),
    stockRow('cancelled', 88_000),
  ];

  it('lägger varje order i sitt läge, i arbetsflödets ordning — ready visas som Planerad', () => {
    expect(buildStockByStage(rows).map((s) => [s.key, s.count, s.value])).toEqual([
      ['draft', 1, 1_000],
      ['scheduled', 2, 2_500],
      ['in_progress', 1, 4_000],
      ['partially_invoiced', 1, 3_000],
      ['completed', 1, 300],
    ]);
  });

  it('summerar till exakt Översiktens orderstock', () => {
    const total = buildStockByStage(rows).reduce((t, s) => t + s.value, 0);
    expect(total).toBe(buildOrderStock(rows, null).value);
  });

  it('lägena täcker exakt orderstockens statusar — inget faller bort, inget dubbelräknas', () => {
    const covered = STOCK_STAGES.flatMap((stage) => stage.statuses);
    expect([...covered].sort()).toEqual([...ORDER_STOCK_STATUSES].sort());
  });
});

describe('sniDigits och customerSegmentOf — kundsegment ur SNI-koden', () => {
  const business = (sni_code: string | null) => order({ customer: { sni_code } });

  it('läser kodens siffror, med eller utan punkt', () => {
    expect(sniDigits('41.200')).toBe('41200');
    expect(sniDigits('41200')).toBe('41200');
    expect(sniDigits('')).toBeNull();
    expect(sniDigits(null)).toBeNull();
  });

  it('grupperar företagen på koden', () => {
    expect(customerSegmentOf(business('41200'))).toBe('construction');
    expect(customerSegmentOf(business('41.200'))).toBe('construction');
    expect(customerSegmentOf(business('43910'))).toBe('construction');
    expect(customerSegmentOf(business('68204'))).toBe('real_estate');
    expect(customerSegmentOf(business('46730'))).toBe('builders_merchant');
    expect(customerSegmentOf(business('16230'))).toBe('house_manufacturer');
  });

  it('en annan kod är Övriga branscher, ingen kod är Bransch okänd', () => {
    expect(customerSegmentOf(business('71121'))).toBe('other');
    expect(customerSegmentOf(business('46900'))).toBe('other');
    expect(customerSegmentOf(business(null))).toBe('unknown');
    expect(customerSegmentOf(order({ customer: null }))).toBe('unknown');
  });

  it('privat avgörs av ordern, oavsett kundkortets kod', () => {
    expect(customerSegmentOf(order({ quote_type: 'private', customer: { sni_code: '41200' } }))).toBe('private');
  });

  it('läser kundkortet också när relationen kommer som lista', () => {
    expect(customerSegmentOf(order({ customer: [{ sni_code: '68204' }] }))).toBe('real_estate');
  });
});

describe('buildSegments', () => {
  const orders = [
    order({ amount: 40_000, customer_id: 'k1', customer: { sni_code: '41200' } }),
    order({ amount: 10_000, customer_id: 'k1', customer: { sni_code: '41200' } }),
    order({ amount: 25_000, customer_id: 'k2', customer: { sni_code: '43910' } }),
    order({ amount: 12_500, vat_percent: 25, quote_type: 'private', client_name: 'Anna' }),
    order({ amount: 7_000, client_name: 'Okänd bransch AB' }),
  ];

  it('ordervärde, antal order och antal kunder per segment — alla segment står med', () => {
    const segments = buildSegments(orders);
    expect(segments.map((s) => s.segment)).toEqual(['private', 'construction', 'real_estate', 'builders_merchant', 'house_manufacturer', 'other', 'unknown']);
    expect(segments.find((s) => s.segment === 'construction')).toEqual({ segment: 'construction', orderValue: 75_000, orders: 3, customers: 2 });
    expect(segments.find((s) => s.segment === 'private')).toEqual({ segment: 'private', orderValue: 10_000, orders: 1, customers: 1 });
    expect(segments.find((s) => s.segment === 'unknown')).toMatchObject({ orderValue: 7_000, orders: 1 });
  });

  it('segmenten summerar till hela periodens ordervärde', () => {
    const total = buildSegments(orders).reduce((t, s) => t + s.orderValue, 0);
    expect(total).toBe(92_000);
  });
});

describe('customerKey och countOrdersPerCustomer', () => {
  it('kundkortet först, annars kundnamnet, annars en gemensam okänd kund', () => {
    expect(customerKey({ customer_id: 'k1', client_name: 'Kund A' })).toBe('id:k1');
    expect(customerKey({ customer_id: null, client_name: '  Kund A ' })).toBe('namn:Kund A');
    expect(customerKey({ customer_id: null, client_name: null })).toBe('okänd');
  });

  it('räknar inte avbrutna order', () => {
    const counts = countOrdersPerCustomer([
      { status: 'invoiced', customer_id: 'k1', client_name: null },
      { status: 'cancelled', customer_id: 'k1', client_name: null },
      { status: 'draft', customer_id: null, client_name: 'Anna' },
    ]);
    expect(counts.get('id:k1')).toBe(1);
    expect(counts.get('namn:Anna')).toBe(1);
  });
});

describe('buildCustomerConcentration — kunder', () => {
  // Blandad ordning med flit: topplistan ska sorteras på värde, inte lita på i vilken ordning raderna kom.
  const orders = [
    ...[0.2, 8, 0.5, 50, 3, 1, 20, 0.3, 10, 2, 5].map((thousands, i) => order({ amount: thousands * 1000, customer_id: `k${i}` })),
    order({ amount: 1000, customer_id: 'k3' }),
  ];

  it('räknar periodens kunder och hur många av dem som har minst två order sedan start', () => {
    const sinceStart = new Map([['id:k3', 2], ['id:k1', 1], ['id:k2', 3]]);
    const customers = buildCustomerConcentration(orders, sinceStart);
    expect(customers.customers).toBe(11);
    expect(customers.recurring).toBe(2);
  });

  it('de 5 och de 10 största kundernas andel av periodens ordervärde', () => {
    const customers = buildCustomerConcentration(orders, new Map());
    // Totalt 101 000; topp 5 = 51+20+10+8+5 = 94 000; topp 10 = 94+3+2+1+0,5+0,3 = 100 800.
    expect(customers.top5Share).toBeCloseTo((94_000 / 101_000) * 100, 6);
    expect(customers.top10Share).toBeCloseTo((100_800 / 101_000) * 100, 6);
  });

  it('återkommande null — inte 0 — när räkningen sedan start inte gick att läsa', () => {
    expect(buildCustomerConcentration(orders, null).recurring).toBeNull();
  });

  it('inga andelar utan ordervärde', () => {
    expect(buildCustomerConcentration([], new Map())).toEqual({ customers: 0, recurring: 0, top5Share: null, top10Share: null });
  });
});

describe('buildReportRevenue', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };
  const period = partitionOrders(
    [
      order({ amount: 30_000 }),
      order({ status: 'invoiced', amount: 10_000, quote_type: 'private', created_at: '2026-08-01T08:00:00Z', fortnox_invoiced_at: '2026-09-11T08:00:00Z' }),
      order({ status: 'cancelled', amount: 99_000 }),
    ],
    range,
    [],
  );

  it('räknar periodens tal och book-to-bill på samma rader som rapporten', () => {
    const revenue = buildReportRevenue({ period, range, trend: null, orderStockRows: null, ordersSinceStart: null });
    expect(revenue.invoiced).toMatchObject({ total: 10_000, private: 10_000, privateShare: 100 });
    expect(revenue.bookToBill).toBe(3);
    expect(revenue.leadTime).toMatchObject({ count: 1, median: 41 });
  });

  it('book-to-bill för föregående period ur dess huvudtal — null när de inte gick att hämta', () => {
    const base = { period, range, trend: null, orderStockRows: null, ordersSinceStart: null };
    expect(buildReportRevenue({ ...base, previousTotals: { orderValue: 20_000, invoicedValue: 10_000 } }).bookToBillPrevious).toBe(2);
    expect(buildReportRevenue({ ...base, previousTotals: { orderValue: 20_000, invoicedValue: 0 } }).bookToBillPrevious).toBeNull();
    expect(buildReportRevenue({ ...base, previousTotals: null }).bookToBillPrevious).toBeNull();
  });

  it('en trasig läsning tar bara bort sin egen del — null, aldrig tomma serier', () => {
    const revenue = buildReportRevenue({ period, range, trend: null, orderStockRows: null, ordersSinceStart: null });
    expect(revenue.invoicedByMonth).toBeNull();
    expect(revenue.stockByStage).toBeNull();
    expect(revenue.customers.recurring).toBeNull();
    expect(revenue.segments.reduce((t, s) => t + s.orderValue, 0)).toBe(30_000);
  });
});
