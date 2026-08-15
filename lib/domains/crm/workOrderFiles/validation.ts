// Validering av filer på arbetsordern. Sidoeffektfri med flit — den körs på två ställen (på det
// PÅSTÅDDA innan vi myntar en upload-URL, och på det FAKTISKA när vi läser objektet ur storage
// efteråt) och enhetstestas fristående.
//
// Speglar validateScreenshot i lib/domains/support/schemas.ts, med tre skillnader: PDF är tillåtet
// (ritningen är hela poängen), taket är högre (en arkitektritning är inte en skärmdump), och gif
// är borta (ingen har bett om animerade bilder på ett jobb).

// 25 MB. En okomprimerad ritning ligger typiskt på 5-20 MB; bilder komprimeras på klienten till
// ~2 MB innan de går iväg. Taket finns för att en felvald fil ska stoppas, inte för att strypa
// riktiga ritningar. Byten passerar aldrig våra funktioner (klienten laddar upp direkt till
// lagringen med en signerad URL), så taket är en produktregel och inte en plattformsgräns.
export const WORK_ORDER_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const WORK_ORDER_FILE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

const ALLOWED_EXTENSION_RE = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;
const TYPE_ERROR = 'Bara bilder (jpg, png, webp, heic) och PDF kan laddas upp.';

export function validateWorkOrderFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size === 0) return 'Filen är tom.';
  if (file.size > WORK_ORDER_FILE_MAX_BYTES) return 'Filen är för stor (max 25 MB).';

  // Vissa mobilbrowsers skickar tom type för HEIC — fall tillbaka på filändelsen. Utan den här
  // grenen kan en installatör inte ladda upp från iPhone alls.
  const type = (file.type || '').toLowerCase();
  if (type) {
    if (!WORK_ORDER_FILE_CONTENT_TYPES.includes(type as (typeof WORK_ORDER_FILE_CONTENT_TYPES)[number])) {
      return TYPE_ERROR;
    }
    return null;
  }

  if (!ALLOWED_EXTENSION_RE.test(file.name)) return TYPE_ERROR;
  return null;
}

// Styr om raden får en signerad miniatyr-URL i listsvaret. PDF renderas som ikon och signeras
// först vid klick — annars signerar vi N URL:er som ingen tittar på.
//
// HEIC räknas INTE som förhandsvisbar: Chrome och Firefox på desktop renderar inte HEIC i <img>,
// så en miniatyr hade blivit en trasig bildikon. Klienten konverterar normalt HEIC till JPEG före
// uppladdning; en HEIC som ändå tagit sig hit visas som filkort.
export function isPreviewableImage(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}
