import { describe, it, expect } from 'vitest';
import {
  buildOwnerReport,
  metricsBySeller,
  ownerMonths,
  ownerWeeks,
  UNASSIGNED_NAME,
  type OwnerGoalRow,
  type OwnerMetrics,
} from '@/lib/domains/crm/reportOwnerExport';
import {
  buildPeriodTotals,
  buildPerSeller,
  partitionOrders,
  type ReportData,
  type ReportInvoiceRoundRow,
  type ReportOrderRow,
  type ReportQuoteRow,
} from '@/lib/domains/crm/reports';
import type { OrderStockRow } from '@/lib/domains/crm/overviewSummary';

// Ägarnas veckorapport. Det viktiga är att den säger SAMMA SAK som rapportsidan: varje vecka och varje
// säljare räknas med rapportens egna byggstenar, och summorna går ihop åt alla håll.

const quote = (over: Partial<ReportQuoteRow> = {}): ReportQuoteRow => ({
  amount: 10_000, vat_percent: 0, status: 'sent', quote_date: '2026-08-12', assigned_to: 'u1', customer_name: 'Kund', quote_type: 'business', ...over,
});
const order = (over: Partial<ReportOrderRow> = {}): ReportOrderRow => ({
  id: 'o', amount: 20_000, vat_percent: 0, status: 'scheduled', created_at: '2026-08-12T09:00:00Z', fortnox_invoiced_at: null,
  partial_invoicing_started_at: null, assigned_to: 'u1', client_name: 'Kund', quote_type: 'business', customer_id: null,
  rot_enabled: null, customer: null, ...over,
});

const YEAR = { from: '2026-01-01', to: '2026-10-09' };
const TODAY = '2026-10-09';

const quotes: ReportQuoteRow[] = [
  quote({ status: 'won', quote_date: '2026-08-11', amount: 12_000 }), // v. 33, Anna, vunnen
  quote({ quote_date: '2026-08-13', amount: 8_000 }), // v. 33, Anna
  quote({ quote_date: '2026-08-20', assigned_to: 'u2', amount: 5_000 }), // v. 34, Björn
  quote({ status: 'won', quote_date: '2026-10-06', assigned_to: 'u2', amount: 25_000 }), // v. 41, Björn
  quote({ quote_date: '2026-09-02', assigned_to: null, amount: 3_000 }), // v. 36, utan säljare
  // 25 % moms: räknas netto, 8 000 kr.
  quote({ quote_date: '2026-09-03', amount: 10_000, vat_percent: 25 }),
];
const orders: ReportOrderRow[] = [
  order({ id: 'a', created_at: '2026-08-12T09:00:00Z', amount: 12_000, status: 'invoiced', fortnox_invoiced_at: '2026-09-15T10:00:00Z' }),
  order({ id: 'b', created_at: '2026-10-06T09:00:00Z', assigned_to: 'u2', amount: 25_000 }),
  // Avbruten: räknas inte, som på rapportsidan.
  order({ id: 'c', created_at: '2026-08-13T09:00:00Z', amount: 99_000, status: 'cancelled' }),
  // Utan säljare, och fakturerad: fakturan ska räknas även den, under "Utan säljare".
  order({ id: 'd', created_at: '2026-09-01T09:00:00Z', assigned_to: null, amount: 4_000, status: 'invoiced', fortnox_invoiced_at: '2026-09-20T10:00:00Z' }),
  // Delfakturerad: rundorna räknas, var och en på sitt datum.
  order({ id: 'e', created_at: '2026-08-20T09:00:00Z', assigned_to: 'u2', amount: 50_000, status: 'partially_invoiced', partial_invoicing_started_at: '2026-08-25T00:00:00Z' }),
];
const rounds: ReportInvoiceRoundRow[] = [
  { amount: 10_000, created_at: '2026-08-27T08:00:00Z', work_order_id: 'e', work_order: { status: 'partially_invoiced', assigned_to: 'u2', client_name: 'Kund', quote_type: 'business' } },
  { amount: 15_000, created_at: '2026-09-24T08:00:00Z', work_order_id: 'e', work_order: { status: 'partially_invoiced', assigned_to: 'u2', client_name: 'Kund', quote_type: 'business' } },
];
const data: ReportData = {
  quotes,
  orders,
  invoiceRounds: rounds,
  calls: [],
  sellers: [{ id: 'u1', full_name: 'Anna Andersson' }, { id: 'u2', full_name: 'Björn Berg' }, { id: 'u3', full_name: 'Östen Öberg' }, { id: 'u4', full_name: 'Doris Dahl' }],
};

