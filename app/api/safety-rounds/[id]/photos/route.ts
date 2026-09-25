import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import {
  MAX_PHOTOS_PER_ROUND,
  PHOTO_MAX_BYTES,
  PRINT_PHOTO_MAX_BYTES,
  nextPhotoNo,
  parsePhotoPath,
  validatePhotoObject,
} from '@/lib/domains/safetyRounds/photoRules';
import { readPhotoInfo, removePhotoObjects, signPhotoUrls } from '@/lib/domains/safetyRounds/photoStorage';
import { photoConfirmSchema } from '@/lib/domains/safetyRounds/schemas';
import { findPhotoByPath, insertPhoto, listPhotos } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { insertFailure } from '../../_lib';

// Steg 3 av 3: telefonen har laddat upp båda varianterna och rapporterar var den fulla hamnade.
//
// ALLT I KROPPEN ÄR ETT PÅSTÅENDE. Upload-token binder bara sökvägen, så den här routen är
// försvaret:
//   1. sökvägen måste vara <denna rond>/<den här användaren>/<uuid>.jpg — den lilla variantens
//      sökväg härleds ur den, aldrig ur kroppen,
//   2. sökvägen får inte redan vara registrerad (409) — då tillhör objektet en rad,
//   3. storlek och typ läses ur LAGRINGEN.
//
// ⚠️ STÄDNINGEN ÄR DESTRUKTIV och får bara röra objekt som den här användaren själv just laddat upp.
// Kontroll 1 och 2 är det som gör den ofarlig — ta inte bort någon av dem.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

/** Försök igen om två foton fick samma nummer samtidigt (det unika villkoret på round_id + photo_no). */
const NUMBER_RETRIES = 3;

export async function POST(req: Request, context: RouteContext) {
  let cleanup: string[] = [];
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response || !guard.currentUser) return guard.response;
    const user = guard.currentUser;

    const roundId = context.params.id;
    const badId = invalidUuidParam(roundId);
    if (badId) return badId;

    const parsed = photoConfirmSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const paths = parsePhotoPath(parsed.data.storage_path, roundId, user.id);
    if (!paths) return routeError(400, 'safety_round_photo_path_invalid', 'Fotot hör inte till den här ronden.');

    const supabase = createRouteHandlerClient({ cookies });

    // Redan registrerad? Svara innan `cleanup` sätts, så ingen felgren kan städa bort någon annans fil.
    const { data: existing } = await findPhotoByPath(supabase, paths.full);
    if (existing) return routeError(409, 'safety_round_photo_already_registered', 'Fotot är redan sparat.');

    cleanup = [paths.full, paths.print];
    const admin = getSupabaseAdmin();

    const [fullInfo, printInfo] = await Promise.all([readPhotoInfo(admin, paths.full), readPhotoInfo(admin, paths.print)]);
    if (!fullInfo || !printInfo) {
      await removePhotoObjects(admin, cleanup);
      cleanup = [];
      return routeError(400, 'safety_round_photo_missing_object', 'Uppladdningen kom aldrig fram. Försök igen.');
    }
    const invalid = validatePhotoObject(fullInfo, PHOTO_MAX_BYTES) ?? validatePhotoObject(printInfo, PRINT_PHOTO_MAX_BYTES);
    if (invalid) {
      await removePhotoObjects(admin, cleanup);
      cleanup = [];
      return routeError(400, 'safety_round_photo_invalid', invalid);
    }

    for (let attempt = 1; attempt <= NUMBER_RETRIES; attempt += 1) {
      const { data: photos, error: listError } = await listPhotos(supabase, roundId);
      if (listError) throw new Error(listError.message);
      if ((photos ?? []).length >= MAX_PHOTOS_PER_ROUND) {
        await removePhotoObjects(admin, cleanup);
        cleanup = [];
        return routeError(409, 'safety_round_photo_limit', `Ronden har redan ${MAX_PHOTOS_PER_ROUND} foton, som är taket.`);
      }

      const { data, error } = await insertPhoto(supabase, {
        // Ronden ur rutt-parametern, aldrig ur kroppen. Punkten måste höra till SAMMA rond — den
        // sammansatta nyckeln i databasen avgör (23503 nedan).
        round_id: roundId,
        item_id: parsed.data.item_id,
        photo_no: nextPhotoNo(photos ?? []),
        storage_path: paths.full,
        print_path: paths.print,
        size_bytes: fullInfo.size,
        print_size_bytes: printInfo.size,
        created_by: user.id,
        created_by_name: user.name || 'Okänd',
      });

      if (data) {
        cleanup = [];
        const urls = await signPhotoUrls(admin, [data.storage_path]);
        return ok({ photo: data, url: urls.get(data.storage_path) ?? null }, 201);
      }

      const code = (error as { code?: string } | null)?.code;
      const message = error?.message ?? '';
      // Två foton samtidigt fick samma nummer — räkna om och försök igen.
      if (code === '23505' && message.includes('safety_round_photos_no_uniq') && attempt < NUMBER_RETRIES) continue;
      // Sökvägen registrerades av någon annan under tiden: objektet tillhör deras rad — städa inte.
      if (code === '23505' && !message.includes('safety_round_photos_no_uniq')) {
        cleanup = [];
        return routeError(409, 'safety_round_photo_already_registered', 'Fotot är redan sparat.');
      }
      await removePhotoObjects(admin, cleanup);
      cleanup = [];
      if (code === '23503') return routeError(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');
      return insertFailure(error, 'fotot');
    }

    await removePhotoObjects(admin, cleanup);
    cleanup = [];
    return routeError(409, 'safety_round_photo_conflict', 'Flera foton sparades samtidigt. Försök igen.');
  } catch (e: unknown) {
    console.error('[safety-rounds] foto, bekräfta:', e instanceof Error ? e.stack ?? e.message : e);
    if (cleanup.length > 0) await removePhotoObjects(getSupabaseAdmin(), cleanup).catch(() => undefined);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte spara fotot.');
  }
}
