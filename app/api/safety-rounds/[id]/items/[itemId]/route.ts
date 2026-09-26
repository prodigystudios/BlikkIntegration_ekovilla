import { createSessionClient } from '@/lib/supabase/session';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { itemPatchSchema } from '@/lib/domains/safetyRounds/schemas';
import { removePhotoObjects } from '@/lib/domains/safetyRounds/photoStorage';
import { deleteCustomItem, listItemPhotoPaths, updateItem } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { writeFailure } from '../../../_lib';

// Bedöm en punkt (status, risk, beskrivning …) eller ta bort en EGEN punkt — bara i ett utkast.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; itemId: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.itemId);
    if (badId) return badId;

    const parsed = itemPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createSessionClient();
    const { data, error } = await updateItem(supabase, context.params.id, context.params.itemId, parsed.data);
    if (error || !data) return writeFailure(error, 'punkten');
    return ok({ item: data });
  } catch (e: unknown) {
    console.error('[safety-rounds] bedöm punkt:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_item_unexpected', 'Kunde inte spara punkten.');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.itemId);
    if (badId) return badId;

    // Policyn släpper bara egna punkter (catalog_item_id = null) — en katalogpunkt ger noll rader.
    const supabase = createSessionClient();
    // Punktens foton kaskaderar bort med den; sökvägarna läses först, annars blir objekten kvar. Går
    // de inte att läsa tas punkten inte bort — hellre ett nytt försök än foton som aldrig städas.
    const photoPaths = await listItemPhotoPaths(supabase, context.params.id, context.params.itemId);
    if (photoPaths.error || !photoPaths.data) {
      return routeError(500, 'safety_round_item_failed', photoPaths.error?.message || 'Kunde inte läsa punktens foton.');
    }
    const { data, error } = await deleteCustomItem(supabase, context.params.id, context.params.itemId);
    if (error) return writeFailure(error, 'punkten');
    if (!data) {
      return routeError(409, 'safety_round_item_locked', 'Punkten kan inte tas bort. Mallens punkter bedöms med "Ej relevant" i stället.');
    }
    await removePhotoObjects(getSupabaseAdmin(), photoPaths.data);
    return ok({ id: data.id });
  } catch (e: unknown) {
    console.error('[safety-rounds] ta bort punkt:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_item_unexpected', 'Kunde inte ta bort punkten.');
  }
}
