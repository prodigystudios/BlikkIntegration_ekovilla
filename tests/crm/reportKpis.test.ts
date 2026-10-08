import { describe, it, expect } from 'vitest';
import {
  buildCustomerTypeHitRate,
  buildHitRate,
  buildHitRateByMonth,
  buildOpenQuotes,
  buildOrderStock,
  buildPeriodHitRate,
  buildQuoteAge,
  buildReportOverview,
  buildReportSales,
  buildTypicalOrder,
  customerTypeOf,
  hitRateMaturity,
  median,
  orderStockWeeks,
  quoteAgeDays,
  buildSalesTrend,
  trendWindow,
  type OpenQuoteRow,
  type OrderStockRow,
} from '@/lib/domains/crm/reportKpis';
import { buildPerSeller, type ReportOrderRow, type ReportQuoteRow } from '@/lib/domains/crm/reports';
import { suggestsLateEntry } from '@/lib/domains/crm/hitRate';
import { ORDER_STOCK_STATUSES } from '@/lib/domains/crm/overviewSummary';
import type { ReportGoalRow } from '@/lib/domains/crm/reportGoals';

// `vat_percent: 0` där inget annat sägs: beloppet är då sitt eget netto, och förväntningarna kan
// handla om regeln som prövas. Nettot har egna fall nedan.
const quote = (status: string, amount = 1000, vat_percent: number | null = 0) => ({ status, amount, vat_percent });

describe('buildHitRate', () => {
  it('räknar vunna mot ALLA offerter — utkast, skickade, förlorade och uppföljningar i nämnaren', () => {
    // Beslut 2026-10-07: utkast räknas som offerter överallt, och rapporten drar inga slutsatser av
    // statusar som säljaren sätter. "Vunna av avgjorda" hade gett 1 av 2 = 50 % här.
    const rate = buildHitRate([
      quote('won'),
      quote('draft'),
      quote('sent'),
      quote('follow_up'),
      quote('lost'),
    ]);
    expect(rate.quotes).toBe(5);
    expect(rate.won).toBe(1);
    expect(rate.percent).toBe(20);
  });

  it('räknar kronorna netto, inte på rått amount', () => {
    // 1250 brutto med 25 % moms är 1000 netto; byggmomsraden (0 %) är sitt eget netto. Rått amount
    // hade gett 1250 / 2250 = 55,6 % i stället för 1000 / 2000 = 50 %.
    const rate = buildHitRate([quote('won', 1250, 25), quote('sent', 1000, 0)]);
    expect(rate.wonValue).toBe(1000);
    expect(rate.quoteValue).toBe(2000);
    expect(rate.valuePercent).toBe(50);
  });

  it('ger null — inte 0 % — när underlaget saknar offerter eller värde', () => {
    // 0 % hade lästs som "vi vann ingenting", vilket är ett annat påstående än "inget att räkna på".
    expect(buildHitRate([]).percent).toBeNull();
    expect(buildHitRate([]).valuePercent).toBeNull();
    expect(buildHitRate([quote('won', 0)]).valuePercent).toBeNull();
    expect(buildHitRate([quote('won', 0)]).percent).toBe(100);
  });
});