const KEYS: Array<keyof OwnerMetrics> = ['quotes', 'quoteValue', 'won', 'wonValue', 'orders', 'orderValue', 'invoicedValue'];
const add = (rows: OwnerMetrics[]) => Object.fromEntries(KEYS.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]));

describe('ownerWeeks — ISO-veckor, klippta mot perioden', () => {
  it('året 2026: första veckan börjar 1 januari (en torsdag), sista är den pågående', () => {
    const weeks = ownerWeeks(YEAR, TODAY);
    expect(weeks[0]).toMatchObject({ from: '2026-01-01', to: '2026-01-04', week: 1, current: false });
    expect(weeks.at(-1)).toMatchObject({ from: '2026-10-05', to: '2026-10-09', week: 41, current: true, preliminary: true });
    expect(weeks).toHaveLength(41);
  });

  it('vid årsskiftet heter de första dagarna i januari vecka 53', () => {
    // 2027-01-01 är en fredag i ISO-vecka 53 av 2026.
    const weeks = ownerWeeks({ from: '2027-01-01', to: '2027-01-10' }, '2027-01-10');
    expect(weeks.map((w) => [w.from, w.to, w.week])).toEqual([['2027-01-01', '2027-01-03', 53], ['2027-01-04', '2027-01-10', 1]]);
    // Söndagen den 10:e: veckan är hel, alltså inte "pågår".
    expect(weeks[1].current).toBe(false);
  });

  it('hit rate är preliminär bara för veckor som slutar inom 30 dagar', () => {
    const weeks = ownerWeeks(YEAR, TODAY);
    expect(weeks.find((w) => w.from === '2026-08-31')?.preliminary).toBe(false); // slutar 6 sep
    expect(weeks.find((w) => w.from === '2026-09-07')?.preliminary).toBe(true); // slutar 13 sep, efter 9 sep
  });

  it('räknar dagar, inte millisekunder — en vecka över höstens sommartidsväxling är sju dagar', () => {
    // 25 oktober 2026 ställs klockan tillbaka. Veckan 19–25 okt ska vara en vecka, inte en och en bit.
    const weeks = ownerWeeks({ from: '2026-10-19', to: '2026-11-01' }, '2026-11-01');
    expect(weeks.map((w) => [w.from, w.to, w.week])).toEqual([['2026-10-19', '2026-10-25', 43], ['2026-10-26', '2026-11-01', 44]]);
  });
});

describe('ownerMonths', () => {
  it('klipper första och sista månaden och märker den pågående', () => {
    const months = ownerMonths({ from: '2026-06-29', to: TODAY }, TODAY);
    expect(months[0]).toEqual({ period: '2026-06', from: '2026-06-29', to: '2026-06-30', current: false });
    expect(months.at(-1)).toEqual({ period: '2026-10', from: '2026-10-01', to: '2026-10-09', current: true });
  });
});

