import type { SupabaseClient } from '@supabase/supabase-js';

// Lagring för filerna på /dokument-information.
//
// "images" i namnen är tabellens: raderna bor i info_section_images, som sedan 2026-08-21 även
// bär pdf:er (se supabase/sql/20260821_info_section_files.sql). Namnen följer databasen med
// flit — att döpa om helperna men inte tabellen hade gett två vokabulärer för samma rad.
//
// INGEN EGEN BUCKET, av samma skäl som arbetsorderfilerna och appärendena: den befintliga
// bucketen används redan med ett prefix per område (Documents/, Egenkontroller/, Support/,
// Arbetsorder/), och läsningen sker via signerade URL:er som servern skapar med
// service-role-nyckeln. En egen bucket hade krävt egna storage-policyer utan att ge något —
// åtkomsten gatas av info_section_images-RLS innan URL:en signeras. Bucketnamnet sparas per
// rad så en framtida flytt inte gör gamla rader oläsbara.

const INFO_IMAGE_PREFIX = 'Info';

// Samma korta livstid som dokumentbiblioteket, appärendena och arbetsorderfilerna. URL:en
// passerar genom ett JSON-svar och hamnar i webbläsarhistorik och loggar.
export const SIGNED_URL_TTL_SECONDS = 60 * 30;

export function getInfoImageBucket(): string {
  return process.env.SUPABASE_INFO_IMAGES_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

// Samma teckenregler som de tre andra områdena — duplicerad med flit: domänlagret ska inte
// importera ur app/api, och de andra domänerna är inte våra att bero på. Storage-nyckeln blir
// ren ASCII; det riktiga namnet bor i file_name, så förlusten är bara kosmetisk i sökvägen.
export function sanitizeInfoImageName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+\./g, '.')
    .replace(/[^\w.-]+/g, '_')
    .trim();
  return cleaned.slice(0, 120) || 'bild';
}

// Sökvägen bär sektionen: Info/<section_id>/<uuid>-<sanerat namn>. Att den är gissningsbar
// spelar ingen roll — objektet nås bara via en signerad URL som servern skapar efter att
// RLS släppt igenom raden.
export function buildInfoImagePath(sectionId: string, fileName: string, uniqueId: string): string {
  return `${INFO_IMAGE_PREFIX}/${sectionId}/${uniqueId}-${sanitizeInfoImageName(fileName)}`;
}

/**
 * Är sökvägen en som VI reserverade för just den här sektionen?
 *
 * 🧨 Registreringsrutten tar emot en sökväg från klienten, och servern signerar den sedan med
 * service-role — utan den här kontrollen kunde en rad peka på vilket objekt som helst i
 * bucketen (Arbetsorder/, Documents/, Support/). Eftersom info_section_images_select släpper
 * igenom VARJE inloggad hade en privat arbetsorderritning då blivit synlig för alla på
 * /dokument-information. Samma vakt som arbetsorderfilerna har, av samma skäl: den ska anropas
 * på varje väg som tar emot en sökväg utifrån.
 */
export function isInfoImagePath(sectionId: string, path: string): boolean {
  if (!sectionId || !path) return false;
  // Inget `..` någonstans, ingen inledande separator, inga backslash som normaliseras bort
  // längre ned i kedjan.
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  return path.startsWith(`${INFO_IMAGE_PREFIX}/${sectionId}/`);
}

/** Vad sidan gör med raden: visar den som bild, bäddar in den som pdf, eller varken eller. */
export type InfoFileKind = 'image' | 'pdf' | 'other';

// Ändelser vi vågar sätta i en <img>. `svg` står MEDVETET inte här: en svg är ett
// skriptdokument, och den serveras inline från storage-ursprunget — samma ursprung som
// Supabase-API:et. Den enda bildtypen vi tjänar på att kunna visa är den ingen laddar upp.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif']);

function extensionOf(nameOrPath: string | null | undefined): string {
  const clean = String(nameOrPath || '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

/**
 * Bild, pdf eller något vi inte tänker visa?
 *
 * MIME-typen först, filändelsen som skyddsnät. Båda behövs:
 *   - content_type är null på varje rad som skrevs före 2026-08-21 och på de seedade, och en
 *     webbläsare skickar ibland tom typ eller application/octet-stream för en fil som valts
 *     ur ett moln-lager i stället för ur filsystemet.
 *   - ändelsen ensam är en gissning som en döpt fil kan ljuga om.
 *
 * Används på BÅDA sidorna av gränsen: uppladdningen släpper bara igenom det som inte blir
 * 'other', och läsvägen väljer renderare på samma svar. Att det är en och samma funktion är
 * poängen — annars kan en fil bli uppladdningsbar men orenderbar.
 */
export function resolveFileKind(
  contentType: string | null | undefined,
  nameOrPath: string | null | undefined,
): InfoFileKind {
  const type = String(contentType || '').trim().toLowerCase().split(';')[0].trim();

  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'image';

  const ext = extensionOf(nameOrPath);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'other';
}

/**
 * Nedladdningsvarianten av en redan signerad URL.
 *
 * 🧨 Signeringen sker numera UTAN `download`, och det är inte en detalj: en URL med
 * `Content-Disposition: attachment` går inte att bädda in — webbläsaren laddar ned pdf:en i
 * stället för att visa den, så inbäddningen på sidan hade blivit en nedladdning per sidladdning.
 *
 * `download` är inte en del av det signerade: token signerar bucket + sökväg, parametern läses
 * av storage när den svarar. Därför räcker EN signering till både inbäddningen och länken —
 * det här är exakt vad supabase-js självt gör när man ber om `{ download: true }`.
 *
 * Behövs för att html-attributet `download` ignoreras av webbläsaren när adressen ligger på ett
 * annat ursprung, och en signerad storage-url gör alltid det.
 */
export function toDownloadUrl(url: string): string {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=`;
}

// Batch-signering: ETT anrop för alla sökvägar i stället för N. createSignedUrls returnerar ett
// `error` PER RAD — en bild vars objekt saknas ska rendera som en trasig ruta, inte fälla hela
// sidan för alla. URL:erna är inline (se toDownloadUrl ovan).
export async function signInfoImageUrls(
  admin: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return urls;

  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

// Signerad UPPLADDNINGS-url. Klienten lägger filen direkt i storage i stället för att skicka
// den genom rutthanteraren — samma väg som arbetsorderfilerna tar, och den som gör att en
// stor bild inte kan slå i request-gränsen på vägen upp.
export async function createInfoImageUploadUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ path: string; token: string } | null> {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.token) return null;
  return { path: data.path ?? path, token: data.token };
}

// Tar bort objektet. Anropas när en bildrad raderas; misslyckas den blir objektet en föräldralös
// fil i bucketen, vilket är ofarligt och billigare än att låta raderingen i gränssnittet fallera.
export async function removeInfoImageObject(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<void> {
  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
    /* föräldralös fil är acceptabelt; raden är det som styr vad sidan visar */
  }
}
