import type { SupabaseClient } from '@supabase/supabase-js';
import { netAmount, type NetAmountRow } from './pricing';
import { isDeadWorkOrder } from './work-orders';
import { invoicedAt, invoicedRevenue, type InvoicedRevenue, type InvoiceRoundRow } from './invoicedRevenue';
import { buildHitRate, suggestsLateEntry } from './hitRate';
import {
  buildPeriodSummary,
  type PeriodSummary,
  type PeriodTotals,
  type ReportGoalRow,
} from './reportGoals';
import { unavailableProduction, type Production } from '@/lib/domains/planning/production';
import { unavailablePlanned, type PlannedPeriod } from '@/lib/domains/planning/plannedPeriod';
import { unavailableTimeReport, type TimeReport } from '@/lib/domains/time/report';
import { readAllPages, type ReadError } from '@/lib/domains/planning/pagedRead';
import { addDaysISO, stockholmDayOf, stockholmDayStartISO } from '@/lib/domains/planning/timezone';
import type { ReportOverview, ReportSales, SalesTrend } from './reportKpis';
import type { ReportRevenue } from './reportRevenue';
import type { ReportProduct } from './reportProduct';

// Sales reporting domain. The pure aggregation helpers (build*) take plain rows and
// return report-ready shapes so they can be unit-tested in isolation; fetchReportData
// is the only side-effecting part. Reporting is a team-wide aggregated read model, so
// the route runs it with the admin client (profiles RLS only allows self-reads with a
// session client — same reason the goals route uses the admin client).

export type ReportRange = { from: string; to: string }; // YYYY-MM-DD, inclusive

export type ReportQuoteRow = NetAmountRow & {
  status: string | null;
  quote_date: string | null;
  assigned_to: string | null;
  customer_name: string | null;
  /**
   * 'private' eller 'business' (NOT NULL i schemat) — hit rate per kundtyp. Obligatorisk med flit:
   * utan den i läsningen hade varje offert räknats som företag, utan att något felade.
   */
  quote_type: string;
};

export type ReportOrderRow = NetAmountRow & {
  /** Behövs för att kunna slå upp orderns efterkalkyl — se buildProfitability. */
  id?: string;
  status: string | null;
  created_at: string;
  fortnox_invoiced_at: string | null;
  /** Satt = ordern faktureras i rundor, som räknas i stället för ordern — se invoicedRevenue. */
  partial_invoicing_started_at: string | null;
  assigned_to: string | null;
  client_name: string | null;
  /** 'private' eller 'business' (NOT NULL i schemat) — typisk order per kundtyp. Obligatorisk av samma skäl som på offerten. */
  quote_type: string;
  /** Kunden — "Kunder" under Omsättning. null: ordern saknar kundkort, och kunden känns då igen på client_name. */
  customer_id: string | null;
  /** `rot_details->enabled` — ROT-andelen. JSON, så `true` och inget annat räknas som ikryssat. */
  rot_enabled: unknown;
  /** Kundkortets SNI-kod, för kundsegmentet. Som lista när klienten inte vet att relationen är många-till-en. */
  customer: ReportOrderCustomer | ReportOrderCustomer[] | null;
};

export type ReportOrderCustomer = { sni_code: string | null };

/**
 * En delfakturarunda som rapporten läser den: orderns kundtyp obligatorisk i inbäddningen. Utan den
 * hade varje runda räknats som fakturerat till ett företag — andelen privat hade blivit för låg utan
 * att något felade.
 */
type ReportRoundOrder = { status: string | null; assigned_to: string | null; client_name: string | null; quote_type: string };
export type ReportInvoiceRoundRow = Omit<InvoiceRoundRow, 'work_order' | 'work_order_id'> & {
  work_order: ReportRoundOrder | ReportRoundOrder[] | null;
  /**
   * Ordern rundan hör till — fakturerat per depå slår upp orderns schema på den. Obligatorisk av samma
   * skäl som kundtypen: utan den i läsningen hade varje runda hamnat under "Ej planerad", utan att något felade.
   */
  work_order_id: string | null;
};

export type ReportCallRow = { user_id: string | null; call_at: string };
export type ReportSellerRow = { id: string; full_name: string | null };

export type ReportData = {
  quotes: ReportQuoteRow[];
  orders: ReportOrderRow[];
  /** Delfakturarundor skapade inom perioden, oavsett när ordern skapades eller slutfakturerades. */
  invoiceRounds: ReportInvoiceRoundRow[];
  calls: ReportCallRow[];
  sellers: ReportSellerRow[];
};

