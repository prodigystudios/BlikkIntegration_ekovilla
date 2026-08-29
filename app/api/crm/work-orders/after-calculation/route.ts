import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { computeAfterCalculations, type AfterCalculationOrderRow } from '@/lib/domains/crm/afterCalculationLoader';
import { ok, requirePermission, routeError, validationError } from '../_lib';

// Efterkalkylen för FLERA arbetsordrar — arbetsorderlistans TG-märke.
//
// ── VARFÖR POST FÖR EN LÄSNING ───────────────────────────────────────────────
// Listan hämtar upp till CRM_WORK_ORDERS_PAGE_SIZE (100) ordrar åt gången, och hundra uuid:n i en
// query-sträng är ~3 700 tecken — över vad flera mellanled garanterar. Id-listan går därför i
// kroppen. Rutten skriver ingenting.
//
// ⚠️ Sökvägen krockar INTE med [id]/after-calculation: den här är ETT segment efter work-orders och
// den andra TVÅ. Skulle någon ändå träffa [id]-rutten med "after-calculation" som id avvisar
// invalidUuidParam det.
//
// Samma gate och samma skäl till service-role som enkelrutten — se kommentaren där, den är den
// utförliga. Inhämtningen delas via afterCalculationLoader, så regeln för vad som räknas som
// material inte finns i två kopior.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Taket speglar listans sidstorlek. Utan det kan en handskriven begäran be om tiotusen ordrar och
// dra hela huvudboken genom paginatorn.
const bodySchema = z.object({
  work_order_ids: z.array(z.string().uuid('Ogiltigt id')).min(1, 'Minst ett id krävs').max(200, 'För många ordrar i samma begäran'),
});

export async function POST(req: Request) {
  try {
    const gate = await requirePermission('crm.report.read');
    if (gate.response) return gate.response;

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = getSupabaseAdmin();
    // Bara det kalkylen behöver. Hela crmWorkOrderSelect för hundra ordrar hade dragit med sig
    // kundsnapshots och handoff-texter som ingen här läser.
    const { data, error } = await supabase
      .from('crm_work_orders')
      .select('id, line_items, vat_percent')
      .in('id', parsedBody.data.work_order_ids);
    if (error) {
      return routeError(500, 'crm_after_calculation_orders_failed', error.message);
    }

    const results = await computeAfterCalculations(supabase, (data || []) as AfterCalculationOrderRow[]);

    // ⚠️ SMAL NYTTOLAST, MED FLIT. Listan ritar ett märke — den behöver procenten, inte
    // uppställningen. Hela kalkylen för hundra ordrar hade dessutom skickat varje materialrads
    // inköpspris till webbläsaren, alltså långt mer kostnadsdata än ytan faktiskt visar.
    // Härledningen hämtas per order när någon öppnar den.
    //
    // Ordrar som inte gick att räkna SAKNAS i svaret i stället för att stå som noll — samma regel
    // som huvudbokens summering: anropsstället ska kunna skilja "vet inte" från "inget".
    const items: Record<string, { tg1: number | null; tg2: number | null; materialCostIsPartial: boolean; isPreliminary: boolean }> = {};
    for (const [id, result] of results) {
      items[id] = {
        tg1: result.tg1,
        tg2: result.tg2,
        materialCostIsPartial: result.materialCostIsPartial,
        isPreliminary: result.isPreliminary,
      };
    }

    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'crm_after_calculation_batch_unexpected', e?.message || 'Failed to compute after calculations');
  }
}
