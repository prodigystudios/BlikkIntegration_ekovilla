import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MAX_PHOTOS_PER_ROUND,
  PHOTO_MAX_BYTES,
  PRINT_PHOTO_MAX_BYTES,
  SAFETY_ROUND_PHOTO_BUCKET,
  buildPhotoPaths,
  parsePhotoPath,
  validatePhotoObject,
} from './photoRules';
import { createPhotoUploadUrls, readPhotoInfo, removePhotoObjects, signPhotoUrls } from './photoStorage';
import { addPhoto, findPhotoByPath, getSafetyRound, itemBelongsToRound, listPhotos } from './store';
import type { SafetyRoundPhoto } from './types';

// Fotonas arbetsflöde — förbered en uppladdning, registrera en uppladdad bild. Rutterna gör bara
// behörighet, tolkning och svar; allt här tar sina klienter som indata och går att testa för sig.
//
//   supabase = SESSIONSKLIENTEN (RLS + auth.uid() i add_safety_round_photo)
//   admin    = service-rollen, BARA mot fotobucketen och bara efter att sessionen prövat åtkomsten

export type PhotoDeps = { supabase: SupabaseClient; admin: SupabaseClient };

export type PhotoFailure = { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): PhotoFailure => ({ ok: false, status, code, message });

const LIMIT_MESSAGE = `Ronden har redan ${MAX_PHOTOS_PER_ROUND} foton, som är taket.`;

/**
 * Steg 1: två engångs-URL:er (full bild + liten till PDF:en). Ingen rad skapas här. Prövningen är
 * den snälla, i förväg — utkast, punkt i ronden, taket — så att telefonen inte laddar upp i onödan;
 * add_safety_round_photo() prövar samma sak igen, under lås, när fotot sparas.
 */
