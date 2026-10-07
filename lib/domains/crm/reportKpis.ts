import { netAmount, type NetAmountRow } from './pricing';
import { sumUninvoiced } from './invoicedRevenue';
import {
  ACTIVE_QUOTE_STATUSES,
  OPEN_WORK_ORDER_STATUSES,
  TO_INVOICE_WORK_ORDER_STATUSES,
  WAITING_QUOTE_STATUSES,
  type OrderStockRow,
} from './overviewSummary';
import type { CrmQuoteStatus } from './quotes';
import type { CrmWorkOrderStatus } from './work-orders';
import { addDaysISO } from '@/lib/domains/planning/timezone';
import type { ReportRange } from './reports';

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

const WON: CrmQuoteStatus = 'won';
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

export type HitRateQuoteRow = NetAmountRow & { status: string | null };

export type HitRate = {
  /** Alla offerter i underlaget, oavsett status — utkast, skickade, förlorade och utgångna. */
  quotes: number;
  /** Offerter med status Vunnen. */
  won: number;
  /** Vunna av antalet, i procent. null när underlaget saknar offerter. */
  percent: number | null;
  quoteValue: number;
  wonValue: number;
  /** Vunnet av offertvärdet (netto), i procent. null när offertvärdet är 0. */
  valuePercent: number | null;
};

/**
 * Hit rate = vunna ÷ ALLA offerter, i antal och i kronor (netto).
 *
 * ⚠️ NÄMNAREN ÄR ALLA OFFERTER. Avfärdade varianter, prövade mot prod 2026-10-07:
 *   · "vunna av avgjorda" (vunna + förlorade) gav 95 %, eftersom nästan inga offerter markeras som
 *     förlorade — talet hade sagt ingenting,
 *   · "avgjort i perioden" blåses upp när antalet offerter växer,
 *   · en fast 30-dagarskohort blir tom för "Denna månad".
 *
 * Talet kan bli för lågt men aldrig för högt: 33 order har skapats utan koppling till en offert,
 * och hör en sådan till en öppen offert räknas den offerten inte som vunnen.
 */
export function buildHitRate(quotes: HitRateQuoteRow[]): HitRate {
  const won = quotes.filter((quote) => quote.status === WON);
  const quoteValue = sumNet(quotes);
  const wonValue = sumNet(won);
  return {
    quotes: quotes.length,
    won: won.length,
    percent: quotes.length > 0 ? (won.length / quotes.length) * 100 : null,
    quoteValue,
    wonValue,
    valuePercent: quoteValue > 0 ? (wonValue / quoteValue) * 100 : null,
  };
}

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
  const comparable =
    previous != null && !maturity.preliminary && !hitRateMaturity(previous.range, input.today).preliminary;
  return {
    ...buildHitRate(input.quotes),
    ...maturity,
    previous: comparable ? buildHitRate(previous.quotes) : null,
  };
}

// ── Orderstock (nu) ──────────────────────────────────────────────────────────

/**
 * Order som varken är avbrutna eller helt fakturerade: ej planerad, planerad, pågår, klar och
 * delfakturerad. Samma två listor som översiktens "Öppna ordrar" och "Att fakturera", så att
 * rapportens orderstock och översiktens två lager alltid går att stämma av mot varandra.
 */
export const ORDER_STOCK_STATUSES: readonly CrmWorkOrderStatus[] = [
  ...OPEN_WORK_ORDER_STATUSES,
  ...TO_INVOICE_WORK_ORDER_STATUSES,
];

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

/** Kalenderdagar i intervallet, båda ändar inräknade. Strängarna är datum, aldrig tidpunkter. */
function daysInclusive(range: ReportRange): number {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Orderstocken i veckor: stocken ÷ (månadens fakturering ÷ (månadens dagar ÷ 7)).
 *
 * Takten är veckans andel av en HEL kalendermånad, inte den valda perioden: en period som slutar
 * idag har en halv månads fakturering, och då hade stocken sett dubbelt så lång ut den 15:e.
 */
export function orderStockWeeks(stockValue: number, basis: { range: ReportRange; invoiced: number } | null): number | null {
  if (!basis || !(basis.invoiced > 0)) return null;
  const days = daysInclusive(basis.range);
  if (days <= 0) return null;
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
};

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
