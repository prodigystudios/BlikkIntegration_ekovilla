import { netAmount, type NetAmountRow } from './pricing';
import { sumUninvoiced } from './invoicedRevenue';
import { buildHitRate, type HitRate, type HitRateQuoteRow } from './hitRate';
import {
  ACTIVE_QUOTE_STATUSES,
  ORDER_STOCK_STATUSES,
  WAITING_QUOTE_STATUSES,
  type OrderStockRow,
} from './overviewSummary';
import type { CrmCustomerType } from './customers';
import type { CrmQuoteStatus } from './quotes';
import type { CrmWorkOrderStatus } from './work-orders';
import { addDaysISO, daysBetweenInclusiveISO, isoDayNumber } from '@/lib/domains/planning/timezone';
import {
  buildSalesOverTime,
  monthsInRange,
  partitionOrders,
  type ReportData,
  type ReportOrderRow,
  type ReportQuoteRow,
  type ReportRange,
} from './reports';
import { monthBounds, sumGoalTargets, type ReportGoalRow } from './reportGoals';

// Rapportsidans nyckeltal utöver de sex huvudtalen: hit rate, orderstock och öppna offerter.
// Modulen är ren — inga anrop, ingen klocka. Dagens datum kommer in som argument (svensk dag), och
// läsningarna bor i reportKpisLoader.ts.
//
// ⚠️ RAPPORTEN DRAR INGA SLUTSATSER AV STATUSAR SOM SÄLJAREN SÄTTER (Williams beslut 2026-10-07).
// Skickad, Förlorad, Utkast och passerad giltighetstid säger ingenting om hur det gick: säljare
// glömmer att ändra Utkast till Skickad, och bara 12 av 440 offerter var markerade som förlorade.
// Bara Vunnen sätts av systemet — när ordern skapas från offerten — och bara den får bära en
// beräkning. Därför:
//   · utkast räknas som offerter överallt (hit rate, öppna offerter),
//   · en offert som passerat giltighetstiden är fortfarande ÖPPEN; den blir en påminnelse om att
//     uppdatera status, aldrig en förlust,
//   · hit rate har alla periodens offerter i nämnaren, oavsett status.

const DRAFT: CrmQuoteStatus = 'draft';
const COMPLETED: CrmWorkOrderStatus = 'completed';

/** Datumdelen, för strängjämförelse mot en svensk dag (ÅÅÅÅ-MM-DD). */
function dayOf(value: string | null | undefined): string | null {
  return value ? String(value).slice(0, 10) : null;
}

function sumNet(rows: NetAmountRow[]): number {
  return rows.reduce((total, row) => total + netAmount(row), 0);
}

// ── Hit rate ─────────────────────────────────────────────────────────────────
//
// Regeln själv (buildHitRate) bor i hitRate.ts, så att säljartabellen i reports.ts kan räkna med samma
// funktion utan att importera den här modulen, som i sin tur importerar reports.ts.

export { buildHitRate, type HitRate, type HitRateQuoteRow };

/**
 * Hur gamla offerterna måste vara innan hit rate är slutlig. Mätt i prod 2026-10-07: 61 % av
 * vinsterna registreras samma dag som offertdatumet, 92 % inom 14 dagar och 98 % inom 30. 432 av
 * 443 offerter har dessutom exakt 30 dagars giltighet.
 */
export const HIT_RATE_MATURITY_DAYS = 30;

/**
 * Är periodens hit rate preliminär?
 *
 * Ja när periodens sista dag ligger MINDRE än 30 dagar före idag: offerter daterade efter
 * `matureThrough` har inte hunnit vinnas, och talet stiger sannolikt ännu. En offert daterad exakt
 * 30 dagar bakåt räknas som mogen.
 */
export function hitRateMaturity(range: ReportRange, today: string): { preliminary: boolean; matureThrough: string } {
  const matureThrough = addDaysISO(today, -HIT_RATE_MATURITY_DAYS);
  return { preliminary: range.to > matureThrough, matureThrough };
}

export type PeriodHitRate = HitRate & {
  preliminary: boolean;
  /** Offerter daterade EFTER den här dagen är yngre än 30 dagar. */
  matureThrough: string;
  /**
   * Föregående lika långa periods hit rate.
   *
   * ⚠️ null NÄR NÅGON AV PERIODERNA ÄR PRELIMINÄR, inte bara när läsningen felade. En preliminär
   * period har ett tal som ännu stiger; ställd mot en mogen period ser den ut att ha tappat, varje
   * gång någon tittar på innevarande månad.
   */
  previous: HitRate | null;
};