describe('metricsBySeller — samma tal som rapporten', () => {
  it('räknar offerter, vunna, order och fakturerat per säljare, utan säljare för sig', () => {
    const aug = { from: '2026-08-01', to: '2026-08-31' };
    const { bySeller, total } = metricsBySeller(data, aug);
    expect(bySeller.get('u1')).toEqual({ quotes: 2, quoteValue: 20_000, won: 1, wonValue: 12_000, orders: 1, orderValue: 12_000, invoicedValue: 0 });
    expect(bySeller.get('u2')).toEqual({ quotes: 1, quoteValue: 5_000, won: 0, wonValue: 0, orders: 1, orderValue: 50_000, invoicedValue: 10_000 });
    expect(total.orders).toBe(2); // den avbrutna ordern räknas inte
    expect(bySeller.has(null)).toBe(false);

    const sep = metricsBySeller(data, { from: '2026-09-01', to: '2026-09-30' });
    expect(sep.bySeller.get(null)).toEqual({ quotes: 1, quoteValue: 3_000, won: 0, wonValue: 0, orders: 1, orderValue: 4_000, invoicedValue: 4_000 });
    // Momsen dras av: 10 000 kr inkl. 25 % moms = 8 000 kr.
    expect(sep.bySeller.get('u1')?.quoteValue).toBe(8_000);
    // September: order a slutfakturerad (12 000) och rundan på 15 000.
    expect(sep.bySeller.get('u1')?.invoicedValue).toBe(12_000);
    expect(sep.bySeller.get('u2')?.invoicedValue).toBe(15_000);
  });

  it('helheten är rapportens huvudtal för samma period, och säljarna summerar till den', () => {
    for (const range of [YEAR, { from: '2026-08-10', to: '2026-08-16' }, { from: '2026-09-01', to: '2026-09-30' }]) {
      const { bySeller, total } = metricsBySeller(data, range);
      const periodData = { ...data, invoiceRounds: rounds.filter((r) => r.created_at.slice(0, 10) >= range.from && r.created_at.slice(0, 10) <= range.to) };
      const periodQuotes = quotes.filter((q) => q.quote_date! >= range.from && q.quote_date! <= range.to);
      const totals = buildPeriodTotals({ ...periodData, quotes: periodQuotes }, range);
      expect({ quotes: total.quotes, quoteValue: total.quoteValue, orders: total.orders, orderValue: total.orderValue, invoicedValue: total.invoicedValue })
        .toEqual({ quotes: totals.quotes, quoteValue: totals.quoteValue, orders: totals.orders, orderValue: totals.orderValue, invoicedValue: totals.invoicedValue });
      expect(add([...bySeller.values()])).toEqual(total);
    }
  });

  it('per säljare samma tal som rapportens säljartabell', () => {
    const orders = partitionOrders(data.orders, YEAR, data.invoiceRounds);
    const table = buildPerSeller(data.quotes, orders.created, orders.revenue, [], data.sellers);
    const { bySeller } = metricsBySeller(data, YEAR);
    for (const row of table) {
      const mine = bySeller.get(row.userId)!;
      expect({ quotes: mine.quotes, quoteValue: mine.quoteValue, won: mine.won, wonValue: mine.wonValue, orders: mine.orders, orderValue: mine.orderValue, invoicedValue: mine.invoicedValue })
        .toEqual({ quotes: row.quotes, quoteValue: row.quoteValue, won: row.won, wonValue: row.wonValue, orders: row.orders, orderValue: row.orderValue, invoicedValue: row.invoicedValue });
    }
  });
});

const goals: OwnerGoalRow[] = [
  { user_id: 'u1', period_start: '2026-08-01', quote_value_target: '300000.00', order_value_target: '200000.00', invoiced_value_target: 0 },
  { user_id: 'u1', period_start: '2026-09-01', quote_value_target: 300_000, order_value_target: 250_000, invoiced_value_target: 150_000 },
  // Säljare utan aktivitet men med budget: står med.
  { user_id: 'u3', period_start: '2026-09-01', quote_value_target: 100_000, order_value_target: 50_000, invoiced_value_target: null },
  // Bara nollor = ingen budget.
  { user_id: 'u2', period_start: '2026-09-01', quote_value_target: 0, order_value_target: 0, invoiced_value_target: 0 },
  // Bara nollor och ingen aktivitet: står inte med alls.
  { user_id: 'u4', period_start: '2026-09-01', quote_value_target: '0.00', order_value_target: 0, invoiced_value_target: null },
  // Före första veckan med aktivitet: utanför arket.
  { user_id: 'u1', period_start: '2026-05-01', quote_value_target: 1, order_value_target: 1, invoiced_value_target: 1 },
];
const stockRows: OrderStockRow[] = [
  { status: 'draft', amount: 10_000, vat_percent: 0, invoice_rounds: [] },
  { status: 'scheduled', amount: 20_000, vat_percent: 0, invoice_rounds: [] },
  { status: 'partially_invoiced', amount: 50_000, vat_percent: 0, invoice_rounds: [{ amount: 10_000 }, { amount: 15_000 }] },
];
const SEP = { from: '2026-09-01', to: '2026-09-30' };

