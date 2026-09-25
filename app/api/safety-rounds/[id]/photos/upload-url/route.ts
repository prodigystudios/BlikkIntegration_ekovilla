import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { buildPhotoPaths, MAX_PHOTOS_PER_ROUND, SAFETY_ROUND_PHOTO_BUCKET } from '@/lib/domains/safetyRounds/photoRules';
import { createPhotoUploadUrls } from '@/lib/domains/safetyRounds/photoStorage';
import { photoUploadUrlSchema } from '@/lib/domains/safetyRounds/schemas';
import { getSafetyRound, itemBelongsToRound, listPhotos } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';

// Steg 1 av 3 i en fotouppladdning: två engångs-URL:er (full bild + liten till PDF:en). Här skapas
// INGEN rad — den skrivs först när uppladdningen bekräftats (POST ../photos), så en avbruten
// uppladdning aldrig lämnar en rad som pekar på ingenting.
//
// Prövningen här är den snälla, i förväg: ronden är ett utkast, punkten hör till ronden, taket är
// inte nått. Bekräftelsen och databasen (RLS + den sammansatta nyckeln) prövar samma sak igen.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response || !guard.currentUser) return guard.response;

    const roundId = context.params.id;
    const badId = invalidUuidParam(roundId);
    if (badId) return badId;

    const parsed = photoUploadUrlSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: round, error: roundError } = await getSafetyRound(supabase, roundId);
    if (roundError) return routeError(500, 'safety_round_read_failed', roundError.message);
    if (!round) return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
    if (round.status !== 'draft') return routeError(409, 'safety_round_locked', 'Ronden är slutförd. Foton kan inte läggas till.');

    const { data: belongs, error: itemError } = await itemBelongsToRound(supabase, roundId, parsed.data.item_id);
    if (itemError) return routeError(500, 'safety_round_photo_failed', itemError.message);
    if (!belongs) return routeError(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');

    const { data: photos, error: photosError } = await listPhotos(supabase, roundId);
    if (photosError) return routeError(500, 'safety_round_photo_failed', photosError.message);
    if ((photos ?? []).length >= MAX_PHOTOS_PER_ROUND) {
      return routeError(409, 'safety_round_photo_limit', `Ronden har redan ${MAX_PHOTOS_PER_ROUND} foton, som är taket.`);
    }

    // Uppladdarens id ligger i sökvägen — se buildPhotoPaths. Det är spärren som gör att ingen kan
    // spela tillbaka någon annans sökväg till bekräftelsesteget.
    const paths = buildPhotoPaths(roundId, guard.currentUser.id, crypto.randomUUID());
    const { data, error } = await createPhotoUploadUrls(getSupabaseAdmin(), paths);
    if (error || !data) return routeError(500, 'safety_round_photo_upload_url_failed', error?.message || 'Kunde inte förbereda uppladdningen.');

    return ok({
      bucket: SAFETY_ROUND_PHOTO_BUCKET,
      full: { path: paths.full, token: data.full.token },
      print: { path: paths.print, token: data.print.token },
    });
  } catch (e: unknown) {
    console.error('[safety-rounds] foto, uppladdnings-URL:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte förbereda uppladdningen.');
  }
}
