import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { removePhotoObjects } from '@/lib/domains/safetyRounds/photoStorage';
import { deletePhoto } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { writeFailure } from '../../../_lib';

// Ta bort ett foto — bara i ett utkast (delete-policyn). Raden först, med sessionen: det är RLS som
// avgör. Först när raden är borta städas objekten bort, med service-rollen.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; photoId: string } };

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.photoId);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deletePhoto(supabase, context.params.id, context.params.photoId);
    if (error || !data) return writeFailure(error, 'fotot');

    await removePhotoObjects(getSupabaseAdmin(), [data.storage_path, data.print_path]);
    return ok({ id: context.params.photoId });
  } catch (e: unknown) {
    console.error('[safety-rounds] foto, ta bort:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte ta bort fotot.');
  }
}
