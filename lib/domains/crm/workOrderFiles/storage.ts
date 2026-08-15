import type { SupabaseClient } from '@supabase/supabase-js';

// Lagring för arbetsorderfiler.
//
// VARFÖR INGEN EGEN BUCKET: samma svar som för appärendena (lib/domains/support/storage.ts rad
// 5-9). Den befintliga bucketen används redan med prefix per område (Documents/, Egenkontroller/,
// Support/) och all läsning sker via signerade URL:er som servern skapar med service-role-nyckeln.
// En ny bucket hade krävt egna storage-policyer utan att ge något — åtkomsten gatas ändå av
// crm_work_order_files-RLS innan URL:en signeras. Bucketnamnet sparas per rad i DB
// (storage_bucket), så en framtida flytt inte gör gamla rader olästbara.

const WORK_ORDER_FILE_PREFIX = 'Arbetsorder';

// Signerad URL:s livstid. Kort med flit — den passerar genom ett JSON-svar och hamnar i
// webbläsarhistorik och loggar. 30 minuter är samma tid som dokumentbiblioteket och appärendena
// använder; en fjärde TTL i en fjärde modul vore sämre än marginalen den köper.
export const SIGNED_URL_TTL_SECONDS = 60 * 30;

export function getWorkOrderFileBucket(): string {
  return process.env.SUPABASE_WORK_ORDER_FILES_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

// Samma teckenregler som dokumentbiblioteket och appärendena — duplicerad med flit: domänlagret
// ska inte importera ur app/api, och support-domänen är inte vår att bero på. Tar bort
// sökvägstecken och allt utanför [A-Za-z0-9_.-] (åäö blir `_`) så storage-nyckeln blir ren ASCII.
// Filnamnet i DB (file_name) bär det riktiga namnet, så förlusten är bara kosmetisk i sökvägen.
export function sanitizeWorkOrderFileName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+\./g, '.')
    .replace(/[^\w.-]+/g, '_')
    .trim();
  return cleaned.slice(0, 120) || 'fil';
}

// Sökvägen bär BÅDE arbetsordern och uppladdaren:
//   Arbetsorder/<work_order_id>/<uploader_id>/<uuid>-<sanerat namn>
//
// Uppladdarsegmentet är inte bokföring utan en spärr. Sökvägen till en bild går att läsa ut ur den
// signerade URL:en vi skickar till klienten (Supabase signerar `/object/sign/<bucket>/<path>?token`),
// så vad som helst i listan kan spelas tillbaka till bekräftelsesteget. Ligger någon annans id i
// sökvägen kan den aldrig passera isWorkOrderFilePath för den som skickar den, och en läsbehörig
// användare kan därmed inte peka ut kontorets ritning och få den behandlad som sin egen.
export function buildWorkOrderFileDir(workOrderId: string, uploaderId: string): string {
  return `${WORK_ORDER_FILE_PREFIX}/${workOrderId}/${uploaderId}`;
}

export function buildWorkOrderFilePath(
  workOrderId: string,
  uploaderId: string,
  fileName: string,
  uid: string,
): string {
  return `${buildWorkOrderFileDir(workOrderId, uploaderId)}/${uid}-${sanitizeWorkOrderFileName(fileName)}`;
}

// Klienten laddar upp direkt till lagringen och skickar sedan tillbaka sökvägen den fick. Den
// sökvägen är ett PÅSTÅENDE tills vi kontrollerat den: en signerad upload-token binder bara
// sökvägen, och en klient som hittar på en annan sökväg hade kunnat koppla ett Support/- eller
// Documents/-objekt — eller en kollegas fil — till sin egen arbetsorder. Därför den här; den ska
// anropas på VARJE väg som tar emot en sökväg utifrån.
export function isWorkOrderFilePath(path: string, workOrderId: string, uploaderId: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!uploaderId) return false;
  if (path.includes('..')) return false;
  const dir = `${buildWorkOrderFileDir(workOrderId, uploaderId)}/`;
  if (!path.startsWith(dir)) return false;
  // Exakt en nivå under katalogen — inga egna underkataloger.
  return !path.slice(dir.length).includes('/');
}

// Myntar en engångs-URL som klienten laddar upp till. Ingen DB-rad skapas här: raden skrivs först
// när uppladdningen bekräftats, så en avbruten uppladdning aldrig lämnar en rad som pekar på
// ingenting. Motsatt ordning (rad först) hade gett trasiga kort i listan.
export async function createWorkOrderFileUploadUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ signedUrl: string | null; token: string | null; error: { message: string } | null }> {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) return { signedUrl: null, token: null, error: { message: error?.message || 'Kunde inte skapa uppladdningslänk.' } };
  return { signedUrl: data.signedUrl, token: data.token, error: null };
}

// Läser objektets FAKTISKA storlek och mimetype ur lagringen. Det är den enda försvarslinjen mot
// en klient som påstod 2 MB och laddade upp 40 — upload-token bär ingen storleks- eller
// typbindning.
//
// `list(dir, { search })` och inte `.info(path)`: info() bygger /object/info/<bucket>/<path> i
// storage-js 2.7.0, utan `authenticated`-segmentet, och är opålitlig mot en privat bucket.
// list() är dessutom det anrop repot redan använder (app/api/storage/list-all/route.ts).
export async function readWorkOrderFileInfo(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ size: number; contentType: string | null } | null> {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 1, search: name });
  if (error || !data) return null;

  // `search` är en delsträngsmatchning, inte en exakt träff — jämför namnet själv.
  const match = data.find((entry) => entry.name === name);
  if (!match) return null;

  const metadata = (match.metadata || {}) as { size?: number; mimetype?: string };
  return {
    size: typeof metadata.size === 'number' ? metadata.size : 0,
    contentType: metadata.mimetype || null,
  };
}

// Batch-signering för listan: ETT anrop för alla sökvägar i stället för N. createSignedUrls
// returnerar ett `error` PER RAD — en fil vars objekt saknas ger ingen URL, och den raden ska
// renderas som "kunde inte hämtas" i stället för att fälla hela svaret.
export async function signWorkOrderFileUrls(
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

// Enskild läs-URL. Anroparen MÅSTE ha gatat åtkomsten först (RLS-läsningen av raden) — den här
// funktionen använder service-role och frågar inte vem som tittar.
// `downloadName` sätter Content-Disposition: attachment, samma knep som dokumentbiblioteket
// använder för att skilja "förhandsgranska" från "ladda ner" på samma URL-generator.
export async function signWorkOrderFileUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
  downloadName?: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Best-effort städning. Ett kvarglömt objekt är skräp, inte ett fel användaren ska se.
export async function removeWorkOrderFileObject(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
    /* ignoreras med flit */
  }
}
