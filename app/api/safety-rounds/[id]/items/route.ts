import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { customItemCreateSchema } from '@/lib/domains/safetyRounds/schemas';
import { ITEMS, insertCustomItem, listChecklistCategories, nextPosition } from '@/lib/domains/safetyRounds/store';
import { writeFailure } from '../../_lib';

// Lägg till en EGEN punkt i checklistan ("Lägg till fler risker…"). Katalogens punkter kommer in när
// ronden startas; härifrån går bara egna punkter, och insert-policyn kräver catalog_item_id = null.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const roundId = context.params.id;
    const badId = invalidUuidParam(roundId);
    if (badId) return badId;

    const parsed = customItemCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Kategorins rubrik snapshottas ur katalogen, inte ur kroppen.
    const categories = await listChecklistCategories(supabase);
    if (categories.error) return routeError(500, 'safety_round_item_failed', categories.error.message);
    const category = (categories.data ?? []).find((c) => c.code === parsed.data.category_code);
    if (!category) return routeError(400, 'safety_round_invalid', 'Okänd kategori.');

    const position = await nextPosition(supabase, ITEMS, roundId);
    if (position.error || position.data == null) {
      return routeError(500, 'safety_round_item_failed', position.error?.message || 'Kunde inte lägga till punkten.');
    }

    const { data, error } = await insertCustomItem(supabase, {
      round_id: roundId,
      category_code: category.code,
      category_label: category.label,
      text: parsed.data.text,
      position: position.data,
    });
    if (error || !data) {
      if (error?.code === '42501') return routeError(409, 'safety_round_locked', 'Ronden är slutförd. Checklistan kan inte ändras.');
      if (error?.code === '23503') return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
      return writeFailure(error, 'punkten');
    }
    return ok({ item: data }, 201);
  } catch (e: unknown) {
    console.error('[safety-rounds] ny punkt:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_item_unexpected', 'Kunde inte lägga till punkten.');
  }
}
