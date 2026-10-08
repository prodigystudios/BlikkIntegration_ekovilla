import { netAmount } from './pricing';
import { sumUninvoiced, type InvoicedRevenue } from './invoicedRevenue';
import type { CrmCustomerType } from './customers';
import { BOARD_FILTER_STATUSES, isDeadWorkOrder, type CrmWorkOrderStatus } from './work-orders';
import { ORDER_STOCK_STATUSES, type OrderStockRow } from './overviewSummary';
import { isoDayNumber, stockholmTodayISO } from '@/lib/domains/planning/timezone';
import {
  monthsInRange,
  partitionOrders,
  sumInvoices,
  type ReportData,
  type ReportOrderRow,
  type ReportRange,
} from './reports';
import type { PeriodTotals } from './reportGoals';
import { customerTypeOf, median, monthSpan, monthTouches } from './reportKpis';

// Omsättningsflikens nyckeltal (spec 2026-10-07, 4.4): "Vad kommer in, vad ligger kvar?"
//
// Ren modul — inga anrop, ingen klocka. Rutten skickar in raderna den redan läst (periodens order och
// fakturor, trendens fönster, orderstocken) och en räkning av varje kunds order sedan start.
//
// Samma regler som resten av rapporten: kronor netto (netAmount), avbrutna order bort
// (partitionOrders), fakturerat per faktura på fakturadagen (invoicedRevenue).

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumNet(orders: ReportOrderRow[]): number {
  return sum(orders.map((order) => netAmount(order)));
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

// ── Fakturerat per kundtyp ───────────────────────────────────────────────────

export type InvoicedByType = Record<CrmCustomerType, number> & {
  total: number;
  /** Fakturerat till privatkunder, i procent av allt fakturerat. null när inget fakturerats. */
  privateShare: number | null;
};

/** Kundtypen följer med fakturan från ordern (quote_type), också för en delfakturarunda. */
export function invoicedByCustomerType(revenue: InvoicedRevenue[]): InvoicedByType {
  const byType = (type: CrmCustomerType) => sumInvoices(revenue.filter((invoice) => customerTypeOf(invoice.quote_type) === type));
  const privateValue = byType('private');
  const total = sumInvoices(revenue);
  return { total, private: privateValue, business: byType('business'), privateShare: share(privateValue, total) };
}

/**
 * Book-to-bill: orderingång ÷ fakturerat i perioden. Över 1 växer orderstocken, under 1 krymper den.
 * null när inget fakturerats — en kvot mot noll är inget tal.
 */
export function bookToBill(orderValue: number, invoicedValue: number): number | null {
  return invoicedValue > 0 ? orderValue / invoicedValue : null;
}

// ── Från order till faktura ──────────────────────────────────────────────────

export type LeadTime = {
  /** Fakturerade order som gick att mäta. */
  count: number;
  /** Median antal dagar från att ordern skapades till att den fakturerades. null utan mätbara order. */
  median: number | null;
  mean: number | null;
};

/**
 * Svensk kalenderdag för en tidsstämpel. ⚠️ INTE `slice(0, 10)`: en order skapad kl. 00.30 svensk tid
 * står med föregående dag i UTC, och ledtiden hade då blivit en dag för lång.
 */
function swedishDay(timestamp: string): number | null {
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? null : isoDayNumber(stockholmTodayISO(at));
}

/** Dagar från created_at till fortnox_invoiced_at, i svenska kalenderdagar. null när fakturadatum saknas. */
export function orderLeadDays(order: Pick<ReportOrderRow, 'created_at' | 'fortnox_invoiced_at'>): number | null {
  if (!order.fortnox_invoiced_at) return null;
  const created = swedishDay(order.created_at);
  const invoiced = swedishDay(order.fortnox_invoiced_at);
  return created == null || invoiced == null ? null : invoiced - created;
}

/**
 * Median från order till faktura, för order SLUTFAKTURERADE i perioden (partitionOrders().invoiced).
 * En delfakturerad order mäts till sista rundan — då är den färdigfakturerad. Order utan fakturadatum
 * (från innan kolumnen fanns) går inte att mäta och räknas inte.
 *
 * Känt och avsiktligt: VILKA order som hör till perioden avgörs av rapportens vanliga dygnsregel (samma
 * som Fakturerat), medan dagarna RÄKNAS i svenska dygn som specen säger. Kring midnatt en månadsskiftesnatt
 * kan en order alltså höra till en månad och mätas mot nästa dags datum — en dag hit eller dit i en median.
 */
export function buildLeadTime(ordersInvoiced: ReportOrderRow[]): LeadTime {
  const days = ordersInvoiced.map(orderLeadDays).filter((value): value is number => value != null);
  return {
    count: days.length,
    median: median(days),
    mean: days.length > 0 ? sum(days) / days.length : null,
  };
}

// ── ROT ──────────────────────────────────────────────────────────────────────

export type RotShare = {
  /** Privatorder skapade i perioden. */
  privateOrders: number;
  /** Varav med ROT ikryssat. */
  withRot: number;
  /** Andelen, i procent. null utan privatorder. */
  share: number | null;
  /** Ordervärdet på ROT-ordrarna, netto. */
  value: number;
};

/** Privatorder med ROT ikryssat ÷ alla privatorder skapade i perioden. Bara `true` räknas som ikryssat. */
export function buildRotShare(ordersCreated: ReportOrderRow[]): RotShare {
  const privateOrders = ordersCreated.filter((order) => customerTypeOf(order.quote_type) === 'private');
  const withRot = privateOrders.filter((order) => order.rot_enabled === true);
  return {
    privateOrders: privateOrders.length,
    withRot: withRot.length,
    share: share(withRot.length, privateOrders.length),
    value: sumNet(withRot),
  };
}

// ── Fakturerat per månad, företag och privat ─────────────────────────────────

export type InvoicedMonth = Record<CrmCustomerType, number> & {
  /** 'YYYY-MM' — fakturamånaden. */
  period: string;
  /** Dagarna som räknas när månaden inte är hel. null = hel månad. */
  partial: ReportRange | null;
  inPeriod: boolean;
};

/**
 * Fakturerat per månad, staplat på företag och privat, i trendens fönster.
 *
 * ⚠️ FÖLJER INTE PERIODEN (Williams beslut 2026-10-07, samma som trenden och hit rate per månad).
 * Totalen per månad är densamma som trendens fakturerat: samma partitionering, samma fönster.
 */
export function buildInvoicedByMonth(input: {
  data: Pick<ReportData, 'orders' | 'invoiceRounds'>;
  window: ReportRange;
  selected: ReportRange;
}): InvoicedMonth[] {
  const revenue = partitionOrders(input.data.orders, input.window, input.data.invoiceRounds).revenue;
  return monthsInRange(input.window.from, input.window.to).map((period) => {
    const inMonth = revenue.filter((invoice) => String(invoice.at).slice(0, 7) === period);
    const split = invoicedByCustomerType(inMonth);
    return {
      period,
      business: split.business,
      private: split.private,
      partial: monthSpan(period, input.window).partial,
      inPeriod: monthTouches(period, input.selected),
    };
  });
}

// ── Orderstock efter läge (nu) ───────────────────────────────────────────────

export type StockStageKey = 'draft' | 'scheduled' | 'in_progress' | 'partially_invoiced' | 'completed';

/**
 * Orderstockens lägen i arbetsflödets ordning. Planerad tar orderlistans grupp (BOARD_FILTER_STATUSES),
 * så den avvecklade statusen `ready` — som visas som "Planerad" — hamnar där den visas.
 */
export const STOCK_STAGES: Array<{ key: StockStageKey; statuses: CrmWorkOrderStatus[] }> = [
  { key: 'draft', statuses: ['draft'] },
  { key: 'scheduled', statuses: BOARD_FILTER_STATUSES.scheduled ?? ['scheduled'] },
  { key: 'in_progress', statuses: ['in_progress'] },
  { key: 'partially_invoiced', statuses: ['partially_invoiced'] },
  { key: 'completed', statuses: ['completed'] },
];

export type StockStage = { key: StockStageKey; count: number; value: number };

/**
 * Orderstocken per läge — det som återstår att fakturera (uninvoicedAmount), så en delfakturerad order
 * bär bara sin rest. Lägena täcker exakt ORDER_STOCK_STATUSES, så summan är Översiktens orderstock.
 */
export function buildStockByStage(rows: OrderStockRow[]): StockStage[] {
  const stock = rows.filter((row) => ORDER_STOCK_STATUSES.includes(row.status as CrmWorkOrderStatus));
  return STOCK_STAGES.map((stage) => {
    const inStage = stock.filter((row) => stage.statuses.includes(row.status as CrmWorkOrderStatus));
    return { key: stage.key, count: inStage.length, value: sumUninvoiced(inStage) };
  });
}

// ── Kundsegment ──────────────────────────────────────────────────────────────

export type CustomerSegment =
  | 'private'
  | 'construction'
  | 'real_estate'
  | 'builders_merchant'
  | 'house_manufacturer'
  | 'other'
  | 'unknown';

/**
 * Företagens segment ur kundkortets SNI-kod, på kodens SIFFROR — punkter och mellanslag spelar ingen
 * roll, så "41.200" och "41200" är samma kod. Först matchande rad vinner, så det längre prefixet står
 * före det kortare om de skulle överlappa.
 *
 * Avstämd mot prod 2026-10-07 (Williams läsfråga): koderna är fem siffror utan punkt, med SNI 2007:s namn
 * — 41200, 43320, 46731 "Partihandel med virke och andra byggmaterial", 68201, 16231. 38 företagskunder
 * med order saknar kod.
 *
 * ⚠️ HUSTILLVERKARE ÄR 16.231, INTE 16.23. Specen sa 16.23, med uppmaningen att kontrollera det: i SNI 2007
 * är 16.23 alla byggnadssnickerier — dörrar (16.232), fönster (16.233) och övriga (16.239) också. Bara
 * 16.231 är "Tillverkning av monteringsfärdiga trähus".
 *
 * ⚠️ tic.io-mappningen sparar SNI 2025 FÖRST (lib/domains/tic/mappers.ts). Dagens data är 2007-koder, men
 * en kund som slås upp när tic.io börjar leverera 2025-koder kan få en kod som har flyttat (byggmaterial-
 * partihandeln ligger på en annan kod i 2025) och hamnar då under Övriga branscher. Växer "Övriga" med
 * okända koder: stäm av tabellen igen.
 */
export const SNI_SEGMENTS: Array<{ segment: Exclude<CustomerSegment, 'private' | 'other' | 'unknown'>; prefixes: string[] }> = [
  { segment: 'construction', prefixes: ['41', '43'] },
  { segment: 'real_estate', prefixes: ['68'] },
  { segment: 'builders_merchant', prefixes: ['4673'] },
  { segment: 'house_manufacturer', prefixes: ['16231'] },
];

/** SNI-kodens siffror, eller null när koden saknas eller inte har några. */
export function sniDigits(code: string | null | undefined): string | null {
  const digits = String(code ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function customerSniCode(order: Pick<ReportOrderRow, 'customer'>): string | null {
  const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
  return customer?.sni_code ?? null;
}

/**
 * Orderns segment. Privat = quote_type 'private', oavsett kundkortet. Ett företag utan kundkort eller
 * utan SNI-kod är "Bransch okänd"; en kod som inte finns i tabellen är "Övriga branscher".
 */
export function customerSegmentOf(order: Pick<ReportOrderRow, 'quote_type' | 'customer'>): CustomerSegment {
  if (customerTypeOf(order.quote_type) === 'private') return 'private';
  const digits = sniDigits(customerSniCode(order));
  if (!digits) return 'unknown';
  return SNI_SEGMENTS.find((row) => row.prefixes.some((prefix) => digits.startsWith(prefix)))?.segment ?? 'other';
}

/** Segmenten i den ordning de visas: privat först, sedan företagens, okänd sist. */
export const SEGMENT_ORDER: CustomerSegment[] = [
  'private',
  'construction',
  'real_estate',
  'builders_merchant',
  'house_manufacturer',
  'other',
  'unknown',
];

export type SegmentRow = { segment: CustomerSegment; orderValue: number; orders: number; customers: number };

// ── Kunder ───────────────────────────────────────────────────────────────────

/**
 * Kunden bakom en order: kundkortet, och kundnamnet när ordern saknar kundkort (spec 2026-10-07).
 *
 * ⚠️ null FÖR EN ORDER UTAN BÅDA — då vet vi inte vem kunden är. Den räknas som en egen kund och aldrig
 * som återkommande: slogs de ihop till en "okänd kund" hade tre främlingars order sett ut som en
 * återkommande storkund, både i antalet och i topp 5.
 */
export function customerKey(order: { customer_id: string | null; client_name: string | null }): string | null {
  if (order.customer_id) return `id:${order.customer_id}`;
  const name = (order.client_name ?? '').trim();
  return name ? `namn:${name}` : null;
}

/** Nyckeln per order i en lista, där en order utan känd kund blir en egen kund. */
function keysPerOrder(orders: ReportOrderRow[]): string[] {
  return orders.map((order, index) => customerKey(order) ?? `ordern:${index}`);
}

/** Ordervärde per segment, för order skapade i perioden. Alla segment står med, även tomma. */
export function buildSegments(ordersCreated: ReportOrderRow[]): SegmentRow[] {
  return SEGMENT_ORDER.map((segment) => {
    const orders = ordersCreated.filter((order) => customerSegmentOf(order) === segment);
    return {
      segment,
      orderValue: sumNet(orders),
      orders: orders.length,
      customers: new Set(keysPerOrder(orders)).size,
    };
  });
}

export type CustomerConcentration = {
  /** Kunder med minst en order skapad i perioden. */
  customers: number;
  /**
   * Varav återkommande: kunden har minst två order från start till periodens slut (Williams beslut
   * 2026-10-07: räknat bland periodens kunder). ⚠️ null = KUNDE INTE RÄKNAS — räkningen gick inte att läsa.
   */
  recurring: number | null;
  /** De 5 och de 10 största kundernas andel av periodens ordervärde, i procent. null utan ordervärde. */
  top5Share: number | null;
  top10Share: number | null;
};

export type CustomerOrderRow = { status: string | null; created_at: string; customer_id: string | null; client_name: string | null };

/**
 * Hur många order varje kund har från start TILL OCH MED periodens sista dag. Avbrutna order räknas inte
 * — filtreras här, inte bara i läsningen, så att funktionen ger samma svar vilken läsning som än matar den.
 *
 * ⚠️ TILL PERIODENS SLUT, inte till idag: en kund vars andra order kom i september var inte återkommande i
 * januari, och januaris rapport ska inte ändras för att kunden beställde igen långt senare. Dygnet jämförs
 * som i resten av rapporten (`created_at`s datumdel). Order utan känd kund räknas inte alls.
 */
export function countOrdersPerCustomer(rows: CustomerOrderRow[], through: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (isDeadWorkOrder(row.status)) continue;
    if (String(row.created_at).slice(0, 10) > through) continue;
    const key = customerKey(row);
    if (key == null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildCustomerConcentration(
  ordersCreated: ReportOrderRow[],
  /** Order per kund sedan start. null = läsningen felade. */
  ordersSinceStart: Map<string, number> | null,
): CustomerConcentration {
  const valueByCustomer = new Map<string, number>();
  const keys = keysPerOrder(ordersCreated);
  ordersCreated.forEach((order, index) => {
    valueByCustomer.set(keys[index], (valueByCustomer.get(keys[index]) ?? 0) + netAmount(order));
  });
  const values = [...valueByCustomer.values()].sort((a, b) => b - a);
  const total = sum(values);
  const customers = [...valueByCustomer.keys()];
  return {
    customers: customers.length,
    // En kund utan känd identitet (`ordern:…`) finns inte i räkningen och blir aldrig återkommande. En
    // känd kund har minst sin order i perioden; saknas den i räkningen (skapad efter läsningen) är 1 golvet.
    recurring: ordersSinceStart ? customers.filter((key) => (ordersSinceStart.get(key) ?? 1) >= 2).length : null,
    top5Share: share(sum(values.slice(0, 5)), total),
    top10Share: share(sum(values.slice(0, 10)), total),
  };
}

// ── Omsättningsfliken ────────────────────────────────────────────────────────

export type ReportRevenue = {
  invoiced: InvoicedByType;
  /** Orderingång ÷ fakturerat. null när inget fakturerats. */
  bookToBill: number | null;
  /** Samma kvot för föregående lika långa period. null när den inte gick att räkna eller hämta. */
  bookToBillPrevious: number | null;
  leadTime: LeadTime;
  rot: RotShare;
  /** Trendens fönster. ⚠️ null = KUNDE INTE RÄKNAS (trendens läsning felade). */
  invoicedByMonth: InvoicedMonth[] | null;
  /** Orderstocken per läge, just nu. ⚠️ null = KUNDE INTE RÄKNAS, aldrig "ingen stock". */
  stockByStage: StockStage[] | null;
  segments: SegmentRow[];
  customers: CustomerConcentration;
};

export function buildReportRevenue(input: {
  /** Periodens rader, partitionerade — partitionOrders(data.orders, range, data.invoiceRounds). */
  period: { created: ReportOrderRow[]; invoiced: ReportOrderRow[]; revenue: InvoicedRevenue[] };
  range: ReportRange;
  /** Trendens rader och fönster. null = trendens läsning felade. */
  trend: { data: Pick<ReportData, 'orders' | 'invoiceRounds'>; window: ReportRange } | null;
  /** Orderstockens rader. null = läsningen felade. */
  orderStockRows: OrderStockRow[] | null;
  /** Order per kund sedan start. null = läsningen felade. */
  ordersSinceStart: Map<string, number> | null;
  /**
   * Periodens och föregående periods huvudtal (buildPeriodTotals) — book-to-bill räknas på dem, så att
   * de två kvoterna mäts med samma funktion. `previous` null = den gick inte att hämta.
   */
  totals: Pick<PeriodTotals, 'orderValue' | 'invoicedValue'>;
  previousTotals?: Pick<PeriodTotals, 'orderValue' | 'invoicedValue'> | null;
}): ReportRevenue {
  return {
    invoiced: invoicedByCustomerType(input.period.revenue),
    bookToBill: bookToBill(input.totals.orderValue, input.totals.invoicedValue),
    bookToBillPrevious: input.previousTotals ? bookToBill(input.previousTotals.orderValue, input.previousTotals.invoicedValue) : null,
    leadTime: buildLeadTime(input.period.invoiced),
    rot: buildRotShare(input.period.created),
    invoicedByMonth: input.trend
      ? buildInvoicedByMonth({ data: input.trend.data, window: input.trend.window, selected: input.range })
      : null,
    stockByStage: input.orderStockRows ? buildStockByStage(input.orderStockRows) : null,
    segments: buildSegments(input.period.created),
    customers: buildCustomerConcentration(input.period.created, input.ordersSinceStart),
  };
}
