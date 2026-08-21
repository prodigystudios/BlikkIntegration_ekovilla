import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { invalidUuidParam, routeError } from '@/lib/api/responses';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { loadInfoFileSource } from '@/lib/domains/info-page/queries';
import { SIGNED_URL_TTL_SECONDS, toDownloadUrl } from '@/lib/domains/info-page/storage';

// nodejs: omsigneringen sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/info/files/[id]   (?download=1)
// 302 till en FÄRSK signerad url.
//
// 🧨 Varför rutten finns: sidan renderas på servern och signerar varje fil då, men PDF-visaren
// hämtar ingenting förrän dragspelet öppnats. En signerad url lever 30 minuter, och en PWA på
// en telefon ligger kvar öppen betydligt längre än så — nästa morgon hade varje pdf mötts av
// "kunde inte visas", och reservlänken "öppna i webbläsaren" hade pekat på samma döda adress.
// Den här rutten signerar om vid varje anrop, så länken går aldrig ut. Samma form och samma
// skäl som arbetsorderfilernas ?redirect=1.
//
// Bilderna använder den INTE: de hämtas direkt vid sidladdningen, medan urlen är färsk, och en
// rutt per bild hade blivit ett funktionsanrop per miniatyr.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  try {
    // Sessionsklienten läser raden: RLS avgör vem som får se den. Först därefter signerar vi.
    const file = await loadInfoFileSource(createRouteHandlerClient({ cookies }), params.id);
    if (!file) return routeError(404, 'info_file_not_found', 'Filen hittades inte.');

    // De seedade raderna pekar på en fil som redan ligger publikt i appen.
    if (file.publicPath) {
      // 🧨 `//host` OCH `/\host` är båda protokollrelativa — new URL('/\\evil.com', origin) blir
      // https://evil.com/. En vidarebefordran som inte vaktar det är en öppen redirect, även när
      // värdet bara kan skrivas av en administratör.
      const isInternal = file.publicPath.startsWith('/') && !/^\/[/\\]/.test(file.publicPath);
      if (!isInternal) return routeError(400, 'info_file_bad_path', 'Filens sökväg är ogiltig.');
      return NextResponse.redirect(new URL(file.publicPath, req.url), { status: 302 });
    }

    if (!file.bucket || !file.path) {
      return routeError(404, 'info_file_missing_object', 'Filen saknar innehåll.');
    }

    const admin = getOptionalSupabaseAdmin();
    if (!admin) return routeError(500, 'service_role_missing', 'service role not configured');

    const { data, error } = await admin.storage.from(file.bucket).createSignedUrl(file.path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return routeError(500, 'info_file_sign_failed', 'Kunde inte skapa en länk till filen.');
    }

    const wantsDownload = new URL(req.url).searchParams.get('download') === '1';
    return NextResponse.redirect(wantsDownload ? toDownloadUrl(data.signedUrl) : data.signedUrl, { status: 302 });
  } catch (error: any) {
    return routeError(500, 'info_file_unexpected', error?.message || 'unexpected_error');
  }
}
