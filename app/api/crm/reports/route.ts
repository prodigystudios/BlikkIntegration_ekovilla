import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, requireCrmUser } from '@/app/api/crm/_shared';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import {
  buildPeriodTotals,
  composeSalesReport,
  fetchInvoicedValue,
  fetchReportData,
  fetchTrendData,
  monthsInRange,
  partitionOrders,
  type ReportQuoteRow,
  type ReportRange,
} from '@/lib/domains/crm/reports';
import {
  buildReportOverview,
  buildReportSales,
  buildSalesTrend,
  trendWindow,
  type ReportSales,
  type SalesTrend,
} from '@/lib/domains/crm/reportKpis';
import {
  fetchCustomerOrderRows,
  fetchFirstActivityDay,
  fetchOpenQuoteRows,
  fetchOrderStockRows,
} from '@/lib/domains/crm/reportKpisLoader';
import { buildReportRevenue, countOrdersPerCustomer, type ReportRevenue } from '@/lib/domains/crm/reportRevenue';
import type { PeriodTotals, ReportGoalRow } from '@/lib/domains/crm/reportGoals';
import { buildProduction, type Production } from '@/lib/domains/planning/production';
import { fetchProductionData } from '@/lib/domains/planning/productionLoader';
import { computeBacklogValue, loadScheduledScopes } from '@/lib/domains/planning/insights';
import { aggregatePlannedForRange, type PlannedPeriod } from '@/lib/domains/planning/plannedPeriod';
import { buildTimeReport, type TimeReport } from '@/lib/domains/time/report';
import { fetchTimeReportData } from '@/lib/domains/time/reportLoader';
import { computeAfterCalculations, type AfterCalculationOrderRow } from '@/lib/domains/crm/afterCalculationLoader';
import type { AfterCalculation } from '@/lib/domains/crm/afterCalculation';
import { previousRange, reportRange, today } from '@/app/crm/rapportering/reportRanges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)');
const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

// Standardperioden: denna månad (Williams beslut 2026-10-07 — tidigare de senaste tolv månaderna).
// Samma snabbval som rapportsidans förval, så en sida som öppnas utan datum och en som skickar sitt
// förval får samma svar. Ankrat i svensk dag: strax efter midnatt gav UTC-dygnet annars ett intervall
// som slutade i går, och den 1:a i månaden hade pekat ut förra månaden.
function defaultRange(): ReportRange {
  return reportRange('month');
}