export function buildPeriodHitRate(input: {
  quotes: HitRateQuoteRow[];
  range: ReportRange;
  today: string;
  /** Föregående period och dess offerter. null när den inte gick att hämta. */
  previous?: { range: ReportRange; quotes: HitRateQuoteRow[] } | null;
}): PeriodHitRate {
  const maturity = hitRateMaturity(input.range, input.today);
  const previous = input.previous ?? null;
  // Jämförelseperioden slutar alltid före perioden (previousRange), så en mogen period har i praktiken
  // en mogen föregångare. Kontrollen av båda står kvar som ett bälte: regeln är "ingen jämförelse om
  // någon av de två är preliminär", och den ska hålla även för ett intervall som kommer någon annanstans ifrån.
  const comparable =
    previous != null && !maturity.preliminary && !hitRateMaturity(previous.range, input.today).preliminary;
  return {
    ...buildHitRate(input.quotes),
    ...maturity,
    previous: comparable ? buildHitRate(previous.quotes) : null,
  };
}

// ── Orderstock (nu) ──────────────────────────────────────────────────────────

// Orderstocken = order som varken är avbrutna eller helt fakturerade: ej planerad, planerad, pågår,
// klar och delfakturerad. Statuslistan (ORDER_STOCK_STATUSES) delas med översiktens två orderlager.

export type { OrderStockRow };

export type OrderStock = {
  /** Kvar att fakturera, netto. En delfakturerad order bär bara sin rest. */
  value: number;
  count: number;
  /**
   * Ungefär hur många veckors fakturering stocken räcker till, i takten från senaste hela
   * kalendermånaden. null när den månaden fakturerade 0 eller inte gick att läsa — ett veckotal
   * mot en takt på noll är inget tal.
   */
  weeks: number | null;
  /** Månaden takten mäts mot, och vad den fakturerade. null när faktureringen inte kunde läsas. */
  basis: { range: ReportRange; invoiced: number } | null;
  /** Klara men inte fakturerade (status Klar) — en rad under "Kräver åtgärd". */
  completed: { count: number; value: number };
};

/**
 * Orderstocken i veckor: stocken ÷ (månadens fakturering ÷ (månadens dagar ÷ 7)).
 *
 * Takten är veckans andel av en HEL kalendermånad, inte den valda perioden: en period som slutar
 * idag har en halv månads fakturering, och då hade stocken sett dubbelt så lång ut den 15:e.
 */
export function orderStockWeeks(stockValue: number, basis: { range: ReportRange; invoiced: number } | null): number | null {
  if (!basis || !(basis.invoiced > 0)) return null;
  const days = daysBetweenInclusiveISO(basis.range.from, basis.range.to);
  if (!(days > 0)) return null;
  return stockValue / (basis.invoiced / (days / 7));
}

export function buildOrderStock(
  rows: OrderStockRow[],
  basis: { range: ReportRange; invoiced: number } | null,
): OrderStock {
  // Filtreras här också, inte bara i läsningen: funktionen ska ge samma svar vilken läsning som än
  // matar den, och en avbruten eller färdigfakturerad order är aldrig stock.
  const stock = rows.filter((row) => ORDER_STOCK_STATUSES.includes(row.status as CrmWorkOrderStatus));
  const completed = stock.filter((row) => row.status === COMPLETED);
  const value = sumUninvoiced(stock);
  return {
    value,
    count: stock.length,
    weeks: orderStockWeeks(value, basis),
    basis,
    completed: { count: completed.length, value: sumUninvoiced(completed) },
  };
}

// ── Öppna offerter (nu) ──────────────────────────────────────────────────────

export type OpenQuoteRow = NetAmountRow & {
  status: string | null;
  /** Offertdatumet (NOT NULL i schemat) — åldern i "Öppna offerter efter ålder". */
  quote_date: string;
  valid_until: string | null;
  follow_up_date: string | null;
};

export type CountAndValue = { count: number; value: number };

