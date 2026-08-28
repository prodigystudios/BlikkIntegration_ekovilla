import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { listSackReports } from '@/lib/domains/planning/reports';
import { computePricing, type PricingLineItem } from '@/lib/domains/crm/pricing';
import {
  calculateAfterCalculation,
  type AfterCalculationSackRow,
  type AfterCalculationTimeRow,
} from '@/lib/domains/crm/afterCalculation';
import {
  getCalcSettings,
  listCostArticlePrices,
  listMaterialCostArticles,
  mapLaborCostPerHour,
  mapMaterialCostArticles,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
} from '@/lib/domains/crm/calcSettings';
import { invalidUuidParam, ok, requirePermission, routeError } from '../../_lib';

// Efterkalkylen för EN arbetsorder: verklig TB1/TB2 ur rapporterat material och rapporterad tid.
//
// ── EGEN RUTT MED FLIT, INTE ETT FÄLT PÅ ARBETSORDERN ────────────────────────
// Fältvyn läser GET /api/crm/work-orders/[id], och redactWorkOrderForField() skalar bara bort
// `amount` + `pricing_summary` — `line_items` går orörd ut till installatörens telefon. Läggs TB på
// den befintliga nyttolasten måste redaktionen utökas, och en utökning man glömmer är ett läckage.
// En egen rutt gör läckan omöjlig i stället för bortplockad: den här vägen anropas bara från
// kontorets arbetsordervy, och gaten nedan är en nyckel installatörer inte har.
//
// ── VARFÖR SERVICE-ROLE, TROTS HUSREGELN ─────────────────────────────────────
// Tre av läsningarna är RLS-skyddade på ett sätt som gör svaret BEROENDE AV VEM SOM FRÅGAR:
//
//   crm_time_entries      SELECT kräver time.entry.read.all (bara admin), att man är orderns
//                         assigned_to, eller att man är besättning. En säljare som varken äger
//                         ordern eller står på den läser NOLL rader — och noll rader är inte
//                         "0 timmar", det är "jag fick inte se dem".
//   ops_segment_reports   kräver planning.schedule.read.
//   fortnox_articles_cache SELECT-policyn är rollbaserad (sales/admin) — konsult når den inte.
//
// Med sessionsklienten hade alltså samma jobb visat olika TB2 för olika personer, och den lägre
// siffran hade sett ut som ett lönsamt jobb i stället för som utebliven behörighet. En siffra som
// tyst byter värde efter läsaren är värre än ingen siffra alls.
//
// Auktorisationen ligger därför i EN uttrycklig gate här: crm.report.read (admin, sales, konsult —
// aldrig member). Den är hela spärren, så flytta den inte och lägg inget bredvid den.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.report.read');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const workOrderId = context.params.id;
    const supabase = getSupabaseAdmin();

    const { data: workOrder, error: workOrderError } = await getCrmWorkOrder(supabase, workOrderId);
    if (workOrderError || !workOrder) {
      return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');
    }

    const [sackResult, timeResult, settingsResult, mappingResult] = await Promise.all([
      listSackReports(supabase, workOrderId),
      // Bara jobbtid. Frånvaro och interntid bär aldrig work_order_id (buildTimeEntryRow nollar
      // fälten som inte hör till raden), men villkoret står ändå kvar: en rad som kommer in någon
      // annan väg ska inte kunna debitera jobbet.
      supabase
        .from('crm_time_entries')
        .select('id, minutes_worked, hours')
        .eq('work_order_id', workOrderId)
        .eq('kind', 'work_order'),
      getCalcSettings(supabase),
      listMaterialCostArticles(supabase),
    ]);

    if (sackResult.error) {
      return routeError(500, 'crm_after_calculation_sacks_failed', sackResult.error.message);
    }
    if (timeResult.error) {
      return routeError(500, 'crm_after_calculation_time_failed', timeResult.error.message);
    }
    // Saknad relation = migreringen är inte körd än. Meddelandet ska säga det, inte visa rå
    // PostgREST-text på ett kort mitt i arbetsordern.
    if (settingsResult.error || mappingResult.error) {
      return routeError(
        500,
        'crm_after_calculation_settings_failed',
        'Kalkylinställningarna kunde inte läsas. Är 20260828_crm_cost_settings.sql körd?',
      );
    }

    const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
    const articleNumbers = [...new Set(mappings.map((row) => row.article_number))];
    const priceResult = articleNumbers.length > 0 ? await listCostArticlePrices(supabase, articleNumbers) : { data: [], error: null };
    if (priceResult.error) {
      return routeError(500, 'crm_after_calculation_article_prices_failed', priceResult.error.message);
    }

    // ⚠️ INTÄKTEN RÄKNAS UR RADERNA, INTE UR DEN SPARADE pricing_summary. Skälet är samma regel som
    // MarginRow.revenue bär i pricing.ts: det belopp som bedöms måste vara det som VISAS. Ekonomi-
    // kortets Delsumma är `computePricing(...)` över samma rader (avskrivna bortfiltrerade), så
    // hade TB1 räknats på den lagrade sammanställningen kunde de två stått en decimeter från
    // varandra med olika tal — och den lagrade kan dessutom vara en platshållarnolla på en order
    // som sparats utan summering (se netAmount).
    //
    // Avskrivna rader är ute ur BÅDA leden: de utförs aldrig, alltså faktureras de inte och det går
    // ingen lösull åt. Samma filter som artikelfliken och säckbadgen redan använder.
    const lineItems = Array.isArray(workOrder.line_items) ? (workOrder.line_items as Array<Record<string, unknown>>) : [];
    const billableItems = lineItems.filter((item) => !item.written_off) as PricingLineItem[];
    const pricing = computePricing(billableItems, (workOrder as { vat_percent?: number | string | null }).vat_percent ?? null);

    const result = calculateAfterCalculation({
      // ⚠️ subtotal, ALDRIG total — `total` bär moms, och moms är inte vår intäkt.
      revenue: pricing.subtotal,
      sackRows: (sackResult.data || []) as unknown as AfterCalculationSackRow[],
      timeRows: (timeResult.data || []) as AfterCalculationTimeRow[],
      costArticles: mapMaterialCostArticles(mappings, (priceResult.data || []) as any[]),
      laborCostPerHour: mapLaborCostPerHour(settingsResult.data as CalcSettingsRow | null),
    });

    return ok(result);
  } catch (e: any) {
    return routeError(500, 'crm_after_calculation_unexpected', e?.message || 'Failed to compute after calculation');
  }
}
