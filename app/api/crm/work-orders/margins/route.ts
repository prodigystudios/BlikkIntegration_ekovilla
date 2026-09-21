import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { computeAfterCalculations, type AfterCalculationOrderRow } from '@/lib/domains/crm/afterCalculationLoader';
import { computePreCalculations, type PreCalculationOrderRow } from '@/lib/domains/crm/preCalculationLoader';
import { ok, requirePermission, routeError, validationError } from '../_lib';

// Marginalen för FLERA arbetsordrar — planeringstavlans TB-märke.
//
// ── VARFÖR BÅDA KALKYLERNA I ETT SVAR ────────────────────────────────────────
// Kortet visar TG1 vid insäljning ALLTID, och utfallet så fort det finns. Två rutter hade blivit
// två anrop per tavelladdning och två tillstånd att hålla synkade i klienten, för ett kort som
// alltid vill ha båda. De två laddarna delar dessutom underlag (kalkylinställningar,
// kostnadsartiklar, artikelcachens priser), så ett svar är också färre frågor.
//
// ── ⚠️ NÄR TALEN FÅR JÄMFÖRAS ───────────────────────────────────────────────
// Förkalkylen lyfter ut rader som saknar inköpspris ur BÅDE täljare och nämnare; efterkalkylen
// räknar på hela orderns intäkt och svarar okänt så fort NÅGON rad saknar pris. Det låter som två
// olika nämnare, men de sammanfaller precis där det spelar roll:
//
//   `actual_tg1` är icke-null  ⟺  ingen rad saknar inköpspris  ⟹  förkalkylen lyfte inte ut något
//
// Finns det alltså ett utfallstal att ställa bredvid plantalet står de två på SAMMA intäkt. Saknas
// jämförbarheten är utfallet redan null och kortet visar bara planen. Ytan behöver därför ingen
// egen spärr — men den får heller aldrig visa ett utfall som rutten svarat null på, och sedan
// fylla luckan med något annat.
//
// ── VARFÖR POST FÖR EN LÄSNING ───────────────────────────────────────────────
// Samma skäl som efterkalkylens mängdrutt: hundra uuid:n i en query-sträng är ~3 700 tecken, över
// vad flera mellanled garanterar. Id-listan går i kroppen. Rutten skriver ingenting.
//
// ⚠️ Sökvägen krockar INTE med [id]: den här är ETT segment efter work-orders. Skulle någon ändå
// träffa [id]-rutten med "margins" som id avvisar invalidUuidParam det.
//
// Samma gate och samma skäl till service-role som efterkalkylens rutter — se kommentaren i
// [id]/after-calculation/route.ts, den är den utförliga.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Taket ligger över vad en tavelvecka rimligen rymmer med marginal. Utan det kan en handskriven
// begäran be om tiotusen ordrar och dra hela huvudboken genom kalkylen.
const bodySchema = z.object({
  work_order_ids: z
    .array(z.string().uuid('Ogiltigt id'))
    .min(1, 'Minst ett id krävs')
    .max(200, 'För många ordrar i samma begäran'),
});

export async function POST(req: Request) {
  try {
    const gate = await requirePermission('crm.report.read');
    if (gate.response) return gate.response;

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = getSupabaseAdmin();
    // Bara det de två kalkylerna behöver. Hela crmWorkOrderSelect för hundra ordrar hade dragit med
    // sig kundsnapshots och handoff-texter som ingen här läser.
    //
    // ⚠️ `quote_type` och `rot_details` är INTE överflödiga: utan dem kan förkalkylen inte skilja en
    // ROT-flaggad arbetsrad (intäkt utan materialkostnad) från en obedömbar rad, och raden hade
    // lyfts ut ur intäkten i stället för räknats med. Se isRotActive.
    const { data, error } = await supabase
      .from('crm_work_orders')
      .select('id, line_items, vat_percent, quote_type, rot_details')
      .in('id', parsedBody.data.work_order_ids);
    if (error) {
      return routeError(500, 'crm_margins_orders_failed', error.message);
    }

    const rows = (data || []) as Array<Record<string, unknown>>;
    const [plans, actuals] = await Promise.all([
      computePreCalculations(supabase, rows as unknown as PreCalculationOrderRow[]),
      computeAfterCalculations(supabase, rows as unknown as AfterCalculationOrderRow[]),
    ]);

    // ⚠️ SMAL NYTTOLAST, MED FLIT. Kortet ritar ett märke — det behöver talen, inte uppställningen.
    // Hela kalkylen för hundra ordrar hade skickat varje materialrads INKÖPSPRIS till webbläsaren,
    // alltså långt mer kostnadsdata än ytan visar. Härledningen hämtas per order när någon öppnar
    // arbetsordern.
    //
    // Ordrar som inte gick att räkna SAKNAS i svaret i stället för att stå som noll — anropsstället
    // ska kunna skilja "vet inte" från "inget".
    const items: Record<
      string,
      {
        plan_tg1: number | null;
        plan_tb1: number | null;
        plan_tb2: number | null;
        actual_tg1: number | null;
        actual_tb1: number | null;
        actual_tb2: number | null;
      }
    > = {};

    for (const row of rows) {
      const id = row.id as string;
      const plan = plans.get(id);
      const actual = actuals.get(id);
      if (!plan && !actual) continue;
      items[id] = {
        plan_tg1: plan?.tg1 ?? null,
        plan_tb1: plan?.tb1 ?? null,
        plan_tb2: plan?.tb2 ?? null,
        actual_tg1: actual?.tg1 ?? null,
        actual_tb1: actual?.tb1 ?? null,
        actual_tb2: actual?.tb2 ?? null,
      };
    }

    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'crm_margins_unexpected', e?.message || 'Failed to compute margins');
  }
}
