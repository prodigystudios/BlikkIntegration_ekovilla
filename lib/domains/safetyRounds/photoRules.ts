import type { SafetyRoundPhoto } from './types';

// Fotonas regler — rena, utan lagringsanrop, så att både rutterna och telefonens formulär kan
// importera dem. Lagringen själv bor i photoStorage.ts (bara servern).

/** Egen privat bucket — se supabase/sql/20260925_safety_round_photos.sql. */
export const SAFETY_ROUND_PHOTO_BUCKET = 'safety-round-photos';

export const PHOTO_CONTENT_TYPE = 'image/jpeg';

/** Taket per objekt i lagringen (bucketens file_size_limit). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Den lilla varianten ska vara liten — det är den som bäddas in i PDF:en. */
export const PRINT_PHOTO_MAX_BYTES = 400 * 1024;

/**
 * Taket per rond. Protokollet ska rymma alla foton (PDF-svaret får inte passera Vercels 4,5 MB), och
 * en rond med fler än så är snarare en fotodokumentation än en skyddsrond.
 */
export const MAX_PHOTOS_PER_ROUND = 30;

/**
 * Bildbudgeten i PDF:en. Svaret får vara högst 4,5 MB; typsnitt, loggor och text tar ett par hundra
 * kB. Ryms inte alla foton inom budgeten listas de som inte kom med (selectPhotosForPdf).
 */
export const PDF_PHOTO_BUDGET_BYTES = 3_800_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FULL_NAME_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/;

// Sökvägen bär BÅDE ronden och uppladdaren: <round_id>/<uploader_id>/<uuid>.jpg (+ .print.jpg).
// Uppladdarsegmentet är en spärr, samma skäl som arbetsorderns filer: en sökväg går att läsa ut ur
// en signerad URL och spela tillbaka till bekräftelsesteget. Med någon annans id i sökvägen passerar
// den aldrig isSafetyRoundPhotoPath för den som skickar den.
export function buildPhotoPaths(roundId: string, uploaderId: string, uid: string): { full: string; print: string } {
  const base = `${roundId}/${uploaderId}/${uid}`;
  return { full: `${base}.jpg`, print: `${base}.print.jpg` };
}

/**
 * Är sökvägen en FULL fotosökväg i den här ronden, uppladdad av den här användaren? Allt en klient
 * skickar tillbaka är ett påstående tills det kontrollerats — anropas på VARJE väg som tar emot en
 * sökväg utifrån. Svarar med den lilla variantens sökväg (härledd, aldrig tagen ur kroppen).
 */
//
// Bara FASTA reguljära uttryck: rond-id:t kommer ur URL:en, och ett RegExp byggt av det hade varit
// en regex-injektion (CodeQL). Prefixet jämförs som text.
export function parsePhotoPath(path: string, roundId: string, uploaderId: string): { full: string; print: string } | null {
  if (typeof path !== 'string' || !UUID_RE.test(roundId) || !UUID_RE.test(uploaderId)) return null;
  const prefix = `${roundId}/${uploaderId}/`;
  if (!path.startsWith(prefix)) return null;
  const match = FULL_NAME_RE.exec(path.slice(prefix.length));
  return match ? buildPhotoPaths(roundId, uploaderId, match[1]) : null;
}

/** Objektets faktiska storlek och typ, lästa ur lagringen, mot taket. null = godkänd. */
export function validatePhotoObject(info: { size: number; contentType: string | null }, maxBytes: number): string | null {
  if (info.contentType !== PHOTO_CONTENT_TYPE) return 'Bara JPEG-bilder kan sparas.';
  if (info.size <= 0) return 'Bilden är tom.';
  if (info.size > maxBytes) return `Bilden är för stor (högst ${Math.round(maxBytes / 1024)} kB).`;
  return null;
}

/**
 * Fotona per punkt, i nummerordning. EN källa till grupperingen — formuläret, handlingsplanen och
 * protokollet läser alla härifrån, så ordningen aldrig kan gå isär.
 *
 * (Numret sätts av add_safety_round_photo() ur en räknare på ronden som bara går uppåt — ett
 * borttaget fotos nummer ges aldrig till ett annat foto. Därför räknar koden aldrig fram ett nummer.)
 */
export function photosByItem<P extends Pick<SafetyRoundPhoto, 'item_id' | 'photo_no'>>(photos: readonly P[]): Map<string, P[]> {
  const byItem = new Map<string, P[]>();
  for (const photo of [...photos].sort((a, b) => a.photo_no - b.photo_no)) {
    byItem.set(photo.item_id, [...(byItem.get(photo.item_id) ?? []), photo]);
  }
  return byItem;
}

/** Fotonumren per punkt, i nummerordning. */
export function photoNumbersByItem(photos: ReadonlyArray<Pick<SafetyRoundPhoto, 'item_id' | 'photo_no'>>): Map<string, number[]> {
  return new Map([...photosByItem(photos)].map(([itemId, list]) => [itemId, list.map((p) => p.photo_no)]));
}

/** "Foto 3" / "Foto 1, 2, 5" — mallens hänvisning. Tom sträng utan foton. */
export function formatPhotoRefs(numbers: readonly number[]): string {
  if (numbers.length === 0) return '';
  return `Foto ${numbers.join(', ')}`;
}

/**
 * Vilka foton ryms i PDF:en? I nummerordning tills budgeten tar slut; resten listas i protokollet
 * ("finns i appen") i stället för att fälla hela PDF:en. Storleken är den LILLA variantens, som
 * redan står på raden — inget behöver hämtas för att bestämma det.
 */
export function selectPhotosForPdf<P extends Pick<SafetyRoundPhoto, 'photo_no' | 'print_size_bytes'>>(
  photos: readonly P[],
  budgetBytes = PDF_PHOTO_BUDGET_BYTES,
): { embed: P[]; omitted: P[] } {
  const embed: P[] = [];
  const omitted: P[] = [];
  let used = 0;
  for (const photo of [...photos].sort((a, b) => a.photo_no - b.photo_no)) {
    if (omitted.length === 0 && used + photo.print_size_bytes <= budgetBytes) {
      embed.push(photo);
      used += photo.print_size_bytes;
    } else {
      omitted.push(photo);
    }
  }
  return { embed, omitted };
}