export type OpenQuotes = CountAndValue & {
  /** Varav utkast. */
  drafts: number;
  /**
   * Passerat giltighetstiden: giltig-till före idag. ⚠️ INGÅR I `value` — dras aldrig av. En
   * utgången offert är inte förlorad; säljaren kan ha missat att uppdatera den.
   */
  expired: CountAndValue & {
    /** Varav skickade eller markerade för uppföljning. */
    sent: number;
    /** Varav utkast. */
    drafts: number;
  };
  /** Utkast som fortfarande är giltiga — har de skickats? */
  draftsWithinValidity: CountAndValue;
  /** Skickade och uppföljningar utan uppföljningsdatum, av hur många sådana som finns. */
  missingFollowUpDate: { count: number; of: number };
  /** Öppna offerter vars uppföljningsdatum har passerat. */
  overdueFollowUps: CountAndValue;
  /** De öppna offerterna efter ålder, i QUOTE_AGE_BUCKETS ordning — Försäljning. */
  byAge: QuoteAgeBucket[];
};

/**
 * Åldersgrupperna för de öppna offerterna: dagar sedan offertdatumet, i den ordningen. `maxDays` är
 * gruppens sista dag; den sista gruppen saknar tak. Utkasten räknas in, som överallt.
 */
export const QUOTE_AGE_BUCKETS = [
  { key: '0-14', minDays: 0, maxDays: 14 },
  { key: '15-30', minDays: 15, maxDays: 30 },
  { key: '31-60', minDays: 31, maxDays: 60 },
  { key: 'over-60', minDays: 61, maxDays: null },
] as const;

export type QuoteAgeKey = (typeof QUOTE_AGE_BUCKETS)[number]['key'];

export type QuoteAgeBucket = CountAndValue & { key: QuoteAgeKey; minDays: number; maxDays: number | null };

/**
 * Hur många dagar sedan offertdatumet, räknat i svenska kalenderdagar — dagens offert är 0 dagar.
 * Ett offertdatum i framtiden räknas som 0: offerten är ny, inte negativt gammal. null bara för ett
 * datum som inte går att läsa, vilket schemat inte släpper in (quote_date är NOT NULL).
 */
export function quoteAgeDays(quoteDate: string, today: string): number | null {
  const start = isoDayNumber(dayOf(quoteDate));
  const end = isoDayNumber(today);
  if (start == null || end == null) return null;
  return Math.max(0, end - start);
}

export function buildQuoteAge(rows: OpenQuoteRow[], today: string): QuoteAgeBucket[] {
  const buckets: QuoteAgeBucket[] = QUOTE_AGE_BUCKETS.map((bucket) => ({ ...bucket, count: 0, value: 0 }));
  for (const row of rows) {
    const age = quoteAgeDays(row.quote_date, today);
    if (age == null) continue;
    const bucket = buckets.find((b) => b.maxDays == null || age <= b.maxDays)!;
    bucket.count += 1;
    bucket.value += netAmount(row);
  }
  return buckets;
}

function countAndValue(rows: NetAmountRow[]): CountAndValue {
  return { count: rows.length, value: sumNet(rows) };
}

/**
 * De öppna offerterna — status Utkast, Skickad eller Uppföljning, oavsett giltighetstid — och
 * påminnelserna under "Kräver åtgärd". Påminnelserna är neutrala: de ber säljaren uppdatera
 * status, de påstår aldrig att något är förlorat.
 */
export function buildOpenQuotes(rows: OpenQuoteRow[], today: string): OpenQuotes {
  const open = rows.filter((row) => ACTIVE_QUOTE_STATUSES.includes(row.status as CrmQuoteStatus));
  const isDraft = (row: OpenQuoteRow) => row.status === DRAFT;
  const isWaiting = (row: OpenQuoteRow) => WAITING_QUOTE_STATUSES.includes(row.status as CrmQuoteStatus);
  // Ingen giltighetstid satt = inte utgången. Strängjämförelse på svensk dag.
  const isExpired = (row: OpenQuoteRow) => {
    const validUntil = dayOf(row.valid_until);
    return validUntil != null && validUntil < today;
  };

  const expired = open.filter(isExpired);
  const waiting = open.filter(isWaiting);

  return {
    ...countAndValue(open),
    drafts: open.filter(isDraft).length,
    expired: {
      ...countAndValue(expired),
      sent: expired.filter(isWaiting).length,
      drafts: expired.filter(isDraft).length,
    },
    draftsWithinValidity: countAndValue(open.filter((row) => isDraft(row) && !isExpired(row))),
    missingFollowUpDate: { count: waiting.filter((row) => dayOf(row.follow_up_date) == null).length, of: waiting.length },
    overdueFollowUps: countAndValue(open.filter((row) => {
      const followUp = dayOf(row.follow_up_date);
      return followUp != null && followUp < today;
    })),
    byAge: buildQuoteAge(open, today),
  };
}

