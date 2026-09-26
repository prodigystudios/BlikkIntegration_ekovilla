import { createSessionClient } from '@/lib/supabase/session';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { preparePhotoUpload } from '@/lib/domains/safetyRounds/photos';
import { photoUploadUrlSchema } from '@/lib/domains/safetyRounds/schemas';
import { getSupabaseAdmin } from '@/lib/supabase/server';

// Steg 1 av 3 i en fotouppladdning: två engångs-URL:er (full bild + liten till PDF:en). Ingen rad
// skapas här — se preparePhotoUpload i lib/domains/safetyRounds/photos.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response || !guard.currentUser) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = photoUploadUrlSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await preparePhotoUpload(
      { supabase: createSessionClient(), admin: getSupabaseAdmin() },
      { roundId: context.params.id, userId: guard.currentUser.id, itemId: parsed.data.item_id },
    );
    if (!result.ok) return routeError(result.status, result.code, result.message);
    return ok({ bucket: result.bucket, full: result.full, print: result.print });
  } catch (e: unknown) {
    console.error('[safety-rounds] foto, uppladdnings-URL:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte förbereda uppladdningen.');
  }
}
