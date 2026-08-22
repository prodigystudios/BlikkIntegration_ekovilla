import type { SupabaseClient } from '@supabase/supabase-js';

// Kvitton på utlägg — lagring, sökvägar och validering.
//
// VARFÖR EN EGEN MODUL OCH INTE crm/workOrderFiles/storage.ts: samma svar som den filen själv ger om
// varför den inte återanvänder dokumentbibliotekets kod. Tid är inte en CRM-yta (nycklarna ligger
// medvetet utanför crm.*), och ett kvitto har andra regler än en ritning — det är alltid EN fil, den
// hör alltid till EN person, och taket är en telefonbild och inte en arkitektritning. Delningen hade
// bundit ihop två ytor som ska kunna ändras var för sig.
//
// VARFÖR INGEN EGEN BUCKET: den befintliga privata bucketen används med prefix per område
// (Documents/, Egenkontroller/, Support/, Arbetsorder/, nu Kvitton/). All läsning sker via en
// kortlivad signerad URL som servern skapar med service-role EFTER att RLS på
// crm_time_compensations gatat raden — en egen bucket hade krävt egna storage-policyer utan att ge
// något. Bucketnamnet sparas per rad, så en framtida flytt inte gör gamla rader olästbara.

const RECEIPT_PREFIX = 'Kvitton';

// Signerad URL:s livstid. Samma 30 minuter som dokumentbiblioteket, appärendena och
// arbetsorderfilerna — en fjärde TTL i en femte modul vore sämre än marginalen den köper. Kort med
// flit: URL:en passerar genom en redirect och hamnar i webbläsarhistoriken.
export const RECEIPT_SIGNED_URL_TTL_SECONDS = 60 * 30;

// 15 MB. Ett kvitto är en telefonbild eller en kvitto-PDF från en app, inte en ritning — klienten
// komprimerar dessutom bilder till ~2 MB innan de går iväg. Taket finns för att en felvald fil ska
// stoppas innan användaren betalat för uppladdningen över mobilnätet.
export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

export const RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

const ALLOWED_EXTENSION_RE = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;
const TYPE_ERROR = 'Kvittot måste vara en bild (jpg, png, webp, heic) eller en PDF.';

export function getReceiptBucket(): string {
  return process.env.SUPABASE_TIME_RECEIPTS_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

// Samma teckenregler som dokumentbiblioteket och arbetsorderfilerna. Tar bort sökvägstecken och allt
// utanför [A-Za-z0-9_.-] (åäö blir `_`) så storage-nyckeln blir ren ASCII. Det riktiga filnamnet bor
// i receipt_name på raden, så förlusten är bara kosmetisk i sökvägen.
export function sanitizeReceiptFileName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+\./g, '.')
    .replace(/[^\w.-]+/g, '_')
    .trim();
  return cleaned.slice(0, 120) || 'kvitto';
}

// Sökvägen bär ÄGAREN, inte utlägget:
//   Kvitton/<user_id>/<uuid>-<sanerat namn>
//
// Utlägget finns nämligen inte än när bilden laddas upp — den anställde fotograferar kvittot medan
// formuläret fylls i, och posten skapas först när hen trycker Lägg till. Att lägga postens id i
// sökvägen hade krävt att raden skapades först, och då hade ett avbrutet formulär lämnat ett tomt
// utlägg i löneunderlaget. En kvarglömd bild utan rad är oändligt mycket ofarligare än en kvarglömd
// rad utan bild.
//
// ⚠️ ÄGARSEGMENTET ÄR SPÄRREN, inte bokföring. Klienten skickar tillbaka sökvägen den fick, och den
// sökvägen är ett PÅSTÅENDE tills isReceiptPath prövat den. Utan ägarsegmentet hade en klient kunnat
// peka ut ett Documents/- eller Arbetsorder/-objekt — eller en kollegas kvitto — och få det kopplat
// till sitt eget utlägg, vilket gör vem som helst till läsare av vad som helst i bucketen.
export function buildReceiptDir(userId: string): string {
  return `${RECEIPT_PREFIX}/${userId}`;
}

export function buildReceiptPath(userId: string, fileName: string, uid: string): string {
  return `${buildReceiptDir(userId)}/${uid}-${sanitizeReceiptFileName(fileName)}`;
}

// Ska anropas på VARJE väg som tar emot en sökväg utifrån. Se ovan om varför.
export function isReceiptPath(path: string, userId: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!userId) return false;
  if (path.includes('..')) return false;
  const dir = `${buildReceiptDir(userId)}/`;
  if (!path.startsWith(dir)) return false;
  // Exakt en nivå under katalogen — inga egna underkataloger.
  return !path.slice(dir.length).includes('/');
}