// ── Översikten ───────────────────────────────────────────────────────────────

export type ReportOverview = {
  /** Periodens hit rate. Räknas på periodens offerter, som alltid finns — kan inte utebli. */
  hitRate: PeriodHitRate;
  /** Utkast bland periodens offerter — "varav N utkast" på offertkortet. */
  quoteDrafts: number;
  /** Orderstocken just nu. ⚠️ null = KUNDE INTE RÄKNAS, aldrig "ingen stock". */
  orderStock: OrderStock | null;
  /** De öppna offerterna just nu. ⚠️ null = KUNDE INTE RÄKNAS, aldrig "inga offerter". */
  openQuotes: OpenQuotes | null;
};

export function buildReportOverview(input: {
  quotes: HitRateQuoteRow[];
  range: ReportRange;
  today: string;
  previous?: { range: ReportRange; quotes: HitRateQuoteRow[] } | null;
  /** null = läsningen felade. */
  orderStockRows: OrderStockRow[] | null;
  /** Senaste hela kalendermånadens fakturering. null = läsningen felade. */
  basis: { range: ReportRange; invoiced: number } | null;
  /** null = läsningen felade. */
  openQuoteRows: OpenQuoteRow[] | null;
}): ReportOverview {
  return {
    hitRate: buildPeriodHitRate(input),
    quoteDrafts: input.quotes.filter((quote) => quote.status === DRAFT).length,
    orderStock: input.orderStockRows ? buildOrderStock(input.orderStockRows, input.basis) : null,
    openQuotes: input.openQuoteRows ? buildOpenQuotes(input.openQuoteRows, input.today) : null,
  };
}

// ── Trenden ──────────────────────────────────────────────────────────────────
//
// Offerter, orderingång och fakturerat per månad. ⚠️ FÖLJER INTE PERIODEN (Williams beslut 2026-10-07):
// sidan öppnar på "Denna månad", och ett diagram som följde perioden hade då varit en enda stapel. I
// stället visas alltid de senaste tolv månaderna — eller sedan start, så länge CRM:et är yngre än så —
// med den valda perioden markerad.

export type TrendSeriesKey = 'quoteValue' | 'orderValue' | 'invoicedValue';

export const TREND_SERIES_KEYS: TrendSeriesKey[] = ['quoteValue', 'orderValue', 'invoicedValue'];

export type TrendPoint = Record<TrendSeriesKey, number> & {
  /** 'YYYY-MM'. */
  period: string;
  /**
   * Månadens mål per serie, summerat över säljarna.
   *
   * ⚠️ null PÅ EN DELMÅNAD, även när budget finns. En pågående månad har bara några dagars utfall,
   * och ställd mot hela månadens budget ser den ut att ligga långt efter varje gång någon tittar —
   * samma felläsning som målstapelns "ingen proratering" spärrar. Målet visas bara på hela månader.
   */
  goals: Record<TrendSeriesKey, number | null>;
  /** Dagarna som räknas när månaden inte är hel — den pågår, eller CRM:et startade mitt i den. null = hel månad. */
  partial: ReportRange | null;
  /** Ligger månaden helt eller delvis i den valda perioden? */
  inPeriod: boolean;
};

export type SalesTrend = {
  /** Fönstret som visas: från tolv månader bakåt (eller första aktiviteten) till idag. */
  range: ReportRange;
  points: TrendPoint[];
  /**
   * Målen gick inte att läsa. ⚠️ Skilt från "ingen budget satt": utan flaggan hade ett läsfel visats
   * som ett påstående om budgeten ("Ingen budget satt för månaden") på varje hel månad.
   */
  goalsUnavailable: boolean;
};

/**
 * Trendens fönster: de senaste tolv månaderna (`last12`, som snabbvalet "Senaste 12 mån"), men aldrig
 * före första aktiviteten i CRM:et. Utan den gränsen hade ett halvår av tomma staplar stått före
 * juni 2026, och den första månaden hade inte gått att känna igen som en delmånad.
 */
export function trendWindow(last12: ReportRange, firstActivityDay: string | null): ReportRange {
  const from = firstActivityDay && firstActivityDay > last12.from ? firstActivityDay : last12.from;
  return { from: from > last12.to ? last12.to : from, to: last12.to };
}

