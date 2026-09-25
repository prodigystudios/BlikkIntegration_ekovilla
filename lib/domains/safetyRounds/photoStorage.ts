import type { SupabaseClient } from '@supabase/supabase-js';

import { SAFETY_ROUND_PHOTO_BUCKET } from './photoRules';

// Fotonas lagring — BARA servern, med service-rollen. Bucketen har inga storage-policyer, så varje
// anrop här förutsätter att anroparen redan gatat åtkomsten: RLS-läsningen av raden (läsa, signera,
// hämta) eller nyckeln + utkastet (ladda upp). Samma mönster som arbetsorderns filer
// (lib/domains/crm/workOrderFiles/storage.ts), men i en egen bucket som /api/storage/* aldrig når.

/** Signerad URL:s livstid — samma 30 minuter som arbetsorderns filer och dokumentbiblioteket. */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 30;

/**
 * Engångs-URL:er för de två varianterna. Ingen rad skapas här: raden skrivs först när uppladdningen
 * bekräftats, så en avbruten uppladdning aldrig lämnar en rad som pekar på ingenting.
 */
export async function createPhotoUploadUrls(
  admin: SupabaseClient,
  paths: { full: string; print: string },
): Promise<{ data: { full: { token: string }; print: { token: string } } | null; error: { message: string } | null }> {
  const bucket = admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET);
  const [full, print] = await Promise.all([bucket.createSignedUploadUrl(paths.full), bucket.createSignedUploadUrl(paths.print)]);
  if (full.error || !full.data || print.error || !print.data) {
    return { data: null, error: { message: full.error?.message || print.error?.message || 'Kunde inte skapa uppladdningslänk.' } };
  }
  return { data: { full: { token: full.data.token }, print: { token: print.data.token } }, error: null };
}

/**
 * Objektets FAKTISKA storlek och typ, ur lagringen. Upload-token binder bara sökvägen — inte storlek
 * eller typ — så det här är försvaret mot en klient som påstod något annat än den laddade upp.
 * `list(dir, { search })` och inte `.info(path)`, av samma skäl som arbetsorderns filer.
 */
export async function readPhotoInfo(admin: SupabaseClient, path: string): Promise<{ size: number; contentType: string | null } | null> {
  const lastSlash = path.lastIndexOf('/');
  const dir = path.slice(0, lastSlash);
  const name = path.slice(lastSlash + 1);
  const { data, error } = await admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET).list(dir, { limit: 10, search: name });
  if (error || !data) return null;
  // `search` är en delsträngsmatchning — "x.jpg" hittar även "x.print.jpg". Jämför exakt.
  const match = data.find((entry) => entry.name === name);
  if (!match) return null;
  const metadata = (match.metadata || {}) as { size?: number; mimetype?: string };
  return { size: typeof metadata.size === 'number' ? metadata.size : 0, contentType: metadata.mimetype || null };
}

/** Läs-URL:er i ETT anrop. En sökväg vars objekt saknas får ingen URL (visas som "kunde inte hämtas"). */
export async function signPhotoUrls(admin: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET).createSignedUrls(paths, PHOTO_SIGNED_URL_TTL_SECONDS);
  if (error || !data) return urls;
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/**
 * Bildernas bytes till PDF:en, fyra åt gången. Ett foto som inte går att hämta saknas i svaret —
 * protokollet ritar en ruta som säger det, i stället för att hela PDF:en fallerar.
 */
export async function downloadPhotos(admin: SupabaseClient, paths: string[]): Promise<Map<string, Uint8Array>> {
  const bytes = new Map<string, Uint8Array>();
  const queue = [...paths];
  const bucket = admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET);
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        try {
          const { data, error } = await bucket.download(path);
          if (!error && data) bytes.set(path, new Uint8Array(await data.arrayBuffer()));
          else console.warn('[safety-rounds] fotot kunde inte hämtas:', path, error?.message);
        } catch (e) {
          console.warn('[safety-rounds] fotot kunde inte hämtas:', path, e instanceof Error ? e.message : e);
        }
      }
    }),
  );
  return bytes;
}

/** Best-effort städning. Ett kvarglömt objekt är skräp i en privat bucket, inte ett fel att visa. */
export async function removePhotoObjects(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET).remove(paths);
    if (error) console.warn('[safety-rounds] foton kunde inte städas bort:', error.message);
  } catch (e) {
    console.warn('[safety-rounds] foton kunde inte städas bort:', e instanceof Error ? e.message : e);
  }
}

/**
 * Allt under <round_id>/ i bucketen — när ett utkast tas bort. Städningen går på PREFIXET, inte på
 * raderna: den tar även med objekt som laddades upp men aldrig bekräftades (fliken stängdes mitt i).
 * Två nivåer: <round_id>/<uppladdare>/<fil>. Best-effort, som all städning här.
 */
export async function removeRoundPhotoObjects(admin: SupabaseClient, roundId: string): Promise<void> {
  try {
    const bucket = admin.storage.from(SAFETY_ROUND_PHOTO_BUCKET);
    const { data: folders, error } = await bucket.list(roundId, { limit: 1000 });
    if (error || !folders) {
      if (error) console.warn('[safety-rounds] rondens foton kunde inte listas:', error.message);
      return;
    }
    const paths: string[] = [];
    for (const folder of folders) {
      const { data: files } = await bucket.list(`${roundId}/${folder.name}`, { limit: 1000 });
      for (const file of files ?? []) paths.push(`${roundId}/${folder.name}/${file.name}`);
    }
    for (let start = 0; start < paths.length; start += 100) {
      await removePhotoObjects(admin, paths.slice(start, start + 100));
    }
  } catch (e) {
    console.warn('[safety-rounds] rondens foton kunde inte städas bort:', e instanceof Error ? e.message : e);
  }
}
