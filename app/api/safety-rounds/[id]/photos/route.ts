import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { registerUploadedPhoto, signedPhotoUrls } from '@/lib/domains/safetyRounds/photos';
import { photoConfirmSchema } from '@/lib/domains/safetyRounds/schemas';
import { listPhotos } from '@/lib/domains/safetyRounds/store';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireSafetyRoundReader } from '../../_lib';

// Rondens foton.
//   GET  — nya läs-URL:er (de signerade gäller i 30 minuter). Formuläret hämtar BARA dem när de
//          börjar bli gamla, i stället för att läsa om hela ronden och skriva över det man håller på med.
//   POST — steg 3 av 3: registrera en uppladdad bild (registerUploadedPhoto i photos.ts).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const guard = await requireSafetyRoundReader();
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    // Raderna läses med sessionen (RLS) — först DÅ signeras URL:erna med service-rollen.
    const { data, error } = await listPhotos(createRouteHandlerClient({ cookies }), context.params.id);
    if (error) return routeError(500, 'safety_round_photo_failed', error.message);
    return ok({ photo_urls: await signedPhotoUrls(getSupabaseAdmin(), data ?? []) });
  } catch (e: unknown) {
    console.error('[safety-rounds] foto-URL:er:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte hämta fotona.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response || !guard.currentUser) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = photoConfirmSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await registerUploadedPhoto(
      { supabase: createRouteHandlerClient({ cookies }), admin: getSupabaseAdmin() },
      { roundId: context.params.id, userId: guard.currentUser.id, itemId: parsed.data.item_id, storagePath: parsed.data.storage_path },
    );
    if (!result.ok) return routeError(result.status, result.code, result.message);
    return ok({ photo: result.photo, url: result.url }, 201);
  } catch (e: unknown) {
    console.error('[safety-rounds] foto, bekräfta:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_photo_unexpected', 'Kunde inte spara fotot.');
  }
}