// ── Helpers ──
// Ingen rå beloppsläsare här med flit: varje krontal i rapporten går genom netAmount, och en
// lokal num() hade varit en öppen dörr tillbaka till bruttot.
/** Månaden för en `date`-kolumn (quote_date) — redan en svensk dag, läses som den är. */
function monthKey(date: string | null | undefined): string | null {
  if (!date) return null;
  const key = String(date).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

/** Månaden för en TIDSSTÄMPEL (created_at, fakturans ögonblick) — den svenska dagens månad, aldrig UTC-dygnets. */
function instantMonthKey(timestamp: string | null | undefined): string | null {
  return stockholmDayOf(timestamp)?.slice(0, 7) ?? null;
}

/**
 * Periodens gränser som ÖGONBLICK, för filter mot timestamptz-kolumner: från svensk midnatt första dagen
 * till svensk midnatt dagen efter sista (exklusivt). En bar dag i filtret hade betytt UTC-midnatt.
 */
function instantBounds(range: ReportRange): { from: string; toExclusive: string } {
  return { from: stockholmDayStartISO(range.from), toExclusive: stockholmDayStartISO(addDaysISO(range.to, 1)) };
}

// Inclusive list of YYYY-MM between from and to (capped to avoid runaway ranges).
export function monthsInRange(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const out: string[] = [];
  let year = fy;
  let month = fm;
  for (let i = 0; i < 240 && (year < ty || (year === ty && month <= tm)); i++) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return out;
}

// ── Order partitioning ──
//
// An order billed in August was usually created weeks or months earlier — median lag is a
// month. Fetching orders on created_at alone therefore dropped that revenue from the
// period it was actually billed in: for August 2026 it hid 371 323 kr of 450 101 kr, so
// the report showed 18 % of what had really been invoiced. The fetch now pulls a superset
// (created in range OR invoiced in range) and the rows are split here, so every figure is
// keyed to the date that belongs to it: order value to when the order was won, invoiced
// revenue to when it was billed — per invoice, so a delfakturerad order's rounds each land on
// their own date (see invoicedRevenue).

export { invoicedAt };

/**
 * Inclusive day comparison against the range, matching how the fetch filters. The day is the SWEDISH day
 * the timestamp falls on (stockholmDayOf) — the UTC date put an order created 00:30 Swedish time on the
 * 1st into the previous month.
 */
function withinRange(timestamp: string | null | undefined, range: ReportRange): boolean {
  const day = stockholmDayOf(timestamp);
  return day != null && day >= range.from && day <= range.to;
}

export type PartitionedOrders = {
  /** Orders created inside the range, minus the cancelled ones — the basis for order value and the typical order. */
  created: ReportOrderRow[];
  /**
   * Orders whose invoicing was COMPLETED inside the range, whenever they were created — the job
   * population for profitability. Not the revenue: a delfakturerad order joins this list with its
   * final round, while its money is spread over the rounds in `revenue`.
   */
  invoiced: ReportOrderRow[];
  /** Every invoice billed inside the range, in one go or per round — the basis for invoiced revenue. */
  revenue: InvoicedRevenue[];
};

export function partitionOrders(
  orders: ReportOrderRow[],
  range: ReportRange,
  invoiceRounds: InvoiceRoundRow[],
): PartitionedOrders {
  return {
    // Avbrutna order faller bort här och inte i varje aggregat: en order som aldrig blev av är
    // ingen omsättning, och då ska den inte synas som ordervärde, som ett antal order eller i den
    // typiska ordern. Ett enda ställe att hålla rätt på i stället för fyra.
    created: orders.filter((o) => !isDeadWorkOrder(o.status) && withinRange(o.created_at, range)),
    // Ingen motsvarande vakt behövs här: status kan inte vara både 'invoiced' och 'cancelled'.
    // En order som fakturerats och SEDAN avbrutits faller alltså ur fakturerat helt — rätt så
    // länge en avbeställning krediteras, och det finns ingen sådan rad i drift (mätt 2026-08-21).
    invoiced: orders.filter((o) => o.status === 'invoiced' && withinRange(invoicedAt(o), range)),
    revenue: invoicedRevenue(orders, invoiceRounds, invoicedAt).filter((invoice) => withinRange(invoice.at, range)),
  };
}

// ── Aggregations (pure) ──

export type SalesOverTimePoint = { period: string; quoteValue: number; orderValue: number; invoicedValue: number };

export function buildSalesOverTime(
  quotes: ReportQuoteRow[],
  ordersCreated: ReportOrderRow[],
  invoiced: InvoicedRevenue[],
  months: string[],
): SalesOverTimePoint[] {
  const quoteByMonth = new Map<string, number>();
  const orderByMonth = new Map<string, number>();
  const invoicedByMonth = new Map<string, number>();

  for (const q of quotes) {
    const key = monthKey(q.quote_date);
    if (key) quoteByMonth.set(key, (quoteByMonth.get(key) || 0) + netAmount(q));
  }
  for (const o of ordersCreated) {
    const key = instantMonthKey(o.created_at);
    if (key) orderByMonth.set(key, (orderByMonth.get(key) || 0) + netAmount(o));
  }
  // Invoiced revenue belongs to the month it was INVOICED, not when the order was created — and
  // for a delfakturerad order, to the month of each round.
  for (const invoice of invoiced) {
    const key = instantMonthKey(invoice.at);
    if (key) invoicedByMonth.set(key, (invoicedByMonth.get(key) || 0) + invoice.amount);
  }

  return months.map((period) => ({
    period,
    quoteValue: quoteByMonth.get(period) || 0,
    orderValue: orderByMonth.get(period) || 0,
    invoicedValue: invoicedByMonth.get(period) || 0,
  }));
}

export type SellerReportRow = {
  userId: string;
  userName: string;
  calls: number;
  quotes: number;
  quoteValue: number;
  /** Vunna av säljarens offerter i perioden — status Vunnen, som systemet sätter när ordern skapas. */
  won: number;
  wonValue: number;
  /**
   * Hit rate: vunna ÷ ALLA säljarens offerter i perioden, i procent — räknad med rapportens egen
   * buildHitRate. null när säljaren saknar offerter i perioden; 0 % hade påstått att inget vanns.
   */
  hitRate: number | null;
  /** Hit rate 95 % eller mer — fotnoten om att offerten troligen läggs in efter affären (suggestsLateEntry). */
  lateEntry: boolean;
  // Antal arbetsordrar SKAPADE i perioden — samma rader som orderValue summerar, så talet och
  // värdet bredvid varandra svarar på samma fråga. En order som fakturerades i perioden men
  // skapades tidigare räknas alltså inte här; den syns i invoicedValue, precis som avsett.
  orders: number;
  orderValue: number;
  invoicedValue: number;
};

export function buildPerSeller(
  quotes: ReportQuoteRow[],
  ordersCreated: ReportOrderRow[],
  invoiced: InvoicedRevenue[],
  calls: ReportCallRow[],
  sellers: ReportSellerRow[],
): SellerReportRow[] {
  const nameMap = new Map(sellers.map((s) => [s.id, s.full_name || 'Okänd användare']));
  const acc = new Map<string, SellerReportRow>();
  // Säljarens offerter, för hit rate — samma regel och samma funktion som resten av rapporten.
  const quotesBySeller = new Map<string, ReportQuoteRow[]>();
  const ensure = (id: string): SellerReportRow => {
    let row = acc.get(id);
    if (!row) {
      row = { userId: id, userName: nameMap.get(id) || 'Okänd användare', calls: 0, quotes: 0, quoteValue: 0, won: 0, wonValue: 0, hitRate: null, lateEntry: false, orders: 0, orderValue: 0, invoicedValue: 0 };
      acc.set(id, row);
    }
    return row;
  };

  for (const c of calls) {
    if (c.user_id) ensure(c.user_id).calls += 1;
  }
  for (const q of quotes) {
    if (!q.assigned_to) continue;
    const row = ensure(q.assigned_to);
    row.quotes += 1;
    row.quoteValue += netAmount(q);
    if (q.status === 'won') row.wonValue += netAmount(q);
    const list = quotesBySeller.get(q.assigned_to);
    if (list) list.push(q);
    else quotesBySeller.set(q.assigned_to, [q]);
  }
  // A seller can show invoiced revenue this period from an order won in an earlier one —
  // that is the point of the split, not a bug.
  for (const o of ordersCreated) {
    if (!o.assigned_to) continue;
    const row = ensure(o.assigned_to);
    row.orders += 1;
    row.orderValue += netAmount(o);
  }
  for (const invoice of invoiced) {
    if (!invoice.assigned_to) continue;
    ensure(invoice.assigned_to).invoicedValue += invoice.amount;
  }

  for (const row of acc.values()) {
    const rate = buildHitRate(quotesBySeller.get(row.userId) ?? []);
    row.won = rate.won;
    row.hitRate = rate.percent;
    row.lateEntry = suggestsLateEntry(row.hitRate);
  }

  return [...acc.values()].sort((a, b) => b.orderValue - a.orderValue || b.quoteValue - a.quoteValue || a.userName.localeCompare(b.userName, 'sv'));
}

export type CustomerReportRow = { customer: string; orderValue: number; invoicedValue: number; orderCount: number };

export function buildPerCustomer(
  ordersCreated: ReportOrderRow[],
  invoiced: InvoicedRevenue[],
  topN = 10,
): CustomerReportRow[] {
  const acc = new Map<string, CustomerReportRow>();
  const ensure = (clientName: string | null): CustomerReportRow => {
    const customer = (clientName || '').trim() || 'Okänd kund';
    let row = acc.get(customer);
    if (!row) {
      row = { customer, orderValue: 0, invoicedValue: 0, orderCount: 0 };
      acc.set(customer, row);
    }
    return row;
  };

  for (const o of ordersCreated) {
    const row = ensure(o.client_name);
    row.orderValue += netAmount(o);
    row.orderCount += 1;
  }
  // A customer billed this period whose order was placed in an earlier one lands here with
  // no order value of its own. Truthful: the money moved this period, the order did not.
  for (const invoice of invoiced) {
    ensure(invoice.client_name).invoicedValue += invoice.amount;
  }

  // Ranked on total activity, not order value alone: a customer billed 330 480 kr this
  // period on an order placed earlier has no order value at all, and sorting on that field
  // would push exactly the rows this split exists to surface off the end of the top ten —
  // leaving the table and its CSV short of what the chart above them shows.
  const activity = (row: CustomerReportRow) => row.orderValue + row.invoicedValue;
  return [...acc.values()]
    .sort((a, b) => activity(b) - activity(a) || b.orderValue - a.orderValue || a.customer.localeCompare(b.customer, 'sv'))
    .slice(0, topN);
}

// ── Lönsamhet (efterkalkyl per period) ──
//
// TG över en period, räknad på VERKLIGT utfall: rapporterade säckar och rapporterad tid. Underlaget
// kommer från lib/domains/crm/afterCalculation.ts, en order i taget; det här slår ihop dem.
//
// ⚠️ POPULATIONEN ÄR ORDRAR FAKTURERADE I PERIODEN, samma ordrar som "Fakturerat" i serien ovanför.
// Skälet är att talen ska gå att läsa tillsammans: ett jobb hör lönsamhetsmässigt till den period
// det slutfördes i, inte den det såldes i, och en order skapad i mars men fakturerad i juni har sin
// kostnad i juni. En delfakturerad order räknas här först med sista rundan — jobbet är inte färdigt
// förrän då — medan dess rundor syns i "Fakturerat" var och en i sin egen månad.
//
// ⚠️ BARA KOMPLETTA JOBB RÄKNAS (Williams beslut 2026-08-29). Ett jobb vars material eller tid inte
// går att räkna hålls UTANFÖR både täljare och nämnare — det är samma disciplin som quoteMargin
// använder för oprissatta rader, och av samma skäl: ett halvt underlag som räknas med ger en siffra
// med decimal som ser exakt ut och är för hög. Hur många som ingår står alltid utskrivet.
//
// ⚠️ SUMMERA INTÄKT OCH KOSTNAD VAR FÖR SIG — medelvärdesbilda ALDRIG jobbens procenttal. Ett ovägt
// snitt låter ett jobb på 5 000 kr väga lika tungt som ett på 500 000 och svarar därför fel på
// frågan "tjänade vi pengar den här månaden".

export type ProfitabilityPoint = { period: string; tg1: number | null; tg2: number | null };

export type Profitability = {
  /** Täckningsgrad efter material respektive efter material och arbete, för hela perioden. */
  tg1: number | null;
  tg2: number | null;
  /** Kronorna bakom procenten. */
  tb1: number;
  tb2: number;
  /** Intäkten i respektive underlag — de skiljer sig, för de två talen har olika täckning. */
  revenueTb1: number;
  revenueTb2: number;
  /** Fakturerade jobb i perioden, och hur många av dem som gick att räkna. */
  jobs: number;
  jobsTb1: number;
  jobsTb2: number;
  overTime: ProfitabilityPoint[];
  /**
   * Kalkylen kunde inte köras alls — inställningstabellerna eller artikelcachen svarade inte.
   *
   * ⚠️ MÅSTE SKILJAS FRÅN "inga kompletta jobb". Utan flaggan fick varje läsare beskedet att
   * fältet inte lämnat in sina egenkontroller, medan sanningen var att migreringen inte var körd —
   * ett påstående om PERSONALEN när felet låg i systemet, och det enda spåret av orsaken låg i
   * serverloggen.
   */
  unavailable: boolean;
};

export function buildProfitability(
  ordersInvoiced: ReportOrderRow[],
  afterCalculations: Map<string, { revenue: number | null; tb1: number | null; tb2: number | null }>,
  months: string[],
  opts?: { unavailable?: boolean },
): Profitability {
  type Bucket = { revenueTb1: number; tb1: number; revenueTb2: number; tb2: number };
  const empty = (): Bucket => ({ revenueTb1: 0, tb1: 0, revenueTb2: 0, tb2: 0 });
  const total = empty();
  const byMonth = new Map<string, Bucket>();

  let jobsTb1 = 0;
  let jobsTb2 = 0;

  for (const order of ordersInvoiced) {
    const calc = order.id ? afterCalculations.get(order.id) : undefined;
    if (!calc || calc.revenue == null) continue;
    const key = instantMonthKey(invoicedAt(order));
    const bucket = key ? byMonth.get(key) ?? empty() : null;
    if (key && bucket) byMonth.set(key, bucket);

    // TG1 och TG2 har OLIKA täckning: materialet är ofta klart medan tiden inte är rapporterad än.
    // Därför sin egen intäktssumma per tal — annars hade TG2 räknats mot en nämnare som innehöll
    // jobb vars arbetskostnad aldrig drogs av, alltså systematiskt för högt.
    if (calc.tb1 != null) {
      jobsTb1 += 1;
      total.revenueTb1 += calc.revenue;
      total.tb1 += calc.tb1;
      if (bucket) { bucket.revenueTb1 += calc.revenue; bucket.tb1 += calc.tb1; }
    }
    if (calc.tb2 != null) {
      jobsTb2 += 1;
      total.revenueTb2 += calc.revenue;
      total.tb2 += calc.tb2;
      if (bucket) { bucket.revenueTb2 += calc.revenue; bucket.tb2 += calc.tb2; }
    }
  }

  const percent = (value: number, base: number): number | null => (base > 0 ? (value / base) * 100 : null);

  return {
    tg1: percent(total.tb1, total.revenueTb1),
    tg2: percent(total.tb2, total.revenueTb2),
    tb1: total.tb1,
    tb2: total.tb2,
    revenueTb1: total.revenueTb1,
    revenueTb2: total.revenueTb2,
    jobs: ordersInvoiced.length,
    jobsTb1,
    jobsTb2,
    unavailable: Boolean(opts?.unavailable),
    overTime: months.map((period) => {
      const bucket = byMonth.get(period) ?? empty();
      return {
        period,
        tg1: percent(bucket.tb1, bucket.revenueTb1),
        tg2: percent(bucket.tb2, bucket.revenueTb2),
      };
    }),
  };
}

/**
 * Periodens sex huvudtal.
 *
 * Samma funktion räknar perioden OCH jämförelseperioden, så de två aldrig kan mätas olika. Den tar
 * rå ReportData och partitionerar själv — en aning dubbelarbete mot composeSalesReport, men
 * alternativet var att låta anroparen skicka in redan partitionerade order och därmed kunna skicka
 * in dem partitionerade mot FEL intervall.
 */
export function buildPeriodTotals(data: ReportData, range: ReportRange): PeriodTotals {
  const orders = partitionOrders(data.orders, range, data.invoiceRounds);
  const sum = (rows: NetAmountRow[]) => rows.reduce((total, row) => total + netAmount(row), 0);
  return {
    calls: data.calls.length,
    quotes: data.quotes.length,
    quoteValue: sum(data.quotes),
    orders: orders.created.length,
    orderValue: sum(orders.created),
    invoicedValue: sumInvoices(orders.revenue),
  };
}

/**
 * Periodens fakturerade belopp: summan av fakturorna partitionOrders lagt i perioden. Delas av
 * huvudtalet "Fakturerat" och orderstockens veckotal (fetchInvoicedValue), så att de två alltid
 * räknar fakturerat på samma sätt.
 */
export function sumInvoices(revenue: InvoicedRevenue[]): number {
  return revenue.reduce((total, invoice) => total + invoice.amount, 0);
}

export type SalesReport = {
  range: ReportRange;
  periodSummary: PeriodSummary;
  /** Produktionsutfallet — vad som faktiskt blåstes. Se lib/domains/planning/production.ts. */
  production: Production;
  /** Det planerade arbetet i perioden, att ställa utfallet mot. Backloggen i den är "just nu". */
  planned: PlannedPeriod;
  /**
   * Rapporterad tid i perioden — vart timmarna tog vägen.
   *
   * ⚠️ null = ANROPAREN FÅR INTE SE ANDRAS TID. Delen bär namngiven arbetad tid OCH frånvaro per
   * person, vilket `crm_time_entries`-policyn öppnar först på `time.entry.read.all` (admin och
   * ekonomi). Rapportsidan gatas på `crm.access`, som även sales och konsult har — och rutten
   * läser med service-roll, alltså förbi RLS. Utan grinden hade varje säljare sett sina kollegors
   * sjukfrånvaro vid namn, vilket policyns egen kommentar säger att den finns för att hindra.
   */
  time: TimeReport | null;
  /**
   * Översiktens nyckeltal utöver huvudtalen: hit rate, orderstock och öppna offerter — se
   * reportKpis.ts. null när rutten inte räknade dem (anroparen utelämnade dem).
   */
  overview: ReportOverview | null;
  /**
   * Offerter, orderingång och fakturerat per månad, de senaste tolv månaderna (eller sedan start) —
   * följer INTE den valda perioden, som bara markeras i den. null = kunde inte räknas.
   */
  trend: SalesTrend | null;
  /**
   * Försäljningsflikens nyckeltal: hit rate per kundtyp och per offertmånad, och den typiska ordern —
   * se reportKpis.ts. null = kunde inte räknas.
   */
  sales: ReportSales | null;
  /**
   * Omsättningsflikens nyckeltal: fakturerat per kundtyp och månad, book-to-bill, ledtid, ROT,
   * orderstock per läge, kundsegment och kunder — se reportRevenue.ts. null = kunde inte räknas.
   */
  revenue: ReportRevenue | null;
  /**
   * Produkt & marknad: sålda m³, kr/m³ per konstruktion och material, m³ per månad och fakturerat och
   * orderstock per depå — se reportProduct.ts. null = kunde inte räknas.
   */
  product: ReportProduct | null;
  salesOverTime: SalesOverTimePoint[];
  perSeller: SellerReportRow[];
  perCustomer: CustomerReportRow[];
  profitability: Profitability;
};

export function composeSalesReport(
  data: ReportData,
  range: ReportRange,
  /** Efterkalkylen per arbetsorder. Tom karta ger en lönsamhetsdel utan tal — inte ett fel. */
  afterCalculations: Map<string, { revenue: number | null; tb1: number | null; tb2: number | null }> = new Map(),
  opts?: {
    profitabilityUnavailable?: boolean;
    /** Målraderna för periodens månader. Utelämnade ger en sammanställning utan målstaplar. */
    goals?: ReportGoalRow[] | null;
    /** Föregående lika långa period. Utelämnad ger kort utan jämförelsetal — inte nollor. */
    previous?: { range: ReportRange; totals: PeriodTotals } | null;
    /** Produktionsutfallet. Utelämnat ger en del som säger att den inte kunde räknas. */
    production?: Production | null;
    /** Det planerade arbetet. Utelämnat ger en del som säger att den inte kunde räknas. */
    planned?: PlannedPeriod | null;
    /**
     * Rapporterad tid. `undefined` (utelämnad) ger en del som säger att den inte kunde räknas;
     * `null` betyder att anroparen saknar behörighet och sektionen ska utebli helt.
     */
    time?: TimeReport | null;
    /** Översiktens nyckeltal, färdigräknade i rutten — de behöver dagens datum och egna läsningar. */
    overview?: ReportOverview | null;
    /** Trenden, färdigräknad i rutten — den har sitt eget fönster och sina egna läsningar. */
    trend?: SalesTrend | null;
    /** Försäljningsflikens nyckeltal, färdigräknade i rutten — hit rate behöver dagens datum. */
    sales?: ReportSales | null;
    /** Omsättningsflikens nyckeltal, färdigräknade i rutten — de har egna läsningar. */
    revenue?: ReportRevenue | null;
    /** Produkt & marknad, färdigräknad i rutten — den läser orderraderna och schemat själv. */
    product?: ReportProduct | null;
  },
): SalesReport {
  const months = monthsInRange(range.from, range.to);
  const orders = partitionOrders(data.orders, range, data.invoiceRounds);
  return {
    range,
    production: opts?.production ?? unavailableProduction(months, range),
    planned: opts?.planned ?? unavailablePlanned(),
    time: opts?.time === undefined ? unavailableTimeReport(months) : opts.time,
    overview: opts?.overview ?? null,
    trend: opts?.trend ?? null,
    sales: opts?.sales ?? null,
    revenue: opts?.revenue ?? null,
    product: opts?.product ?? null,
    periodSummary: buildPeriodSummary({
      totals: buildPeriodTotals(data, range),
      range,
      months,
      goals: opts?.goals,
      previous: opts?.previous,
    }),
    salesOverTime: buildSalesOverTime(data.quotes, orders.created, orders.revenue, months),
    perSeller: buildPerSeller(data.quotes, orders.created, orders.revenue, data.calls, data.sellers),
    perCustomer: buildPerCustomer(orders.created, orders.revenue),
    profitability: buildProfitability(orders.invoiced, afterCalculations, months, {
      unavailable: opts?.profitabilityUnavailable,
    }),
  };
}

// ── Fetch (admin client; team-wide read model) ──
//
// `vat_percent` och `pricing_summary` hämtas för att varje belopp ska kunna redovisas ex moms —
// se netAmount. Utan dem faller nettot tillbaka på en antagen momssats, vilket bara är en
// nödutgång och inte den väg någon rad ska ta.
//
// ⚠️ VARJE LÄSNING ÄR SIDINDELAD. PostgREST kapar ett svar vid 1000 rader UTAN att fela, och
// rapporten räknar på allt den får — en kapad läsning ger alltså inte ett ofullständigt svar utan
// ett FEL svar som ser komplett ut. 440 offerter skapades mellan 29 juni och 7 oktober 2026, 235 av
// dem i september, så "Senaste 12 mån" hade nått taket runt årsskiftet. `id` är sista (och enda)
// sorteringen: den är unik, och utan en unik nyckel är det odefinierat vilka rader som hamnar på
// vilken sida.

/**
 * readAllPages, med radtypen HÄRLEDD ur frågan i stället för angiven av anroparen.
 *
 * ⚠️ DET ÄR TYPVAKTEN SOM ÄR POÄNGEN. Klienten härleder radtypen ur select-strängen, och raderna
 * tilldelas sina typer utan `as` — då fäller typkontrollen en select som tappat en obligatorisk
 * kolumn. Det gäller framför allt partial_invoicing_started_at: utan den räknas varje
 * slutfakturerad delfakturaorder dubbelt (se invoicedRevenue). Med `readAllPages<T>` direkt hade
 * T skrivits för hand och vakten försvunnit.
 */
export async function readEveryRow<Row>(
  name: string,
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: ReadError }>,
): Promise<Row[]> {
  const { rows, error } = await readAllPages<Row>(page);
  if (error) throw new Error(`${name}: ${error.message}`);
  return rows;
}