export async function preparePhotoUpload(
  deps: PhotoDeps,
  input: { roundId: string; userId: string; itemId: string },
): Promise<{ ok: true; bucket: string; full: { path: string; token: string }; print: { path: string; token: string } } | PhotoFailure> {
  const { data: round, error: roundError } = await getSafetyRound(deps.supabase, input.roundId);
  if (roundError) return fail(500, 'safety_round_read_failed', roundError.message);
  if (!round) return fail(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
  if (round.status !== 'draft') return fail(409, 'safety_round_locked', 'Ronden är slutförd. Foton kan inte läggas till.');

  const { data: belongs, error: itemError } = await itemBelongsToRound(deps.supabase, input.roundId, input.itemId);
  if (itemError) return fail(500, 'safety_round_photo_failed', itemError.message);
  if (!belongs) return fail(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');

  const { data: photos, error: photosError } = await listPhotos(deps.supabase, input.roundId);
  if (photosError) return fail(500, 'safety_round_photo_failed', photosError.message);
  if ((photos ?? []).length >= MAX_PHOTOS_PER_ROUND) return fail(409, 'safety_round_photo_limit', LIMIT_MESSAGE);

  // Uppladdarens id ligger i sökvägen — spärren som gör att ingen kan spela tillbaka någon annans
  // sökväg till bekräftelsesteget.
  const paths = buildPhotoPaths(input.roundId, input.userId, crypto.randomUUID());
  const { data, error } = await createPhotoUploadUrls(deps.admin, paths);
  if (error || !data) return fail(500, 'safety_round_photo_upload_url_failed', error?.message || 'Kunde inte förbereda uppladdningen.');

  return {
    ok: true,
    bucket: SAFETY_ROUND_PHOTO_BUCKET,
    full: { path: paths.full, token: data.full.token },
    print: { path: paths.print, token: data.print.token },
  };
}

/**
 * Steg 3: telefonen har laddat upp båda varianterna och rapporterar var den fulla hamnade.
 *
 * ALLT I INDATAT ÄR ETT PÅSTÅENDE. Upload-token binder bara sökvägen, så:
 *   1. sökvägen måste vara <rond>/<den här användaren>/<uuid>.jpg (den lilla härleds, tas aldrig emot),
 *   2. storlek och typ läses ur LAGRINGEN,
 *   3. numret, taket, utkastet och "redan sparad" avgörs av add_safety_round_photo() under lås.
 *
 * ⚠️ STÄDNINGEN ÄR DESTRUKTIV. Objekt tas bort bara om sökvägen är användarens egen (1) och INTE
 * är registrerad — och det prövas om i samma ögonblick som städningen görs, eftersom en annan
 * bekräftelse av samma foto (dubbeltryck, nytt försök) kan ha hunnit spara det under tiden. Är svaret
 * osäkert (fel vid uppslaget) städas ingenting: ett kvarglömt objekt är skräp, ett bortstädat
 * registrerat foto är ett trasigt protokoll.
 */
export async function registerUploadedPhoto(
  deps: PhotoDeps,
  input: { roundId: string; userId: string; itemId: string; storagePath: string },
): Promise<{ ok: true; photo: SafetyRoundPhoto; url: string | null } | PhotoFailure> {
  const paths = parsePhotoPath(input.storagePath, input.roundId, input.userId);
  if (!paths) return fail(400, 'safety_round_photo_path_invalid', 'Fotot hör inte till den här ronden.');

  const cleanupIfUnregistered = async () => {
    const { data: registered, error } = await findPhotoByPath(deps.supabase, paths.full);
    if (error || registered) return;
    await removePhotoObjects(deps.admin, [paths.full, paths.print]);
  };

  // Redan registrerad? Då tillhör objekten en rad. Ett fel i uppslaget svaras ut utan städning.
  const { data: existing, error: existingError } = await findPhotoByPath(deps.supabase, paths.full);
  if (existingError) return fail(500, 'safety_round_photo_failed', existingError.message);
  if (existing) return fail(409, 'safety_round_photo_already_registered', 'Fotot är redan sparat.');

  const [fullInfo, printInfo] = await Promise.all([readPhotoInfo(deps.admin, paths.full), readPhotoInfo(deps.admin, paths.print)]);
  if (!fullInfo || !printInfo) {
    await cleanupIfUnregistered();
    return fail(400, 'safety_round_photo_missing_object', 'Uppladdningen kom aldrig fram. Försök igen.');
  }
  const invalid = validatePhotoObject(fullInfo, PHOTO_MAX_BYTES) ?? validatePhotoObject(printInfo, PRINT_PHOTO_MAX_BYTES);
  if (invalid) {
    await cleanupIfUnregistered();
    return fail(400, 'safety_round_photo_invalid', invalid);
  }

  const { data, error } = await addPhoto(deps.supabase, {
    roundId: input.roundId,
    itemId: input.itemId,
    storagePath: paths.full,
    printPath: paths.print,
    sizeBytes: fullInfo.size,
    printSizeBytes: printInfo.size,
  });
  if (data) {
    const urls = await signPhotoUrls(deps.admin, [data.storage_path]);
    return { ok: true, photo: data, url: urls.get(data.storage_path) ?? null };
  }

  // Redan sparat (en annan bekräftelse hann före): objekten tillhör DEN raden — städa inte.
  if (error?.code === '23505') return fail(409, 'safety_round_photo_already_registered', 'Fotot är redan sparat.');

  await cleanupIfUnregistered();
  switch (error?.code) {
    case '42501':
      return fail(403, 'safety_round_forbidden', 'Du har inte behörighet att lägga till foton.');
    case '55000':
      return fail(409, 'safety_round_locked', 'Ronden är slutförd. Foton kan inte läggas till.');
    case '54000':
      return fail(409, 'safety_round_photo_limit', LIMIT_MESSAGE);
    case '23503':
      return fail(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');
    case '22023':
      return fail(400, 'safety_round_photo_path_invalid', 'Fotot hör inte till den här ronden.');
    case 'P0002':
      return fail(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
    default:
      return fail(500, 'safety_round_photo_failed', error?.message || 'Kunde inte spara fotot.');
  }
}

/** Fotonas läs-URL:er per foto-id — signerade EFTER att sessionen (RLS) läst raderna. */
export async function signedPhotoUrls(
  admin: SupabaseClient,
  photos: ReadonlyArray<Pick<SafetyRoundPhoto, 'id' | 'storage_path'>>,
): Promise<Record<string, string | null>> {
  if (photos.length === 0) return {};
  const signed = await signPhotoUrls(admin, photos.map((p) => p.storage_path));
  return Object.fromEntries(photos.map((p) => [p.id, signed.get(p.storage_path) ?? null]));
}