/**
 * Månadens dagar inom fönstret. `partial` är satt när fönstret skär månaden — den pågår, eller CRM:et
 * startade mitt i den — och är då de dagar som räknas. Delas av trenden, hit rate per månad och
 * fakturerat per månad (reportRevenue.ts), så att de alltid märker samma månader som delmånader.
 */
export function monthSpan(period: string, window: ReportRange): { from: string; to: string; partial: ReportRange | null } {
  const month = monthBounds(period);
  const from = month.from > window.from ? month.from : window.from;
  const to = month.to < window.to ? month.to : window.to;
  return { from, to, partial: from !== month.from || to !== month.to ? { from, to } : null };
}

/** Ligger månaden helt eller delvis i den valda perioden? */
export function monthTouches(period: string, selected: ReportRange): boolean {
  const month = monthBounds(period);
  return month.from <= selected.to && month.to >= selected.from;
}

export function buildSalesTrend(input: {
  data: Pick<ReportData, 'quotes' | 'orders' | 'invoiceRounds'>;
  window: ReportRange;
  selected: ReportRange;
  /** Målraderna för fönstrets månader. null = de gick inte att läsa; då ritas inga mål. */
  goals: ReportGoalRow[] | null;
}): SalesTrend {
  const months = monthsInRange(input.window.from, input.window.to);
  // Samma partitionering och samma månadsserie som rapporten: ordervärde på skapandedagen,
  // fakturerat per faktura på fakturadagen, avbrutna order bort.
  const orders = partitionOrders(input.data.orders, input.window, input.data.invoiceRounds);
  const quotes = input.data.quotes.filter((quote) => {
    const day = quote.quote_date ? String(quote.quote_date).slice(0, 10) : null;
    return day != null && day >= input.window.from && day <= input.window.to;
  });
  const series = buildSalesOverTime(quotes, orders.created, orders.revenue, months);

  return {
    range: input.window,
    goalsUnavailable: input.goals == null,
    points: series.map((point) => {
      const { partial } = monthSpan(point.period, input.window);
      const targets = partial || !input.goals ? {} : sumGoalTargets(input.goals, [point.period]);
      return {
        period: point.period,
        quoteValue: point.quoteValue,
        orderValue: point.orderValue,
        invoicedValue: point.invoicedValue,
        goals: {
          quoteValue: targets.quoteValue ?? null,
          orderValue: targets.orderValue ?? null,
          invoicedValue: targets.invoicedValue ?? null,
        },
        partial,
        inPeriod: monthTouches(point.period, input.selected),
      };
    }),
  };
}

// ── Försäljning ──────────────────────────────────────────────────────────────
//
// Försäljningsflikens nyckeltal (spec 2026-10-07, 4.3). Hit rate följer samma regel överallt —
// buildHitRate, vunna ÷ ALLA offerter — och drar inga slutsatser av statusar säljaren sätter.

export type CustomerTypeHitRate = Record<CrmCustomerType, HitRate> & {
  /** Periodens mognad, samma som Hit rate-kortets: preliminär när perioden slutar inom 30 dagar. */
  preliminary: boolean;
  matureThrough: string;
};

/**
 * Kundtypen ur quote_type: 'private' är privat, allt annat företag — samma läsning som resten av CRM:et
 * (work-orders.ts, workOrderReadiness.ts). Schemat släpper bara in 'private' och 'business'.
 */
export function customerTypeOf(quoteType: string | null | undefined): CrmCustomerType {
  return quoteType === 'private' ? 'private' : 'business';
}

/** Periodens hit rate per kundtyp. Följer perioden, och är preliminär när perioden är det. */
export function buildCustomerTypeHitRate(
  quotes: Array<HitRateQuoteRow & Pick<ReportQuoteRow, 'quote_type'>>,
  range: ReportRange,
  today: string,
): CustomerTypeHitRate {
  return {
    business: buildHitRate(quotes.filter((quote) => customerTypeOf(quote.quote_type) === 'business')),
    private: buildHitRate(quotes.filter((quote) => customerTypeOf(quote.quote_type) === 'private')),
    ...hitRateMaturity(range, today),
  };
}

