import { netAmount } from './pricing';
import { buildHitRate } from './hitRate';
import { hitRateMaturity, buildOrderStock } from './reportKpis';
import { buildStockByStage, type StockStage } from './reportRevenue';
import {
  monthsInRange,
  partitionOrders,
  sumInvoices,
  type ReportData,
  type ReportQuoteRow,
  type ReportRange,
} from './reports';
import type { OrderStockRow } from './overviewSummary';
import { isoWeeksTouching } from '@/lib/domains/planning/workOrderCrew';
import { isoWeek } from '@/lib/domains/planning/insights';

// Ägarnas veckorapport: rapporteringens siffror per säljare och vecka, året hittills, med budget mot
// utfall per månad och orderstocken just nu. Ren modell — arbetsboken (reportOwnerWorkbook.ts) ritar den.
//
// Ersätter den Excel-fil som fylldes i för hand och skickades till ägarna varje vecka. Besluten
// (William 2026-10-09): året hittills per ISO-vecka, appens hit rate-regel, orderstocken bara som läget
// nu (ingen historik finns), budget mot utfall per månad ur säljarnas mål.
//
// ⚠️ SAMMA SIFFROR SOM RAPPORTSIDAN. Varje tal räknas med rapportens egna byggstenar — partitionOrders
// (avbrutna bort, fakturerat per faktura och runda), netAmount (exklusive moms) och buildHitRate — så
// veckorna summerar till rapportens tal för samma period. Ingen egen beloppsläsning här.

/** Måtten per säljare och period. Belopp netto, exklusive moms. */
export type OwnerMetrics = {
  quotes: number;
  quoteValue: number;
  /** Vunna av periodens offerter (status Vunnen, som systemet sätter när ordern skapas). */
  won: number;
  wonValue: number;
  /** Order SKAPADE i perioden, utan avbrutna. */
  orders: number;
  orderValue: number;
  /** Fakturor (hela order eller delfakturarundor) daterade i perioden. */
  invoicedValue: number;
};

export type OwnerWeek = ReportRange & {
  /** ISO-veckans nummer, "v. 41". */
  week: number;
  /** Veckan pågår: den slutar idag, inte på en söndag. */
  current: boolean;
  /** Veckans hit rate är preliminär — offerterna har inte hunnit bli 30 dagar gamla. */
  preliminary: boolean;
};

export type OwnerMonth = ReportRange & {
  /** ÅÅÅÅ-MM */
  period: string;
  /** Månaden pågår: den slutar idag. Budgeten gäller ändå hela månaden — mål prorateras aldrig. */
  current: boolean;
};

/** En månads budget. null = ingen budget satt (0 i målet betyder "inget mål", aldrig "noll kronor"). */
export type OwnerBudget = { quoteValue: number | null; orderValue: number | null; invoicedValue: number | null };

export type OwnerSeller = {
  /** null = offerter och order utan ansvarig säljare. */
  userId: string | null;
  name: string;
  /** Per vecka, i samma ordning som `weeks`. */
  weeks: OwnerMetrics[];
  /** Per månad, i samma ordning som `months`. */
  months: OwnerMetrics[];
  /** Hela perioden. */
  total: OwnerMetrics;
  /** Per månad. null = budgeten kunde inte läsas. */
  budget: OwnerBudget[] | null;
};

export type OwnerOrderStock = {
  stages: StockStage[];
  value: number;
  count: number;
  /** Räcker så många veckor i senaste hela månadens faktureringstakt. null = går inte att räkna. */
  weeks: number | null;
  /** Månaden takten mäts mot. */
  basis: ReportRange | null;
};

export type OwnerReport = {
  year: number;
  range: ReportRange;
  today: string;
  weeks: OwnerWeek[];
  months: OwnerMonth[];
  /** Säljarna i namnordning; "Utan säljare" sist, och bara när något saknar säljare. */
  sellers: OwnerSeller[];
  /** Hela företaget — även det som saknar säljare. */
  totals: { weeks: OwnerMetrics[]; months: OwnerMetrics[]; total: OwnerMetrics };
  /** Hela periodens hit rate är preliminär (den senaste månadens offerter har inte hunnit avgöras). */
  totalPreliminary: boolean;
  /** Budgeten kunde inte läsas — budgetfliken säger det i stället för att visa tomma mål. */
  budgetUnavailable: boolean;
  /** Läget när filen skapades. null = kunde inte läsas. */
  orderStock: OwnerOrderStock | null;
};

/** En målrad som exporten läser den: per säljare och månad. Numeric kommer som sträng från PostgREST. */
export type OwnerGoalRow = {
  user_id: string;
  period_start: string;
  quote_value_target: number | string | null;
  order_value_target: number | string | null;
  invoiced_value_target?: number | string | null;
};

export const UNASSIGNED_NAME = 'Utan säljare';
const UNKNOWN_NAME = 'Okänd användare';

const emptyMetrics = (): OwnerMetrics => ({ quotes: 0, quoteValue: 0, won: 0, wonValue: 0, orders: 0, orderValue: 0, invoicedValue: 0 });