export async function GET(req: Request) {
  try {
    // Reporting is gated to CRM users; all sellers may view team-wide figures.
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const fallback = defaultRange();
    const range: ReportRange = {
      from: parsed.data.from || fallback.from,
      to: parsed.data.to || fallback.to,
    };
    if (range.from > range.to) return routeError(400, 'invalid_range', 'Startdatum måste vara före slutdatum.');

    // Admin client: team-wide aggregated read model (profiles RLS only self-reads
    // with a session client — same rationale as the goals route).
    const admin = getSupabaseAdmin();

    // ── Översiktens nyckeltal ────────────────────────────────────────────────
    //
    // Orderstocken och de öppna offerterna är ÖGONBLICKSBILDER — de följer inte perioden. Veckotalet
    // mäter stocken mot senaste HELA kalendermånadens fakturering, som läses för sig.
    //
    // Läsningarna STARTAS HÄR och väntas in först när svaret sätts ihop: de beror inte på något
    // annat i rutten, så deras rundresor ska inte läggas ovanpå resten av sidans.
    //
    // ⚠️ VAR OCH EN FÅR FELA FÖR SIG, och felet blir null — aldrig en nolla. "Orderstock 0 kr" hade
    // varit ett påstående om verksamheten, inte ett saknat värde. Varje gren fångar sitt eget fel, så
    // inget löfte kan bli ett ohanterat avslag om resten av rutten skulle kasta först. Hit rate räknas
    // på periodens offerter, som läses nedan, och kan inte utebli.
    const now = new Date();
    const basisRange = reportRange('prevMonth', now);
    const overviewReads = Promise.all([
      fetchOrderStockRows(admin).catch((e: any) => {
        console.warn(`[Rapport] Orderstocken kunde inte läsas: ${e?.message || e}`);
        return null;
      }),
      fetchInvoicedValue(admin, basisRange).then(
        (invoiced) => ({ range: basisRange, invoiced }),
        (e: any) => {
          console.warn(`[Rapport] Förra månadens fakturering kunde inte läsas: ${e?.message || e}`);
          return null;
        },
      ),
      fetchOpenQuoteRows(admin).catch((e: any) => {
        console.warn(`[Rapport] De öppna offerterna kunde inte läsas: ${e?.message || e}`);
        return null;
      }),
      // Varje kunds order sedan start, för "återkommande kunder" under Omsättning.
      fetchCustomerOrderRows(admin).then((rows) => countOrdersPerCustomer(rows, range.to), (e: any) => {
        console.warn(`[Rapport] Kundernas order kunde inte läsas: ${e?.message || e}`);
        return null;
      }),
    ]);

    // Trenden: de senaste tolv månaderna eller sedan start, oavsett vald period. Startas här av samma
    // skäl som ögonblicksbilderna. Raderna läses för hela tolvmånadersfönstret parallellt med första
    // aktivitetsdagen, och fönstret kortas av först i beräkningen (trendWindow) — så väntar ingen av
    // läsningarna på den andra. Täcker den valda perioden redan de tolv månaderna ("Senaste 12 mån")
    // återanvänds periodens rader i stället för att läsas en gång till.
    //
    // Felar första aktivitetsdagen börjar fönstret tolv månader bakåt — tomma månader i början, men
    // inget fel tal. Felar läsningen blir trenden null.
    const last12 = reportRange('last12', now);
    const reuseForTrend = range.from <= last12.from && range.to >= last12.to;
    const firstActivityRead = fetchFirstActivityDay(admin).catch((e: any) => {
      console.warn(`[Rapport] Första aktiviteten kunde inte läsas: ${e?.message || e}`);
      return null;
    });
    const trendDataRead = reuseForTrend
      ? null
      : fetchTrendData(admin, last12).catch((e: any) => {
        console.warn(`[Rapport] Trenden kunde inte läsas: ${e?.message || e}`);
        return null;
      });

    const data = await fetchReportData(admin, range);

    // ── Referenspunkterna: målen och föregående period ───────────────────────
    //
    // ⚠️ VARKEN MÅLEN ELLER JÄMFÖRELSEN FÅR KUNNA SÄNKA RAPPORTEN. Samma regel som lönsamheten
    // nedan lyder under: felar de ska säljsiffrorna fortfarande visas, och korten stå utan sin
    // referens. Därför egna try/catch per del i stället för ett Promise.all som river allt.
    //
    // Båda degraderar till `null`, aldrig till nollor — ett jämförelsetal på 0 kr hade lästs som
    // "förra perioden sålde vi ingenting", vilket är ett helt annat påstående än "vi vet inte".
    const months = monthsInRange(range.from, range.to);

    // Målen läses för periodens månader OCH trendens tolv, i en fråga. Varje mottagare filtrerar själv
    // fram sina månader (sumGoalTargets, monthHasGoal), så de extra raderna påverkar inte perioden.
    const goalMonths = [...new Set([...months, ...monthsInRange(last12.from, last12.to)])];
    let goals: ReportGoalRow[] | null = null;
    try {
      const { data: goalRows, error } = await admin
        .from('crm_goals')
        .select('period_start, calls_target, quotes_target, quote_value_target, order_count_target, order_value_target, invoiced_value_target')
        .eq('period_type', 'month')
        .in('period_start', goalMonths.map((month) => `${month}-01`));
      if (error) throw new Error(error.message);
      goals = (goalRows as ReportGoalRow[]) || [];
    } catch (e: any) {
      console.warn(`[Rapport] Målen kunde inte hämtas: ${e?.message || e}`);
    }

    // Produktionsutfallet. Samma regel som målen och lönsamheten: felar det ska säljsiffrorna
    // fortfarande visas, och produktionsdelen märka sig som "kunde inte räknas".
    let production: Production | null = null;
    try {
      const { data: productionData, error } = await fetchProductionData(admin, range);
      if (error) throw new Error(error.message);
      production = buildProduction({ ...productionData, range, months });
    } catch (e: any) {
      console.warn(`[Rapport] Produktionen kunde inte räknas: ${e?.message || e}`);
    }

    // Det planerade arbetet i perioden, att ställa utfallet mot. Läsningen delas med planeringens
    // insikter (loadScheduledScopes) så de två vyerna inte kan ha olika uppfattning om schemat.
    //
    // ⚠️ BACKLOGGEN HAR INGEN PERIOD. Den svarar på "vad väntar just nu" och ändras inte med
    // periodfiltret — gränssnittet märker den så.
    let planned: PlannedPeriod | null = null;
    try {
      const scheduled = await loadScheduledScopes(admin, range.from, range.to, 'not-cancelled');
      if (scheduled.error || !scheduled.data) throw new Error(scheduled.error?.message || 'schemat kunde inte läsas');
      const aggregate = aggregatePlannedForRange({ ...scheduled.data, range, months });
      // ⚠️ BACKLOGGEN FÅR VARA null UTAN ATT FÄLLA RESTEN. Går den inte att läsa döljs kortet —
      // "Oplanerat värde 0 kr" hade varit ett påstående om verksamheten, inte ett saknat värde.
      // Periodens planerade siffror är oberoende av backloggen och ska stå kvar.
      const backlog = await computeBacklogValue(admin);
      if (backlog.error) console.warn(`[Rapport] Backloggen kunde inte läsas: ${backlog.error.message}`);
      planned = { ...aggregate, backlog: backlog.data, unavailable: false };
    } catch (e: any) {
      console.warn(`[Rapport] Det planerade arbetet kunde inte räknas: ${e?.message || e}`);
    }

    // ── Rapporterad tid ──────────────────────────────────────────────────────
    //
    // ⚠️ EGEN GRIND, INTE SIDANS. Delen bär namngiven arbetad tid OCH frånvaro per person.
    // `crm_time_entries_select` öppnar andras rader först på `time.entry.read.all` (admin,
    // ekonomi) — och kommentaren i den policyn säger rakt ut att det är mekanismen som hindrar en
    // sjukfrånvarorad från att synas för besättningskollegorna. Rapportsidan gatas på
    // `crm.access`, som sales och konsult också har, och läsningen nedan går med service-roll
    // alltså FÖRBI RLS. Utan den här grinden hade varje säljare sett kollegornas sjukskrivningar.
    //
    // Samma misstag som #202: `crm.access` gav bort försäljningssiffror förbi RLS.
    //
    // `undefined` skulle betyda "kunde inte räknas"; här menar vi "får inte visas", och det är
    // `null`. Sektionen uteblir då helt i stället för att skylta med att den finns.
    const mayReadAllTime = can(await getEffectivePermissions(), 'time.entry.read.all');
    let time: TimeReport | null | undefined = mayReadAllTime ? undefined : null;
    if (mayReadAllTime) try {
      const { data: timeData, error } = await fetchTimeReportData(admin, range);
      if (error) throw new Error(error.message);
      time = buildTimeReport({ ...timeData, range, months });
    } catch (e: any) {
      console.warn(`[Rapport] Tiden kunde inte räknas: ${e?.message || e}`);
      time = undefined;
    }

    const comparisonRange = previousRange(range);
    let previous: { range: ReportRange; totals: PeriodTotals } | null = null;
    // Föregående periods offerter, för hit rate-jämförelsen. Samma läsning som huvudtalen.
    let previousQuotes: { range: ReportRange; quotes: ReportQuoteRow[] } | null = null;
    if (comparisonRange) {
      try {
        // Bara huvudtalen för föregående period — INGEN efterkalkyl. Lönsamheten räknas på
        // fakturerade ordrars radrader, och att göra om det arbetet för en period ingen tittar på
        // hade fördubblat svarstiden för ett jämförelsetal i ett chip.
        const previousData = await fetchReportData(admin, comparisonRange);
        previous = { range: comparisonRange, totals: buildPeriodTotals(previousData, comparisonRange) };
        previousQuotes = { range: comparisonRange, quotes: previousData.quotes };
      } catch (e: any) {
        console.warn(`[Rapport] Jämförelseperioden kunde inte hämtas: ${e?.message || e}`);
      }
    }

    // ── Lönsamheten ──────────────────────────────────────────────────────────
    // Bara de FAKTURERADE ordrarna efterkalkyleras. Populationen är densamma som "Fakturerat" i
    // serien, och det håller nere arbetet: `line_items` hämtas för en handfull ordrar i stället för
    // tolv månaders hela orderstock.
    //
    // ⚠️ Lönsamheten får inte kunna sänka rapporten. Kalkylen vilar på två inställningstabeller och
    // artikelcachen; felar någon av dem ska säljsiffrorna fortfarande visas, och lönsamhetsdelen
    // stå tom. Det är skillnaden mellan en del av sidan som saknas och en sida som inte laddar.
    const periodOrders = partitionOrders(data.orders, range, data.invoiceRounds);
    const invoicedIds = periodOrders.invoiced
      .map((order) => order.id)
      .filter((id): id is string => Boolean(id));

    const afterCalculations = new Map<string, AfterCalculation>();
    let profitabilityUnavailable = false;
    if (invoicedIds.length > 0) {
      try {
        // ⚠️ KLUMPAR, INTE HELA LISTAN. `.in()` blir en query-sträng, och tolv månaders fakturerade
        // ordrar kan vara hundratals uuid:n à 37 tecken — långt förbi vad mellanled garanterar, med
        // ett 414 som svar. Klumparna håller dessutom varje svar under PostgRESTs radtak, som
        // annars kapar tyst: de tappade ordrarna hade försvunnit ur täckningsgraden men räknats
        // kvar i "av N jobb". Samma tak som listrutten delar på.
        const CHUNK = 100;
        for (let i = 0; i < invoicedIds.length; i += CHUNK) {
          const chunk = invoicedIds.slice(i, i + CHUNK);
          const { data: orderRows, error } = await admin
            .from('crm_work_orders')
            .select('id, line_items, vat_percent')
            .in('id', chunk);
          if (error) throw new Error(error.message);
          const computed = await computeAfterCalculations(admin, (orderRows || []) as AfterCalculationOrderRow[]);
          for (const [id, result] of computed) afterCalculations.set(id, result);
        }
      } catch (e: any) {
        // ⚠️ FLAGGAN MÅSTE MED I SVARET. Bara en logg här gjorde att klienten renderade "inget jobb
        // har komplett underlag än" — ett påstående om att fältet inte lämnat in sina
        // egenkontroller, när sanningen kunde vara att migreringen inte var körd. Orsaken får inte
        // stanna i serverloggen.
        profitabilityUnavailable = true;
        console.warn(`[Rapport] Lönsamheten kunde inte räknas: ${e?.message || e}`);
      }
    }

    const todayIso = today(now);
    const [orderStockRows, basis, openQuoteRows, ordersSinceStart] = await overviewReads;
    const overview = buildReportOverview({
      quotes: data.quotes,
      range,
      today: todayIso,
      previous: previousQuotes,
      orderStockRows,
      basis,
      openQuoteRows,
    });

    const trendData = reuseForTrend ? data : await trendDataRead;
    const trendRange = trendWindow(last12, await firstActivityRead);
    let trend: SalesTrend | null = null;
    if (trendData) {
      try {
        trend = buildSalesTrend({ data: trendData, window: trendRange, selected: range, goals });
      } catch (e: any) {
        console.warn(`[Rapport] Trenden kunde inte räknas: ${e?.message || e}`);
      }
    }

    // Försäljningsflikens nyckeltal. Hit rate per offertmånad läser trendens offerter i trendens
    // fönster (Williams beslut 2026-10-07: samma tolv månader, vald period markerad) — felade trendens
    // läsning blir bara den delen null. Resten räknas på periodens rader, som redan finns.
    let sales: ReportSales | null = null;
    try {
      sales = buildReportSales({
        quotes: data.quotes,
        ordersCreated: periodOrders.created,
        range,
        today: todayIso,
        trend: trendData ? { quotes: trendData.quotes, window: trendRange } : null,
      });
    } catch (e: any) {
      console.warn(`[Rapport] Försäljningens nyckeltal kunde inte räknas: ${e?.message || e}`);
    }

    // Omsättningsflikens nyckeltal. Fakturerat per månad läser trendens rader i trendens fönster
    // (Williams beslut 2026-10-07); orderstocken per läge är ögonblicksbildens rader. Felar någon av de
    // läsningarna blir bara den delen null.
    let revenue: ReportRevenue | null = null;
    try {
      revenue = buildReportRevenue({
        period: periodOrders,
        range,
        trend: trendData ? { data: trendData, window: trendRange } : null,
        orderStockRows,
        ordersSinceStart,
        totals: buildPeriodTotals(data, range),
        previousTotals: previous?.totals ?? null,
      });
    } catch (e: any) {
      console.warn(`[Rapport] Omsättningens nyckeltal kunde inte räknas: ${e?.message || e}`);
    }

    const report = composeSalesReport(data, range, afterCalculations, {
      profitabilityUnavailable,
      goals,
      previous,
      production,
      planned,
      time,
      overview,
      trend,
      sales,
      revenue,
    });

    return ok(report);
  } catch (e: any) {
    return routeError(500, 'crm_reports_failed', e?.message || 'Kunde inte ta fram rapporten');
  }
}
