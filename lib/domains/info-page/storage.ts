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

// Tak för namndelen i storage-nyckeln. Ändelsen räknas in men kapas aldrig bort.
const MAX_NAME_LENGTH = 120;

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
  if (!cleaned) return 'bild';
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  // 🧨 Kapningen får ALDRIG äta ändelsen. Den är det enda läsvägen har att gå på när
  // content_type är null, och uppladdningsvakten kräver att den finns. Ett filnamn på 130
  // tecken hade annars laddats upp (vakten såg filnamnet, med ändelse) och SEDAN avvisats vid
  // registreringen (vakten ser sökvägen, utan ändelse) — med ett övergivet objekt i bucketen
  // och ett felmeddelande som pekar åt fel håll.
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
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
 * Vad MIME-typen säger. `null` betyder "ingen åsikt" — utelämnad eller okänd typ — och är
 * något helt annat än 'other', som är ett uttryckligt nej.
 */
// "Vi vet inte vad det här är." Det är vad en webbläsare svarar för en fil som valts ur ett
// moln-lager i stället för ur filsystemet — inte ett påstående om innehållet.
const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

function kindFromContentType(contentType: string | null | undefined): InfoFileKind | null {
  const type = String(contentType || '').trim().toLowerCase().split(';')[0].trim();
  // Ingen uppgift alls, eller en uttrycklig icke-uppgift: ändelsen får avgöra.
  if (!type || GENERIC_CONTENT_TYPES.has(type)) return null;

  if (type === 'application/pdf') return 'pdf';
  // svg är ett skriptdokument, inte en bild.
  if (type === 'image/svg+xml') return 'other';
  if (type.startsWith('image/')) return 'image';

  // 🧨 En DEKLARERAD typ som inte är en vi visar är ett nej, inte ett "vet inte". Skillnaden
  // är hela vakten: behandlades text/html som "vet inte" räckte det att döpa filen till
  // .pdf för att ta sig förbi.
  return 'other';
}

function kindFromExtension(nameOrPath: string | null | undefined): InfoFileKind {
  const ext = extensionOf(nameOrPath);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'other';
}

/**
 * Hur ska raden VISAS? Tillåtande med flit.
 *
 * Läsvägen tar emot det som redan ligger i databasen och ska välja bästa renderare för det —
 * inklusive rader som skrevs före content_type-kolumnen fanns, rader vars filnamn saknar
 * ändelse (de seedade heter "Lathund Isolering") och rader som handredigerats i Supabase-
 * editorn. Den frågan är INTE samma sak som "får det här laddas upp"; se resolveUploadKind.
 */
export function resolveFileKind(
  contentType: string | null | undefined,
  nameOrPath: string | null | undefined,
): InfoFileKind {
  const byType = kindFromContentType(contentType);
  if (byType && byType !== 'other') return byType;
  if (byType === 'other') return 'other';
  return kindFromExtension(nameOrPath);
}

/**
 * Får filen laddas upp? Strikt med flit.
 *
 * 🧨 Vakten fick först fråga resolveFileKind, och det var fel: den svarar på MIME-typen FÖRST
 * och når aldrig ändelsen. En klient som skickade { fileName: "x.html", contentType:
 * "image/png" } passerade alltså båda stegen, och sökvägen vi reserverade slutade på .html —
 * i en bucket vars SELECT-policy släpper igenom varje inloggad.
 *
 * Därför krävs här att BÅDA pekar åt samma håll: ändelsen måste vara en vi känner igen, och
 * en MIME-typ som säger något annat än ändelsen gör att filen avvisas — då ljuger en av dem
 * och vi vet inte vilken. Resultatet är alltid en delmängd av vad resolveFileKind kan visa,
 * så det som får laddas upp går alltid att rendera.
 *
 * ⚠️ Vad vakten INTE kan: den ser bara det klienten PÅSTÅR. Själva bytesen läggs direkt i
 * storage med en signerad uppladdning, och vilken content-type objektet faktiskt serveras med
 * bestäms där. Vakten krymper ytan, den stänger den inte — det förutsätter att bara admin når
 * hit, vilket rutterna ser till.
 */
export function resolveUploadKind(
  contentType: string | null | undefined,
  nameOrPath: string | null | undefined,
): InfoFileKind {
  const byExtension = kindFromExtension(nameOrPath);
  if (byExtension === 'other') return 'other';

  const byType = kindFromContentType(contentType);
  if (byType !== null && byType !== byExtension) return 'other';
  return byExtension;
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