describe('buildOwnerReport', () => {
  const report = buildOwnerReport({ data, range: YEAR, today: TODAY, goals, orderStockRows: stockRows, basis: { range: SEP, invoiced: 30_000 } });

  it('utelämnar veckorna före den första aktiviteten, men inte de tomma veckorna därefter', () => {
    expect(report.weeks[0]).toMatchObject({ week: 33, from: '2026-08-10' });
    expect(report.weeks.at(-1)).toMatchObject({ week: 41, current: true });
    expect(report.weeks).toHaveLength(9);
    expect(report.months.map((m) => m.period)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('veckorna summerar till helheten — per säljare och för hela företaget', () => {
    for (const seller of report.sellers) expect(add(seller.weeks)).toEqual(seller.total);
    expect(add(report.totals.weeks)).toEqual(report.totals.total);
    report.weeks.forEach((_, i) => expect(add(report.sellers.map((s) => s.weeks[i]))).toEqual(report.totals.weeks[i]));
    expect(add(report.sellers.map((s) => s.total))).toEqual(report.totals.total);
    // Och månaderna likaså.
    expect(add(report.totals.months)).toEqual(report.totals.total);
  });

  it('säljarna i svensk namnordning, "Utan säljare" sist; säljare med bara budget står med, med bara nollmål inte', () => {
    // Ö sorteras efter U på svenska — "Utan säljare" hamnar sist för att den ÄR utan säljare, inte av alfabetet.
    expect(report.sellers.map((s) => s.name)).toEqual(['Anna Andersson', 'Björn Berg', 'Östen Öberg', UNASSIGNED_NAME]);
    const osten = report.sellers[2];
    expect(osten.total).toEqual({ quotes: 0, quoteValue: 0, won: 0, wonValue: 0, orders: 0, orderValue: 0, invoicedValue: 0 });
  });

  it('budget: 0 = ingen budget, strängar läses som tal, månader utanför arket faller bort', () => {
    const anna = report.sellers[0].budget!;
    expect(anna).toEqual([
      { quoteValue: 300_000, orderValue: 200_000, invoicedValue: null },
      { quoteValue: 300_000, orderValue: 250_000, invoicedValue: 150_000 },
      { quoteValue: null, orderValue: null, invoicedValue: null },
    ]);
    expect(report.sellers[1].budget!.every((b) => b.quoteValue == null && b.orderValue == null && b.invoicedValue == null)).toBe(true);
    expect(report.sellers[2].budget![1]).toEqual({ quoteValue: 100_000, orderValue: 50_000, invoicedValue: null });
    expect(report.sellers[3].budget!.every((b) => b.orderValue == null)).toBe(true);
    expect(report.budgetUnavailable).toBe(false);
  });

  it('utan "Utan säljare" när allt har en säljare', () => {
    const assigned = buildOwnerReport({
      data: { ...data, quotes: quotes.filter((q) => q.assigned_to), orders: orders.filter((o) => o.assigned_to) },
      range: YEAR, today: TODAY, goals: [], orderStockRows: [], basis: null,
    });
    expect(assigned.sellers.some((s) => s.userId == null)).toBe(false);
  });

  it('målen kunde inte läsas: budgeten är null, inte tom', () => {
    const noGoals = buildOwnerReport({ data, range: YEAR, today: TODAY, goals: null, orderStockRows: stockRows, basis: null });
    expect(noGoals.budgetUnavailable).toBe(true);
    expect(noGoals.sellers.every((s) => s.budget === null)).toBe(true);
  });

  it('orderstocken just nu: per läge, summerar till totalen; null när den inte kunde läsas', () => {
    const stock = report.orderStock!;
    expect(stock.value).toBe(10_000 + 20_000 + 25_000);
    expect(stock.stages.reduce((sum, s) => sum + s.value, 0)).toBe(stock.value);
    expect(stock.stages.reduce((sum, s) => sum + s.count, 0)).toBe(stock.count);
    // 30 000 kr i september (30 dagar) = 7 000 kr i veckan; 55 000 / 7 000 ≈ 7,9 veckor.
    expect(stock.weeks).toBeCloseTo(55_000 / (30_000 / (30 / 7)), 5);
    expect(buildOwnerReport({ data, range: YEAR, today: TODAY, goals, orderStockRows: null, basis: null }).orderStock).toBeNull();
  });

  it('ingen aktivitet alls: bara den pågående veckan', () => {
    const empty = buildOwnerReport({ data: { ...data, quotes: [], orders: [], invoiceRounds: [] }, range: YEAR, today: TODAY, goals: [], orderStockRows: [], basis: null });
    expect(empty.weeks).toHaveLength(1);
    expect(empty.weeks[0]).toMatchObject({ week: 41, current: true });
    expect(empty.sellers).toEqual([]);
  });
});