function hasActivity(m: OwnerMetrics): boolean {
  return m.quotes > 0 || m.orders > 0 || m.invoicedValue !== 0;
}

const quoteInRange = (quote: ReportQuoteRow, range: ReportRange) =>
  quote.quote_date != null && quote.quote_date.slice(0, 10) >= range.from && quote.quote_date.slice(0, 10) <= range.to;

/**
 * Periodens mått per säljare (nyckel = säljarens id, null = utan säljare), plus hela företaget.
 *
 * Samma population som rapportens huvudtal (buildPeriodTotals): offerter på offertdatum, order på
 * skapandedag utan avbrutna, fakturerat per faktura. Hit rate med rapportens buildHitRate.
 */
export function metricsBySeller(data: Pick<ReportData, 'quotes' | 'orders' | 'invoiceRounds'>, range: ReportRange): {
  bySeller: Map<string | null, OwnerMetrics>;
  total: OwnerMetrics;
} {
  const bySeller = new Map<string | null, OwnerMetrics>();
  const ensure = (id: string | null) => {
    let row = bySeller.get(id);
    if (!row) bySeller.set(id, (row = emptyMetrics()));
    return row;
  };
  const orders = partitionOrders(data.orders, range, data.invoiceRounds);
  const quotes = data.quotes.filter((quote) => quoteInRange(quote, range));

  const quotesBySeller = new Map<string | null, ReportQuoteRow[]>();
  for (const quote of quotes) {
    const key = quote.assigned_to || null;
    const list = quotesBySeller.get(key);
    if (list) list.push(quote);
    else quotesBySeller.set(key, [quote]);
  }
  for (const [key, list] of quotesBySeller) {
    const rate = buildHitRate(list);
    Object.assign(ensure(key), { quotes: rate.quotes, quoteValue: rate.quoteValue, won: rate.won, wonValue: rate.wonValue });
  }
  for (const order of orders.created) {
    const row = ensure(order.assigned_to || null);
    row.orders += 1;
    row.orderValue += netAmount(order);
  }
  for (const invoice of orders.revenue) {
    ensure(invoice.assigned_to || null).invoicedValue += invoice.amount;
  }

  const rate = buildHitRate(quotes);
  const total: OwnerMetrics = {
    quotes: rate.quotes,
    quoteValue: rate.quoteValue,
    won: rate.won,
    wonValue: rate.wonValue,
    orders: orders.created.length,
    orderValue: orders.created.reduce((sum, order) => sum + netAmount(order), 0),
    invoicedValue: sumInvoices(orders.revenue),
  };
  return { bySeller, total };
}

/**
 * ISO-veckorna (måndag–söndag) i intervallet, klippta mot det: årets första vecka börjar den 1 januari
 * även när måndagen ligger i december, och den pågående veckan slutar idag.
 */
export function ownerWeeks(range: ReportRange, today: string): OwnerWeek[] {
  return isoWeeksTouching(range.from, range.to).map((week) => {
    const clipped = { from: week.from < range.from ? range.from : week.from, to: week.to > range.to ? range.to : week.to };
    return {
      ...clipped,
      week: isoWeek(week.from),
      current: clipped.to === today && week.to > today,
      preliminary: hitRateMaturity(clipped, today).preliminary,
    };
  });
}

/** Kalendermånaderna i intervallet, klippta mot det. */
export function ownerMonths(range: ReportRange, today: string): OwnerMonth[] {
  return monthsInRange(range.from, range.to).map((period) => {
    const [year, month] = period.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const from = `${period}-01` < range.from ? range.from : `${period}-01`;
    const to = last > range.to ? range.to : last;
    return { period, from, to, current: to === today && last > today };
  });
}

