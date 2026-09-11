import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createStockCount } from '@/lib/domains/planning/stockCounts';
import { ok, routeError, validationError, requirePermission, stockCountSchema } from '../_lib';

// Avstämning av depålagret: "den här dagen stod det X säckar på depån".
//
// Finns för att saldot bara gick att rätta UPPÅT — en leverans kan inte vara negativ och går inte att
// ändra. En depå som visade för många säckar, när blåsta säckar aldrig rapporterats, gick inte att
// rätta alls. Ekovilla inventerar i ett annat system; siffran förs över hit.
//
// planning.depot.manage, INTE schedule.write som leveransregistreringen bredvid. ⚠️ En för högt räknad
// siffra TYSTAR bristbanderollen, och en räkning kan dessutom dölja svinn — det är ett beslut om vad
// som står på depån, inte lagerarbete. Samma nyckel som RLS kräver.
//
// Ingen logActivity, till skillnad från väntade leveranser: leveransregistreringen loggar inte heller,
// och loggen är till för schemaändringar. Räkningen själv är dessutom bara-tillägg och bär
// created_by_name — den ÄR sitt eget spår.
//
// Bara POST. Ingen ändring och ingen borttagning: den senaste räkningen gäller, och en felaktig
// rättas med en ny. Saldot med räkningen läses via depot-stock.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = stockCountSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createStockCount(supabase, {
      depotId: parsed.data.depot_id,
      material: parsed.data.material,
      countedSacks: parsed.data.counted_sacks,
      countedOn: parsed.data.counted_on,
      note: parsed.data.note ?? null,
      actorUserId: gate.currentUser.id,
      // Snapshottat nu, för det går inte att hämta i efterhand: profiles är self-read-only.
      actorName: gate.currentUser.name ?? null,
    });
    if (error) {
      // 23503 = depån finns inte (FK). 42501 = RLS nekade, vilket i praktiken är datumtaket i
      // insert-policyn — Zod har redan prövat nyckeln. Båda på svenska, inte som ett rått databasfel.
      const code = (error as { code?: string }).code;
      if (code === '23503') return routeError(404, 'planning_stock_count_depot_missing', 'Depån finns inte längre');
      if (code === '42501') {
        return routeError(403, 'planning_stock_count_rejected', 'Räkningen nekades — kontrollera att datumet inte ligger i framtiden');
      }
      return routeError(500, 'planning_stock_count_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_stock_count_create_unexpected', e?.message || 'Failed to record stock count');
  }
}