describe('hitRateMaturity', () => {
  it('är preliminär när periodens sista dag är yngre än 30 dagar', () => {
    // Facit från prod 7 oktober: september är preliminär, "offerter efter 7 sep är yngre än 30 dagar".
    expect(hitRateMaturity({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-07')).toEqual({
      preliminary: true,
      matureThrough: '2026-09-07',
    });
    expect(hitRateMaturity({ from: '2026-08-01', to: '2026-08-31' }, '2026-10-07').preliminary).toBe(false);
  });

  it('räknar en offert som är EXAKT 30 dagar som mogen', () => {
    // "mindre än 30 dagar före idag" — 30 är inte mindre än 30.
    expect(hitRateMaturity({ from: '2026-09-01', to: '2026-09-07' }, '2026-10-07').preliminary).toBe(false);
    expect(hitRateMaturity({ from: '2026-09-01', to: '2026-09-08' }, '2026-10-07').preliminary).toBe(true);
  });

  it('räknar kalenderdagar över vårens sommartidsväxling — 🕰️ ZONBEROENDE, biter bara i en DST-zon', () => {
    // Klockan gick fram natten till 29 mars 2026, så dygnet då var 23 timmar. Trettio gånger 24 timmar
    // bakåt från en LOKAL midnatt den 10 april landar kl. 23 den 10 mars — en dag för tidigt. Under
    // TZ=UTC finns ingen växling och den naiva varianten ger rätt svar, så testet bevisar bara något
    // när sviten körs i Europe/Stockholm (mutationsprövat där: naiv lokal ms-aritmetik → 2026-03-10).
    expect(hitRateMaturity({ from: '2026-03-01', to: '2026-03-31' }, '2026-04-10').matureThrough).toBe('2026-03-11');
  });
});

describe('buildPeriodHitRate', () => {
  const august = { from: '2026-08-01', to: '2026-08-31' };
  const july = { from: '2026-07-01', to: '2026-07-31' };
  const september = { from: '2026-09-01', to: '2026-09-30' };

  it('jämför mot föregående period när båda är mogna', () => {
    const rate = buildPeriodHitRate({
      quotes: [quote('won'), quote('sent')],
      range: august,
      today: '2026-10-07',
      previous: { range: july, quotes: [quote('won'), quote('draft'), quote('lost'), quote('sent')] },
    });
    expect(rate.preliminary).toBe(false);
    expect(rate.percent).toBe(50);
    expect(rate.previous?.percent).toBe(25);
  });

  it('jämför INTE när perioden är preliminär', () => {
    // En preliminär hit rate stiger ännu. Ställd mot en mogen period ser den ut att ha tappat,
    // varje gång någon tittar på innevarande månad.
    const rate = buildPeriodHitRate({
      quotes: [quote('won'), quote('sent')],
      range: september,
      today: '2026-10-07',
      previous: { range: august, quotes: [quote('won')] },
    });
    expect(rate.preliminary).toBe(true);
    expect(rate.previous).toBeNull();
  });

  it('jämför INTE när jämförelseperioden är preliminär', () => {
    const rate = buildPeriodHitRate({
      quotes: [quote('won')],
      range: august,
      today: '2026-10-07',
      previous: { range: september, quotes: [quote('won')] },
    });
    expect(rate.preliminary).toBe(false);
    expect(rate.previous).toBeNull();
  });

  it('ger ingen jämförelse när föregående period inte kunde hämtas', () => {
    const rate = buildPeriodHitRate({ quotes: [quote('won')], range: august, today: '2026-10-07', previous: null });
    expect(rate.previous).toBeNull();
    expect(rate.percent).toBe(100);
  });
});

// ── Orderstock ───────────────────────────────────────────────────────────────

const order = (status: string, amount: number, rounds: number[] = []): OrderStockRow => ({
  status,
  amount,
  vat_percent: 0,
  invoice_rounds: rounds.map((r) => ({ amount: r })),
});

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

describe('buildOrderStock', () => {
  it('räknar de fem lägena, inte avbrutna eller färdigfakturerade', () => {
    const stock = buildOrderStock(
      [
        order('draft', 100),
        order('scheduled', 200),
        order('in_progress', 300),
        order('completed', 400),
        order('partially_invoiced', 500),
        order('invoiced', 10_000),
        order('cancelled', 20_000),
      ],
      null,
    );
    expect(stock.count).toBe(5);
    expect(stock.value).toBe(1500);
  });

  it('har samma statuslista som översiktens två orderlager', () => {
    // Rapportens orderstock och översiktens "Öppna ordrar" + "Att fakturera" ska gå att stämma av
    // mot varandra. 'ready' finns i typen men inte i databasens CHECK — ofarlig att ha med.
    expect([...ORDER_STOCK_STATUSES]).toEqual(['draft', 'scheduled', 'ready', 'in_progress', 'completed', 'partially_invoiced']);
  });

  it('bär bara resten av en delfakturerad order', () => {
    // 10 000 netto, 6 000 redan fakturerat i rundor: 4 000 kvar. Hela värdet hade räknat de 6 000
    // kronorna både som fakturerat och som stock.
    const stock = buildOrderStock([order('partially_invoiced', 10_000, [2_000, 4_000])], null);
    expect(stock.value).toBe(4_000);
  });

  it('räknar stocken netto', () => {
    const stock = buildOrderStock([{ status: 'scheduled', amount: 1250, vat_percent: 25, invoice_rounds: [] }], null);
    expect(stock.value).toBe(1000);
  });

  it('räknar de klara men inte fakturerade för sig — en rad under "Kräver åtgärd"', () => {
    const stock = buildOrderStock([order('completed', 400), order('completed', 600, [100]), order('partially_invoiced', 900)], null);
    expect(stock.completed).toEqual({ count: 2, value: 900 });
  });
});

describe('orderStockWeeks', () => {
  it('= stocken ÷ (månadens fakturering ÷ (dagar ÷ 7))', () => {
    // Facit från prod: september fakturerade 2 319 976 kr på 30 dagar, stocken var 5,36 Mkr →
    // ungefär tio veckor.
    const weeks = orderStockWeeks(5_363_454, { range: SEPTEMBER, invoiced: 2_319_976 });
    expect(weeks).toBeCloseTo(5_363_454 / (2_319_976 / (30 / 7)), 6);
    expect(Math.round(weeks!)).toBe(10);
  });

  it('räknar månadens egna dagar — februari är kortare', () => {
    const february = { from: '2027-02-01', to: '2027-02-28' };
    expect(orderStockWeeks(280, { range: february, invoiced: 280 })).toBe(4);
  });

  it('ger null — inget veckotal — när månaden fakturerade 0 eller inte kunde läsas', () => {
    // Division med noll hade gett Infinity, och "∞ veckor" är inget besked.
    expect(orderStockWeeks(1_000_000, { range: SEPTEMBER, invoiced: 0 })).toBeNull();
    expect(orderStockWeeks(1_000_000, null)).toBeNull();
  });

  it('följer med in i stocken', () => {
    const stock = buildOrderStock([order('scheduled', 700)], { range: { from: '2026-09-01', to: '2026-09-07' }, invoiced: 700 });
    expect(stock.weeks).toBe(1);
    expect(stock.basis).toEqual({ range: { from: '2026-09-01', to: '2026-09-07' }, invoiced: 700 });
  });
});

// ── Öppna offerter ───────────────────────────────────────────────────────────

const TODAY = '2026-10-07';
const open = (
  status: string,
  amount: number,
  valid_until: string | null,
  follow_up_date: string | null = null,
  quote_date = '2026-10-01',
): OpenQuoteRow => ({ status, amount, vat_percent: 0, quote_date, valid_until, follow_up_date });

describe('buildOpenQuotes', () => {
  it('räknar utkast, skickade och uppföljningar — oavsett giltighetstid', () => {
    const quotes = buildOpenQuotes(
      [
        open('draft', 100, '2026-12-31'),
        open('sent', 200, '2026-09-01'),
        open('follow_up', 400, null),
        open('won', 10_000, null),
        open('lost', 20_000, null),
      ],
      TODAY,
    );
    expect(quotes.count).toBe(3);
    expect(quotes.value).toBe(700);
    expect(quotes.drafts).toBe(1);
  });

  it('DRAR INTE AV de utgångna — passerad giltighetstid är inte förlorad', () => {
    // Beslut 2026-10-07. Facit från prod: 206 öppna för 11,51 Mkr, varav 91 för 4,80 Mkr utgångna —
    // summan står kvar på 11,51.
    const quotes = buildOpenQuotes([open('sent', 300, '2026-10-06'), open('draft', 700, '2026-10-01')], TODAY);
    expect(quotes.value).toBe(1000);
    expect(quotes.expired).toEqual({ count: 2, value: 1000, sent: 1, drafts: 1 });
  });

  it('räknar giltig-till IDAG som giltig, och ingen giltighetstid som giltig', () => {
    const quotes = buildOpenQuotes([open('sent', 100, TODAY), open('sent', 100, null), open('sent', 100, '2026-10-06')], TODAY);
    expect(quotes.expired.count).toBe(1);
  });

  it('delar de utgångna i skickade och utkast — uppföljningar räknas som skickade', () => {
    const quotes = buildOpenQuotes(
      [open('follow_up', 100, '2026-09-01'), open('sent', 100, '2026-09-01'), open('draft', 100, '2026-09-01')],
      TODAY,
    );
    expect(quotes.expired.sent).toBe(2);
    expect(quotes.expired.drafts).toBe(1);
  });

  it('utkast inom giltighetstiden: bara de som INTE har gått ut', () => {
    const quotes = buildOpenQuotes(
      [open('draft', 100, '2026-12-31'), open('draft', 200, null), open('draft', 400, '2026-09-01'), open('sent', 800, '2026-12-31')],
      TODAY,
    );
    expect(quotes.draftsWithinValidity).toEqual({ count: 2, value: 300 });
  });

  it('saknat uppföljningsdatum: bara skickade och uppföljningar, av hur många sådana', () => {
    // Ett utkast utan uppföljningsdatum är ingen lucka — det är inte skickat än.
    const quotes = buildOpenQuotes(
      [
        open('sent', 100, null, null),
        open('follow_up', 100, null, null),
        open('sent', 100, null, '2026-10-20'),
        open('draft', 100, null, null),
      ],
      TODAY,
    );
    expect(quotes.missingFollowUpDate).toEqual({ count: 2, of: 3 });
  });

  it('försenade uppföljningar: uppföljningsdatum FÖRE idag, inte idag', () => {
    const quotes = buildOpenQuotes(
      [open('sent', 100, null, '2026-10-06'), open('follow_up', 200, null, TODAY), open('won', 400, null, '2026-09-01')],
      TODAY,
    );
    expect(quotes.overdueFollowUps).toEqual({ count: 1, value: 100 });
  });
});

describe('buildReportOverview', () => {
  const base = {
    quotes: [quote('won'), quote('draft'), quote('draft')],
    range: { from: '2026-08-01', to: '2026-08-31' },
    today: TODAY,
    previous: null,
    basis: null,
  };

  it('räknar periodens utkast för "varav N utkast"', () => {
    const overview = buildReportOverview({ ...base, orderStockRows: [], openQuoteRows: [] });
    expect(overview.quoteDrafts).toBe(2);
    expect(overview.hitRate.quotes).toBe(3);
  });

  it('en läsning som felade ger null — aldrig nollor', () => {
    // "Orderstock 0 kr" hade varit ett påstående om verksamheten, inte ett saknat värde.
    const overview = buildReportOverview({ ...base, orderStockRows: null, openQuoteRows: null });
    expect(overview.orderStock).toBeNull();
    expect(overview.openQuotes).toBeNull();
    expect(overview.hitRate.percent).not.toBeNull();
  });

  it('en TOM läsning är däremot ett riktigt svar: noll i stocken', () => {
    const overview = buildReportOverview({ ...base, orderStockRows: [], openQuoteRows: [] });
    expect(overview.orderStock?.value).toBe(0);
    expect(overview.openQuotes?.count).toBe(0);
  });
});

// ── Trenden ──────────────────────────────────────────────────────────────────


describe('trendWindow', () => {
  const last12 = { from: '2025-11-01', to: '2026-10-07' };

  it('börjar vid första aktiviteten så länge CRM:et är yngre än tolv månader', () => {
    // Utan gränsen hade sju tomma månader (nov–maj) stått före juni 2026.
    expect(trendWindow(last12, '2026-06-29')).toEqual({ from: '2026-06-29', to: '2026-10-07' });
  });

  it('blir aldrig längre än tolv månader', () => {
    expect(trendWindow(last12, '2024-03-15')).toEqual(last12);
  });

  it('faller tillbaka på tolv månader när första aktiviteten är okänd', () => {
    expect(trendWindow(last12, null)).toEqual(last12);
  });
});

describe('buildSalesTrend', () => {
  const goalRow = (period_start: string, over: Partial<ReportGoalRow> = {}): ReportGoalRow => ({
    period_start,
    calls_target: 0,
    quotes_target: 0,
    quote_value_target: 1000,
    order_count_target: 0,
    order_value_target: 500,
    invoiced_value_target: 0,
    ...over,
  });
  const quoteRow = (quote_date: string, amount: number) =>
    ({ amount, vat_percent: 0, status: 'sent', quote_date, assigned_to: null, customer_name: null, quote_type: 'business' });
  const orderRow = (created_at: string, amount: number, over: Record<string, unknown> = {}) =>
    ({ amount, vat_percent: 0, status: 'scheduled', created_at, fortnox_invoiced_at: null, partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null, ...over });

  const window = { from: '2026-06-29', to: '2026-10-07' };
  const trend = buildSalesTrend({
    window,
    selected: { from: '2026-09-01', to: '2026-09-30' },
    goals: [goalRow('2026-06-01'), goalRow('2026-08-01'), goalRow('2026-09-01'), goalRow('2026-10-01', { invoiced_value_target: 700 })],
    data: {
      quotes: [quoteRow('2026-06-29', 100), quoteRow('2026-09-10', 300), quoteRow('2026-06-15', 9999)],
      orders: [
        orderRow('2026-08-05T09:00:00Z', 200),
        orderRow('2026-07-01T09:00:00Z', 400, { status: 'invoiced', fortnox_invoiced_at: '2026-09-20T09:00:00Z' }),
        orderRow('2026-09-02T09:00:00Z', 5000, { status: 'cancelled' }),
      ],
      invoiceRounds: [],
    },
  });
  const point = (period: string) => trend.points.find((p) => p.period === period)!;

  it('en punkt per månad i fönstret', () => {
    expect(trend.points.map((p) => p.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(trend.range).toEqual(window);
  });

  it('räknar som rapporten: ordervärde på skapandedagen, fakturerat på fakturadagen, avbrutna bort', () => {
    expect(point('2026-08').orderValue).toBe(200);
    expect(point('2026-07').orderValue).toBe(400);
    expect(point('2026-09').invoicedValue).toBe(400);
    expect(point('2026-09').orderValue).toBe(0);
    expect(point('2026-09').quoteValue).toBe(300);
  });

  it('räknar inte offerter före fönstret, även i fönstrets första månad', () => {
    // 15 juni ligger i juni men före första aktivitetsdagen 29 juni.
    expect(point('2026-06').quoteValue).toBe(100);
  });

  it('märker delmånaderna — den första (CRM:et startade 29 juni) och den pågående', () => {
    expect(point('2026-06').partial).toEqual({ from: '2026-06-29', to: '2026-06-30' });
    expect(point('2026-10').partial).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(point('2026-08').partial).toBeNull();
  });

  it('🧨 visar målet bara på HELA månader — aldrig på en delmånad, budget eller ej', () => {
    // Juni och oktober har budget, men bara 2 respektive 7 dagars utfall. Ställda mot hela månadens
    // mål hade de sett ut att ligga långt efter.
    expect(point('2026-06').goals).toEqual({ quoteValue: null, orderValue: null, invoicedValue: null });
    expect(point('2026-10').goals).toEqual({ quoteValue: null, orderValue: null, invoicedValue: null });
    expect(point('2026-08').goals).toEqual({ quoteValue: 1000, orderValue: 500, invoicedValue: null });
  });

  it('en hel månad utan budget har inga mål', () => {
    expect(point('2026-07').goals).toEqual({ quoteValue: null, orderValue: null, invoicedValue: null });
  });

  it('markerar månaderna i den valda perioden', () => {
    expect(trend.points.filter((p) => p.inPeriod).map((p) => p.period)).toEqual(['2026-09']);
  });

  it('markerar varje månad perioden RÖR, även delvis — "Denna vecka" över ett månadsskifte', () => {
    const straddling = buildSalesTrend({
      window,
      selected: { from: '2026-09-28', to: '2026-10-04' },
      goals: null,
      data: { quotes: [], orders: [], invoiceRounds: [] },
    });
    expect(straddling.points.filter((p) => p.inPeriod).map((p) => p.period)).toEqual(['2026-09', '2026-10']);
  });

  it('ritar inga mål när målen inte gick att läsa', () => {
    const noGoals = buildSalesTrend({ window, selected: window, goals: null, data: { quotes: [], orders: [], invoiceRounds: [] } });
    expect(noGoals.points.every((p) => Object.values(p.goals).every((g) => g == null))).toBe(true);
    // ... och säger att de inte gick att läsa, så gränssnittet inte påstår att budget saknas.
    expect(noGoals.goalsUnavailable).toBe(true);
    expect(trend.goalsUnavailable).toBe(false);
  });
});

// ── Försäljning ──────────────────────────────────────────────────────────────

describe('suggestsLateEntry — fotnoten vid hit rate 95 % eller mer', () => {
  it('jämför det AVRUNDADE talet, alltså det som står i tabellen', () => {
    // 94,6 % visas som "95 %". Utan avrundningen hade en 95 stått utan fotnot bredvid en 95 med.
    expect(suggestsLateEntry(94.6)).toBe(true);
    expect(suggestsLateEntry(94.4)).toBe(false);
    expect(suggestsLateEntry(95)).toBe(true);
    expect(suggestsLateEntry(100)).toBe(true);
  });

  it('ingen fotnot utan hit rate', () => {
    expect(suggestsLateEntry(null)).toBe(false);
  });
});

describe('buildPerSeller — hit rate per säljare', () => {
  const sellerQuote = (assigned_to: string, status: string): ReportQuoteRow => ({
    amount: 1000, vat_percent: 0, status, quote_date: '2026-08-10', assigned_to, customer_name: null, quote_type: 'business',
  });
  const sellerOrder: ReportOrderRow = {
    amount: 5000, vat_percent: 0, status: 'scheduled', created_at: '2026-08-12T08:00:00Z', fortnox_invoiced_at: null,
    partial_invoicing_started_at: null, assigned_to: 'u3', client_name: null, quote_type: 'business', customer_id: null, rot_enabled: null, customer: null,
  };

  it('vunna ÷ ALLA säljarens offerter — utkast, förlorade och skickade i nämnaren', () => {
    const rows = buildPerSeller(
      [sellerQuote('u1', 'won'), sellerQuote('u1', 'draft'), sellerQuote('u1', 'lost'), sellerQuote('u1', 'sent')],
      [], [], [], [{ id: 'u1', full_name: 'Anna' }],
    );
    expect(rows[0]).toMatchObject({ quotes: 4, won: 1, hitRate: 25, lateEntry: false });
  });

  it('säljarraden bär fotnoten själv — vyn räknar ingenting', () => {
    const rows = buildPerSeller(
      [...Array.from({ length: 19 }, () => sellerQuote('u1', 'won')), sellerQuote('u1', 'sent')],
      [], [], [], [{ id: 'u1', full_name: 'Anna' }],
    );
    expect(rows[0]).toMatchObject({ hitRate: 95, lateEntry: true });
  });

  it('null — inte 0 % — för en säljare utan offerter i perioden', () => {
    // Säljaren syns i tabellen för sin order. 0 % hade påstått att hen inte vann något.
    const rows = buildPerSeller([], [sellerOrder], [], [], [{ id: 'u3', full_name: 'Cecilia' }]);
    expect(rows[0]).toMatchObject({ quotes: 0, won: 0, hitRate: null, lateEntry: false, orders: 1 });
  });
});

describe('quoteAgeDays', () => {
  it('räknar kalenderdagar sedan offertdatumet — dagens offert är 0 dagar', () => {
    expect(quoteAgeDays(TODAY, TODAY)).toBe(0);
    expect(quoteAgeDays('2026-09-23', TODAY)).toBe(14);
    expect(quoteAgeDays('2026-09-22', TODAY)).toBe(15);
  });

  it('ett offertdatum i framtiden är nytt, inte negativt gammalt', () => {
    expect(quoteAgeDays('2026-10-20', TODAY)).toBe(0);
  });

  it('räknar hela dygn över höstens sommartidsväxling', () => {
    // Klockan går tillbaka natten till 25 oktober 2026. Datumen räknas som dygnsnummer, aldrig som
    // millisekunder delat med 86 400 000 — då hade ett 25-timmarsdygn gett en decimal.
    expect(quoteAgeDays('2026-10-20', '2026-11-03')).toBe(14);
  });
});

describe('buildQuoteAge — öppna offerter efter ålder', () => {
  const aged = (quote_date: string, amount = 100, status = 'sent') => open(status, amount, null, null, quote_date);

  it('lägger gränsdagarna i rätt grupp: 14 | 15, 30 | 31, 60 | 61', () => {
    const buckets = buildQuoteAge(
      [
        aged('2026-09-23'), // 14
        aged('2026-09-22'), // 15
        aged('2026-09-07'), // 30
        aged('2026-09-06'), // 31
        aged('2026-08-08'), // 60
        aged('2026-08-07'), // 61
      ],
      TODAY,
    );
    expect(buckets.map((b) => [b.key, b.count])).toEqual([
      ['0-14', 1],
      ['15-30', 2],
      ['31-60', 2],
      ['over-60', 1],
    ]);
  });

  it('summerar netto, och grupperna går jämnt upp mot de öppna offerternas totalsumma', () => {
    const quotes = buildOpenQuotes(
      [aged('2026-10-01', 1250, 'draft'), aged('2026-07-01', 1000, 'sent'), aged('2026-07-01', 99_999, 'won')].map((row, i) =>
        i === 0 ? { ...row, vat_percent: 25 } : row,
      ),
      TODAY,
    );
    expect(quotes.byAge.find((b) => b.key === '0-14')).toMatchObject({ count: 1, value: 1000 });
    expect(quotes.byAge.find((b) => b.key === 'over-60')).toMatchObject({ count: 1, value: 1000 });
    // Den vunna är inte öppen och hör inte hemma i någon grupp.
    expect(quotes.byAge.reduce((t, b) => t + b.count, 0)).toBe(quotes.count);
    expect(quotes.byAge.reduce((t, b) => t + b.value, 0)).toBe(quotes.value);
  });

  it('räknar utkasten med, som överallt', () => {
    const buckets = buildQuoteAge([aged('2026-10-06', 100, 'draft')], TODAY);
    expect(buckets[0].count).toBe(1);
  });

  it('har alltid alla fyra grupperna, även tomma', () => {
    expect(buildQuoteAge([], TODAY).map((b) => [b.key, b.count, b.value])).toEqual([
      ['0-14', 0, 0],
      ['15-30', 0, 0],
      ['31-60', 0, 0],
      ['over-60', 0, 0],
    ]);
  });
});

describe('customerTypeOf', () => {
  it("'private' är privat, allt annat företag — samma läsning som resten av CRM:et", () => {
    expect(customerTypeOf('private')).toBe('private');
    expect(customerTypeOf('business')).toBe('business');
    expect(customerTypeOf(null)).toBe('business');
  });
});

const typed = (status: string, quote_type: string, amount = 1000): ReportQuoteRow => ({
  amount, vat_percent: 0, status, quote_date: '2026-08-10', assigned_to: null, customer_name: null, quote_type,
});

describe('buildCustomerTypeHitRate', () => {
  it('delar periodens offerter på kundtyp, med alla offerter i varje nämnare', () => {
    const rate = buildCustomerTypeHitRate(
      [typed('won', 'business'), typed('draft', 'business'), typed('won', 'private'), typed('lost', 'private'), typed('sent', 'private')],
      { from: '2026-08-01', to: '2026-08-31' },
      TODAY,
    );
    expect(rate.business).toMatchObject({ quotes: 2, won: 1, percent: 50 });
    expect(rate.private).toMatchObject({ quotes: 3, won: 1 });
    expect(rate.private.percent).toBeCloseTo(33.33, 1);
  });

  it('är preliminär när perioden är det — samma mognad som Hit rate-kortet', () => {
    expect(buildCustomerTypeHitRate([], { from: '2026-09-01', to: '2026-09-30' }, TODAY)).toMatchObject({
      preliminary: true,
      matureThrough: '2026-09-07',
    });
    expect(buildCustomerTypeHitRate([], { from: '2026-08-01', to: '2026-08-31' }, TODAY).preliminary).toBe(false);
  });

  it('en kundtyp utan offerter ger null, inte 0 %', () => {
    const rate = buildCustomerTypeHitRate([typed('won', 'business')], { from: '2026-08-01', to: '2026-08-31' }, TODAY);
    expect(rate.private.percent).toBeNull();
  });
});

describe('buildHitRateByMonth', () => {
  const dated = (status: string, quote_date: string): ReportQuoteRow => ({ ...typed(status, 'business'), quote_date });
  const window = { from: '2026-06-29', to: TODAY };
  const september = { from: '2026-09-01', to: '2026-09-30' };
  const months = buildHitRateByMonth({
    quotes: [
      dated('won', '2026-06-28'), // före fönstret
      dated('won', '2026-06-30'),
      dated('won', '2026-08-03'),
      dated('sent', '2026-08-20'),
      dated('draft', '2026-08-31'),
      dated('won', '2026-09-15'),
      dated('sent', '2026-10-02'),
    ],
    window,
    selected: september,
    today: TODAY,
  });

  it('en punkt per offertmånad i fönstret, oavsett vald period', () => {
    expect(months.map((m) => m.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('räknar på offertdatumet, med alla månadens offerter i nämnaren', () => {
    expect(months.find((m) => m.period === '2026-08')).toMatchObject({ quotes: 3, won: 1 });
    expect(months.find((m) => m.period === '2026-10')).toMatchObject({ quotes: 1, won: 0, percent: 0 });
  });

  it('räknar inte offerter före fönstret, även i fönstrets första månad', () => {
    expect(months.find((m) => m.period === '2026-06')).toMatchObject({ quotes: 1, won: 1 });
  });

  it('en tom månad har ingen hit rate — null, inte 0 %', () => {
    expect(months.find((m) => m.period === '2026-07')).toMatchObject({ quotes: 0, percent: null });
  });

  it('varje månad har sin egen mognad: augusti slutgiltig, september och oktober preliminära', () => {
    // Den 7 oktober: offerter efter 7 september är yngre än 30 dagar.
    expect(months.map((m) => [m.period, m.preliminary])).toEqual([
      ['2026-06', false],
      ['2026-07', false],
      ['2026-08', false],
      ['2026-09', true],
      ['2026-10', true],
    ]);
  });

  it('en månad vars sista dag är EXAKT 30 dagar gammal är mogen', () => {
    const [august] = buildHitRateByMonth({ quotes: [], window: { from: '2026-08-01', to: '2026-08-31' }, selected: september, today: '2026-09-30' });
    expect(august.preliminary).toBe(false);
    const [late] = buildHitRateByMonth({ quotes: [], window: { from: '2026-08-01', to: '2026-08-31' }, selected: september, today: '2026-09-29' });
    expect(late.preliminary).toBe(true);
  });

  it('märker delmånaderna — den första (CRM:et startade 29 juni) och den pågående', () => {
    expect(months.filter((m) => m.partial).map((m) => [m.period, m.partial])).toEqual([
      ['2026-06', { from: '2026-06-29', to: '2026-06-30' }],
      ['2026-10', { from: '2026-10-01', to: TODAY }],
    ]);
  });

  it('markerar månaderna i den valda perioden', () => {
    expect(months.filter((m) => m.inPeriod).map((m) => m.period)).toEqual(['2026-09']);
  });
});

describe('median', () => {
  it('mittvärdet för ett udda antal, oavsett ordning', () => {
    expect(median([30, 10, 20])).toBe(20);
  });
  it('medelvärdet av de två mittersta för ett jämnt antal', () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });
  it('null för en tom lista', () => {
    expect(median([])).toBeNull();
  });
});

describe('buildTypicalOrder', () => {
  const order = (amount: number, quote_type: string, vat_percent = 0): ReportOrderRow => ({
    amount, vat_percent, status: 'scheduled', created_at: '2026-08-12T08:00:00Z', fortnox_invoiced_at: null,
    partial_invoicing_started_at: null, assigned_to: null, client_name: null, quote_type, customer_id: null, rot_enabled: null, customer: null,
  });

  it('median och snitt per kundtyp — snittet dras upp av ett stort jobb, medianen inte', () => {
    const typical = buildTypicalOrder([order(10_000, 'business'), order(20_000, 'business'), order(300_000, 'business'), order(5_000, 'private')]);
    expect(typical.business).toEqual({ count: 3, median: 20_000, mean: 110_000 });
    expect(typical.private).toEqual({ count: 1, median: 5_000, mean: 5_000 });
  });

  it('räknar netto — en privatorder med 25 % moms jämförs utan momsen', () => {
    expect(buildTypicalOrder([order(12_500, 'private', 25)]).private.median).toBe(10_000);
  });

  it('en kundtyp utan order ger null, inte 0 kr', () => {
    expect(buildTypicalOrder([order(1000, 'business')]).private).toEqual({ count: 0, median: null, mean: null });
  });
});

describe('buildReportSales', () => {
  const input = {
    quotes: [typed('won', 'business')],
    ordersCreated: [],
    range: { from: '2026-08-01', to: '2026-08-31' },
    today: TODAY,
  };

  it('hit rate per månad ur trendens offerter och fönster', () => {
    const sales = buildReportSales({ ...input, trend: { quotes: [typed('won', 'private')], window: { from: '2026-08-01', to: '2026-08-31' } } });
    expect(sales.hitRateByMonth).toHaveLength(1);
    expect(sales.hitRateByMonth?.[0]).toMatchObject({ period: '2026-08', quotes: 1, won: 1, inPeriod: true });
  });

  it('en trasig trendläsning tar bara bort hit rate per månad — null, aldrig en tom serie', () => {
    const sales = buildReportSales({ ...input, trend: null });
    expect(sales.hitRateByMonth).toBeNull();
    expect(sales.hitRateByCustomerType.business).toMatchObject({ quotes: 1, won: 1 });
    expect(sales.typicalOrder.business.count).toBe(0);
  });
});
