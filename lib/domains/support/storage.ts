import type { SupabaseClient } from '@supabase/supabase-js';

// Skärmbildslagring för appärenden.
//
// VARFÖR INGEN EGEN BUCKET: den befintliga bucketen används redan med prefix per område
// (Documents/, Egenkontroller/) och all läsning sker via signerade URL:er som servern skapar med
// service-role-nyckeln. En ny bucket hade krävt egna storage-policyer utan att ge något — åtkomsten
// gatas ändå av app_tickets-RLS innan URL:en signeras. Namnet sparas per rad i DB
// (screenshot_bucket), så en framtida flytt inte gör gamla rader olästbara.

const SCREENSHOT_PREFIX = 'Support';

// Signerad URL:s livstid. Kort med flit — den passerar genom ett JSON-svar och hamnar i
// webbläsarhistorik/loggar; en halvtimme räcker gott för att titta på en bild i ett ärende.
const SIGNED_URL_TTL_SECONDS = 60 * 30;

export function getSupportBucket(): string {
  return process.env.SUPABASE_SUPPORT_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

// Samma teckenregler som dokumentbiblioteket (app/api/documents/_util.ts) — duplicerad med flit:
// domänlagret ska inte importera ur app/api. Tar bort sökvägstecken och allt utanför [A-Za-z0-9_.-]
// (åäö blir `_`, precis som i dokumentbiblioteket) så storage-nyckeln blir ren ASCII. Filnamnet är
// bara kosmetik — ärendet bär all visningsinformation — så förlusten kostar ingenting.
export function sanitizeScreenshotName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+\./g, '.')
    .replace(/[^\w.-]+/g, '_')
    .trim();
  return cleaned.slice(0, 120) || 'skarmbild';
}

export function buildScreenshotPath(fileName: string, uid: string): string {
  return `${SCREENSHOT_PREFIX}/${uid}-${sanitizeScreenshotName(fileName)}`;
}

// Laddar upp skärmbilden och returnerar var den hamnade. Anropas FÖRE raden skapas, så en
// misslyckad uppladdning aldrig lämnar ett ärende med en trasig bildreferens. Blir insert:en fel
// efteråt städar anroparen bort objektet (removeScreenshot).
export async function uploadScreenshot(
  admin: SupabaseClient,
  file: { name: string; type: string; bytes: Buffer | Uint8Array },
): Promise<{ bucket: string; path: string; error: { message: string } | null }> {
  const bucket = getSupportBucket();
  const path = buildScreenshotPath(file.name, crypto.randomUUID());

  const { error } = await admin.storage.from(bucket).upload(path, file.bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  return { bucket, path, error: error ? { message: error.message } : null };
}

// Best-effort städning. Ett kvarglömt objekt är skräp, inte ett fel användaren ska se.
export async function removeScreenshot(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
    /* ignoreras med flit */
  }
}

// Kortlivad läs-URL. Anroparen MÅSTE ha gatat åtkomsten först (RLS-läsningen av raden) — den här
// funktionen använder service-role och frågar inte vem som tittar.
export async function getScreenshotUrl(
  admin: SupabaseClient,
  bucket: string | null,
  path: string | null,
): Promise<string | null> {
  if (!bucket || !path) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