export type HitRateMonth = HitRate & {
  /** 'YYYY-MM' — offertmånaden: offerterna räknas på sitt offertdatum. */
  period: string;
  /** Månadens offerter är inte alla 30 dagar gamla än — talet stiger sannolikt. */
  preliminary: boolean;
  /** Dagarna som räknas när månaden inte är hel. null = hel månad. */
  partial: ReportRange | null;
  /** Ligger månaden helt eller delvis i den valda perioden? */
  inPeriod: boolean;
};

/**
 * Hit rate per offertmånad i trendens fönster — de senaste tolv månaderna eller sedan start.
 *
 * ⚠️ FÖLJER INTE PERIODEN (Williams beslut 2026-10-07, samma som trenden): sidan öppnar på "Denna
 * månad", och en månadsserie över den valda perioden hade varit en enda stapel som bara upprepar
 * Hit rate-kortet. Den valda perioden markeras i stället.
 *
 * Varje månad har sin egen mognad: en månad vars sista räknade dag ligger inom 30 dagar är preliminär.
 */
export function buildHitRateByMonth(input: {
  quotes: Array<HitRateQuoteRow & Pick<ReportQuoteRow, 'quote_date'>>;
  window: ReportRange;
  selected: ReportRange;
  today: string;
}): HitRateMonth[] {
  const byMonth = new Map<string, HitRateQuoteRow[]>();
  for (const quote of input.quotes) {
    const day = dayOf(quote.quote_date);
    // Utanför fönstret räknas inte, även i fönstrets första månad — samma regel som trenden.
    if (day == null || day < input.window.from || day > input.window.to) continue;
    const period = day.slice(0, 7);
    const list = byMonth.get(period);
    if (list) list.push(quote);
    else byMonth.set(period, [quote]);
  }
  return monthsInRange(input.window.from, input.window.to).map((period) => {
    const span = monthSpan(period, input.window);
    return {
      period,
      ...buildHitRate(byMonth.get(period) ?? []),
      preliminary: hitRateMaturity({ from: span.from, to: span.to }, input.today).preliminary,
      partial: span.partial,
      inPeriod: monthTouches(period, input.selected),
    };
  });
}

export type TypicalOrder = {
  count: number;
  /** Medianen av ordervärdet, netto — hälften av ordrarna är större. null utan order. */
  median: number | null;
  /** Snittet, netto. Dras upp av några stora jobb, därför bara i undertexten. null utan order. */
  mean: number | null;
};

/** Median, och för ett jämnt antal medelvärdet av de två mittersta. null för en tom lista. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function typicalOrder(rows: NetAmountRow[]): TypicalOrder {
  const values = rows.map((row) => netAmount(row));
  return {
    count: values.length,
    median: median(values),
    mean: values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null,
  };
}

/**
 * Typisk order per kundtyp: median och snitt av ordervärdet på order SKAPADE i perioden — samma order
 * som Orderingång, så avbrutna är redan borta (partitionOrders). Anroparen skickar in dem.
 */
export function buildTypicalOrder(ordersCreated: Array<NetAmountRow & Pick<ReportOrderRow, 'quote_type'>>): Record<CrmCustomerType, TypicalOrder> {
  return {
    business: typicalOrder(ordersCreated.filter((order) => customerTypeOf(order.quote_type) === 'business')),
    private: typicalOrder(ordersCreated.filter((order) => customerTypeOf(order.quote_type) === 'private')),
  };
}

export type ReportSales = {
  hitRateByCustomerType: CustomerTypeHitRate;
  /** Trendens fönster. ⚠️ null = KUNDE INTE RÄKNAS (trendens läsning felade), aldrig "inga offerter". */
  hitRateByMonth: HitRateMonth[] | null;
  typicalOrder: Record<CrmCustomerType, TypicalOrder>;
};

export function buildReportSales(input: {
  /** Periodens offerter. */
  quotes: ReportQuoteRow[];
  /** Order skapade i perioden, utan avbrutna — partitionOrders(...).created. */
  ordersCreated: ReportOrderRow[];
  range: ReportRange;
  today: string;
  /** Trendens offerter och fönster. null = trendens läsning felade. */
  trend: { quotes: ReportQuoteRow[]; window: ReportRange } | null;
}): ReportSales {
  return {
    hitRateByCustomerType: buildCustomerTypeHitRate(input.quotes, input.range, input.today),
    hitRateByMonth: input.trend
      ? buildHitRateByMonth({ quotes: input.trend.quotes, window: input.trend.window, selected: input.range, today: input.today })
      : null,
    typicalOrder: buildTypicalOrder(input.ordersCreated),
  };
}
