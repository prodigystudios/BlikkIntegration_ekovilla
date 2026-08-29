import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { computeAfterCalculations } from '@/lib/domains/crm/afterCalculationLoader';
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
// Själva inhämtningen bor i afterCalculationLoader och delas med listans mängdrutt, så regeln för
// vad som räknas som material finns på ETT ställe. Den regeln har varit fel en gång.
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

    const supabase = getSupabaseAdmin();
    const { data: workOrder, error: workOrderError } = await getCrmWorkOrder(supabase, context.params.id);
    if (workOrderError || !workOrder) {
      return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');
    }

    const results = await computeAfterCalculations(supabase, [
      {
        id: context.params.id,
        line_items: (workOrder as { line_items?: unknown }).line_items,
        vat_percent: (workOrder as { vat_percent?: number | string | null }).vat_percent ?? null,
      },
    ]);

    const result = results.get(context.params.id);
    if (!result) {
      return routeError(500, 'crm_after_calculation_failed', 'Efterkalkylen kunde inte räknas.');
    }

    return ok(result);
  } catch (e: any) {
    return routeError(500, 'crm_after_calculation_unexpected', e?.message || 'Failed to compute after calculation');
  }
}