/**
 * Ordrar skapade ELLER fakturerade i perioden. Superset: att filtrera på created_at ensamt tappade
 * intäkten från varje order som fakturerades senare än perioden den vanns i — se partitionOrders,
 * där raderna delas isär igen.
 */
function readReportOrders(admin: SupabaseClient, range: ReportRange): Promise<ReportOrderRow[]> {
  // Svenska dagsgränser (instantBounds) — partitionOrders delar sedan raderna på samma svenska dag.
  const { from: start, toExclusive: end } = instantBounds(range);
  return readEveryRow('crm_work_orders', (from, to) =>
    admin.from('crm_work_orders')
      // `id` bär lönsamhetsdelen: efterkalkylen slås upp per order. Radernas `line_items` hämtas
      // INTE här — de behövs bara för de fakturerade ordrarna, och tolv månaders rader hade varit
      // en tung nyttolast att dra hem för att sedan kasta det mesta.
      //
      // ⚠️ KUNDKORTET MED UTPEKAD NYCKEL (`!crm_work_orders_customer_id_fkey`). Ordern har två nycklar
      // mot crm_customers — customer_id och prospect_id — och utan utpekningen vägrar PostgREST
      // inbäddningen ("more than one relationship"), vilket fäller hela rapporten.
      .select('id, amount, vat_percent, pricing_summary, status, created_at, fortnox_invoiced_at, partial_invoicing_started_at, assigned_to, client_name, quote_type, customer_id, rot_enabled:rot_details->enabled, customer:crm_customers!crm_work_orders_customer_id_fkey(sni_code)')
      .or(`and(created_at.gte.${start},created_at.lt.${end}),and(fortnox_invoiced_at.gte.${start},fortnox_invoiced_at.lt.${end})`)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

/**
 * Delfakturarundorna i perioden, med sin order inbäddad: en runda i augusti hör ofta till en order
 * som varken skapades eller slutfakturerades i augusti, och finns då inte bland ordrarna ovan.
 * `amount` är redan ex moms — se invoicedRevenue.
 */
function readReportInvoiceRounds(admin: SupabaseClient, range: ReportRange): Promise<ReportInvoiceRoundRow[]> {
  const { from: start, toExclusive: end } = instantBounds(range);
  return readEveryRow('crm_work_order_invoices', (from, to) =>
    admin.from('crm_work_order_invoices')
      .select('amount, created_at, work_order_id, work_order:crm_work_orders(status, assigned_to, client_name, quote_type)')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

/** Offerter med offertdatum i perioden. `quote_date` är ett datum utan tidszon. */
function readReportQuotes(admin: SupabaseClient, range: ReportRange): Promise<ReportQuoteRow[]> {
  return readEveryRow('crm_quotes', (from, to) =>
    admin.from('crm_quotes')
      .select('amount, vat_percent, pricing_summary, status, quote_date, assigned_to, customer_name, quote_type')
      .gte('quote_date', range.from)
      .lte('quote_date', range.to)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

export async function fetchReportData(admin: SupabaseClient, range: ReportRange): Promise<ReportData> {
  const { from: start, toExclusive: end } = instantBounds(range);
  // Utan `as`: radtyperna härleds ur select-strängarna — se readEveryRow.
  const [quotes, orders, invoiceRounds, calls, sellers]: [
    ReportQuoteRow[],
    ReportOrderRow[],
    ReportInvoiceRoundRow[],
    ReportCallRow[],
    ReportSellerRow[],
  ] = await Promise.all([
    readReportQuotes(admin, range),
    readReportOrders(admin, range),
    readReportInvoiceRounds(admin, range),
    readEveryRow('crm_calls', (from, to) =>
      admin.from('crm_calls')
        .select('user_id, call_at')
        .gte('call_at', start)
        .lt('call_at', end)
        .order('id', { ascending: true })
        .range(from, to)),
    readEveryRow('profiles', (from, to) =>
      admin.from('profiles')
        .select('id, full_name, role')
        .in('role', ['sales', 'admin', 'konsult'])
        .order('id', { ascending: true })
        .range(from, to)),
  ]);

  return { quotes, orders, invoiceRounds, calls, sellers };
}

/**
 * Underlaget för trenden: offerter, order och delfakturarundor i fönstret — samma läsningar som
 * rapporten, men utan samtal och säljare som trenden inte visar.
 */
export async function fetchTrendData(
  admin: SupabaseClient,
  range: ReportRange,
): Promise<Pick<ReportData, 'quotes' | 'orders' | 'invoiceRounds'>> {
  const [quotes, orders, invoiceRounds] = await Promise.all([
    readReportQuotes(admin, range),
    readReportOrders(admin, range),
    readReportInvoiceRounds(admin, range),
  ]);
  return { quotes, orders, invoiceRounds };
}

/**
 * Fakturerat i perioden, räknat exakt som rapportens eget "Fakturerat": samma läsningar, samma
 * partitionering. Används för orderstockens veckotal, som mäter mot en annan period än den valda.
 * Läser bara ordrarna och rundorna — inte offerter, samtal och säljare som fetchReportData.
 */
export async function fetchInvoicedValue(admin: SupabaseClient, range: ReportRange): Promise<number> {
  const [orders, invoiceRounds] = await Promise.all([
    readReportOrders(admin, range),
    readReportInvoiceRounds(admin, range),
  ]);
  return sumInvoices(partitionOrders(orders, range, invoiceRounds).revenue);
}