// Sidoeffektfri, och körs på två ställen: på det PÅSTÅDDA innan vi myntar en upload-URL, och på det
// FAKTISKA när objektet läses ur lagringen efteråt. Bara den andra körningen är en spärr — den
// första sparar användaren en uppladdning som ändå skulle avvisas.
export function validateReceiptFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size === 0) return 'Kvittofilen är tom.';
  if (file.size > RECEIPT_MAX_BYTES) return 'Kvittot är för stort (max 15 MB).';

  // Vissa mobilwebbläsare skickar tom type för HEIC. Utan den här grenen kan en iPhone-användare
  // inte fotografera ett kvitto alls.
  const type = (file.type || '').toLowerCase();
  if (type) {
    if (!RECEIPT_CONTENT_TYPES.includes(type as (typeof RECEIPT_CONTENT_TYPES)[number])) return TYPE_ERROR;
    return null;
  }

  if (!ALLOWED_EXTENSION_RE.test(file.name)) return TYPE_ERROR;
  return null;
}

// Myntar en engångs-URL som klienten laddar upp till. Ingen databasrad skapas här.
export async function createReceiptUploadUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ signedUrl: string | null; token: string | null; error: { message: string } | null }> {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    return { signedUrl: null, token: null, error: { message: error?.message || 'Kunde inte skapa uppladdningslänk.' } };
  }
  return { signedUrl: data.signedUrl, token: data.token, error: null };
}

// Läser objektets FAKTISKA storlek och mimetype. Enda försvarslinjen mot en klient som påstod 2 MB
// och laddade upp 40 — upload-token bär ingen storleks- eller typbindning.
//
// `list(dir, { search })` och inte `.info(path)`: info() bygger fel URL mot en privat bucket i
// storage-js 2.7.0. list() är dessutom det anrop repot redan använder på två andra ställen.
export async function readReceiptInfo(
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

// Anroparen MÅSTE ha gatat åtkomsten först (RLS-läsningen av utlägget) — den här funktionen använder
// service-role och frågar inte vem som tittar.
export async function signReceiptUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
  downloadName?: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, RECEIPT_SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Best-effort städning. Ett kvarglömt objekt är skräp, inte ett fel användaren ska se.
export async function removeReceiptObject(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  try {
    await admin.storage.from(bucket).remove([path]);
  } catch {
    /* ignoreras med flit */
  }
}

// ── Steg 3: bekräftelsen ─────────────────────────────────────────────────────

export type ReceiptAttachment = { storage_path: string; file_name: string };

export type ReceiptColumns = {
  receipt_bucket: string;
  receipt_path: string;
  receipt_name: string;
  receipt_content_type: string | null;
  receipt_size_bytes: number;
  receipt_uploaded_at: string;
};

/**
 * Gör en påstådd uppladdning till kolumner som får skrivas.
 *
 * ALLT KLIENTEN SKICKAR ÄR ETT PÅSTÅENDE. Upload-token binder bara sökvägen — inte storlek, inte
 * mimetype — så det här är enda försvarslinjen mot en klient som påstod 2 MB och laddade upp 40,
 * eller som pekar ut någon annans objekt i bucketen. Två kontroller bär det:
 *   1. sökvägen måste ligga under Kvitton/<den här användaren>/,
 *   2. storlek och mimetype läses ur LAGRINGEN, aldrig ur kroppen.
 *
 * ⚠️ STÄDNINGEN VID OGILTIG FIL ÄR DESTRUKTIV och är ofarlig BARA tack vare kontroll 1: objektet
 * ligger bevisligen i den här användarens egen katalog. Ta inte bort kontrollen, och flytta inte
 * städningen ovanför den.
 *
 * Dubblettkontrollen (är sökvägen redan kopplad till en annan post?) ligger INTE här — den kräver
 * en databasfråga och görs av routen, som också äger unika indexets kapplöpningsfall.
 */
export async function resolveReceiptAttachment(
  admin: SupabaseClient,
  bucket: string,
  userId: string,
  attachment: ReceiptAttachment,
  now: () => string = () => new Date().toISOString(),
): Promise<{ ok: false; error: string; status: 400 } | { ok: true; columns: ReceiptColumns }> {
  if (!isReceiptPath(attachment.storage_path, userId)) {
    return { ok: false, error: 'Kvittot hör inte till dig.', status: 400 };
  }

  const info = await readReceiptInfo(admin, bucket, attachment.storage_path);
  if (!info) {
    return { ok: false, error: 'Kvittot kom aldrig fram. Försök igen.', status: 400 };
  }

  const invalid = validateReceiptFile({
    size: info.size,
    type: info.contentType || '',
    name: attachment.file_name,
  });
  if (invalid) {
    await removeReceiptObject(admin, bucket, attachment.storage_path);
    return { ok: false, error: invalid, status: 400 };
  }

  return {
    ok: true,
    columns: {
      receipt_bucket: bucket,
      receipt_path: attachment.storage_path,
      receipt_name: attachment.file_name,
      receipt_content_type: info.contentType,
      receipt_size_bytes: info.size,
      receipt_uploaded_at: now(),
    },
  };
}