/** Ett mål i kronor, eller null när inget mål är satt. 0 är "inget mål" — samma regel som rapporten. */
function target(value: number | string | null | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Varje säljare som exporten behöver ett namn på: de som har offerter, order eller fakturor i perioden och
 * de som har mål. Rapportens egen säljarläsning tar bara de nuvarande säljrollerna — här ska också den som
 * slutat eller bytt roll stå med sitt namn, inte som "Okänd användare".
 */
export function sellerIdsOf(data: Pick<ReportData, 'quotes' | 'orders' | 'invoiceRounds'>, goals: OwnerGoalRow[] | null): string[] {
  const ids = new Set<string>();
  for (const quote of data.quotes) if (quote.assigned_to) ids.add(quote.assigned_to);
  for (const order of data.orders) if (order.assigned_to) ids.add(order.assigned_to);
  for (const round of data.invoiceRounds) {
    const order = Array.isArray(round.work_order) ? round.work_order[0] : round.work_order;
    if (order?.assigned_to) ids.add(order.assigned_to);
  }
  for (const goal of goals ?? []) if (goal.user_id) ids.add(goal.user_id);
  return [...ids].sort();
}

/** Målradens budget, eller null när raden inte sätter någon (bara nollor). */
function goalBudget(goal: OwnerGoalRow): OwnerBudget | null {
  const budget = { quoteValue: target(goal.quote_value_target), orderValue: target(goal.order_value_target), invoicedValue: target(goal.invoiced_value_target) };
  return budget.quoteValue == null && budget.orderValue == null && budget.invoicedValue == null ? null : budget;
}

export function buildOwnerReport(input: {
  data: Pick<ReportData, 'quotes' | 'orders' | 'invoiceRounds' | 'sellers'>;
  range: ReportRange;
  today: string;
  /** null = målen kunde inte läsas. */
  goals: OwnerGoalRow[] | null;
  /** null = orderstocken kunde inte läsas. */
  orderStockRows: OrderStockRow[] | null;
  /** Senaste hela månadens fakturering, för orderstockens veckotal. null = kunde inte läsas. */
  basis: { range: ReportRange; invoiced: number } | null;
}): OwnerReport {
  const { data, range, today } = input;
  const allWeeks = ownerWeeks(range, today);
  const weekMetrics = allWeeks.map((week) => metricsBySeller(data, week));

  // Veckor före den första aktiviteten utelämnas: CRM:et startade mitt i året (v. 27 2026), och 26
  // tomma kolumner hade bara skjutit siffrorna utanför skärmen. Den pågående veckan står alltid kvar.
  // Aktivitet hos NÅGON säljare räcker — en kreditering som tar ut en annan säljares faktura samma vecka
  // gör helheten 0, men säljarnas celler är det inte, och deras årssumma räknar med veckan.
  let first = weekMetrics.findIndex((week) => [...week.bySeller.values()].some(hasActivity));
  if (first < 0) first = allWeeks.length - 1;
  const weeks = allWeeks.slice(first);
  const perWeek = weekMetrics.slice(first);
  const shown: ReportRange = { from: weeks[0]?.from ?? range.from, to: range.to };

  // Budgetfliken börjar vid den första månaden med aktivitet ELLER budget: en budget satt före den första
  // ordern hade annars försvunnit utan ett ord.
  const firstBudgetDay = (input.goals ?? [])
    .filter((goal) => goalBudget(goal) != null)
    .map((goal) => String(goal.period_start).slice(0, 10))
    // Bara mål vars MÅNAD ligger i perioden; en månad som börjar före periodens första dag klipps till den.
    .filter((day) => day.slice(0, 7) >= range.from.slice(0, 7) && day <= range.to)
    .map((day) => (day < range.from ? range.from : day))
    .sort()[0];
  const months = ownerMonths({ from: firstBudgetDay && firstBudgetDay < shown.from ? firstBudgetDay : shown.from, to: range.to }, today);
  const perMonth = months.map((month) => metricsBySeller(data, month));
  const whole = metricsBySeller(data, range);

  // Målen per säljare och månad. Budgeten lever på hela månader, så en säljare med mål men utan
  // aktivitet står också med — en tom rad med budget är ett besked i sig.
  const monthIndex = new Map(months.map((month, index) => [month.period, index]));
  const budgets = new Map<string, OwnerBudget[]>();
  for (const goal of input.goals ?? []) {
    const index = monthIndex.get(String(goal.period_start).slice(0, 7));
    if (index == null) continue;
    const budget = goalBudget(goal);
    if (!budget) continue;
    let list = budgets.get(goal.user_id);
    if (!list) budgets.set(goal.user_id, (list = months.map(() => ({ quoteValue: null, orderValue: null, invoicedValue: null }))));
    list[index] = budget;
  }

  const names = new Map(data.sellers.map((seller) => [seller.id, seller.full_name?.trim() || UNKNOWN_NAME]));
  const ids = new Set<string | null>([...whole.bySeller.keys(), ...budgets.keys()]);
  const noBudget = () => months.map((): OwnerBudget => ({ quoteValue: null, orderValue: null, invoicedValue: null }));

  const sellers: OwnerSeller[] = [...ids]
    .map((id) => ({
      userId: id,
      name: id == null ? UNASSIGNED_NAME : names.get(id) ?? UNKNOWN_NAME,
      weeks: perWeek.map((week) => week.bySeller.get(id) ?? emptyMetrics()),
      months: perMonth.map((month) => month.bySeller.get(id) ?? emptyMetrics()),
      total: whole.bySeller.get(id) ?? emptyMetrics(),
      // "Utan säljare" kan inte ha mål — målen sätts per person.
      budget: input.goals == null ? null : id == null ? noBudget() : budgets.get(id) ?? noBudget(),
    }))
    .sort((a, b) => Number(a.userId == null) - Number(b.userId == null) || a.name.localeCompare(b.name, 'sv'));

  let orderStock: OwnerOrderStock | null = null;
  if (input.orderStockRows) {
    const stock = buildOrderStock(input.orderStockRows, input.basis);
    orderStock = {
      stages: buildStockByStage(input.orderStockRows),
      value: stock.value,
      count: stock.count,
      weeks: stock.weeks,
      basis: input.basis?.range ?? null,
    };
  }

  return {
    year: Number(range.from.slice(0, 4)),
    range,
    today,
    weeks,
    months,
    sellers,
    totals: { weeks: perWeek.map((week) => week.total), months: perMonth.map((month) => month.total), total: whole.total },
    totalPreliminary: hitRateMaturity(range, today).preliminary,
    budgetUnavailable: input.goals == null,
    orderStock,
  };
}
