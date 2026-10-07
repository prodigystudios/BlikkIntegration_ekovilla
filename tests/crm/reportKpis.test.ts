import { describe, it, expect } from 'vitest';
import {
  buildHitRate,
  buildOpenQuotes,
  buildOrderStock,
  buildPeriodHitRate,
  buildReportOverview,
  hitRateMaturity,
  orderStockWeeks,
  ORDER_STOCK_STATUSES,
  type OpenQuoteRow,
  type OrderStockRow,
} from '@/lib/domains/crm/reportKpis';

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

  it('räknar kalenderdagar över sommartidsväxlingen', () => {
    // Klockan går tillbaka natten till 25 oktober 2026. Datumen är strängar och aritmetiken
    // UTC-förankrad (addDaysISO), så ingen timme försvinner ur räkningen i någon zon.
    expect(hitRateMaturity({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-30').matureThrough).toBe('2026-09-30');
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
): OpenQuoteRow => ({ status, amount, vat_percent: 0, valid_until, follow_up_date });

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
