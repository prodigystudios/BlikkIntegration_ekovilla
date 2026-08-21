import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBlocks } from './blocks';
import { isInfoImagePath, resolveUploadKind } from './storage';

// Skrivvägen för /dokument-information. Rutthanterarna löser auth, parsar och svarar; allt som
// rör databasen bor här.
//
// Alla funktioner tar sessionsklienten, inte service-role: RLS är det som avgör att bara admin
// får skriva. Rutten kontrollerar rollen också, men bara för felmeddelandets skull — en RLS-
// blockerad skrivning träffar noll rader och svarar `error: null`, vilket är den värsta av
// utgångarna eftersom det ser ut som att det gick bra.

export class InfoPageError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Nästa lediga plats sist i en lista.
 *
 * Räknas fram på servern och inte i klienten: två administratörer som lägger till samtidigt
 * skulle annars räkna fram samma nummer ur var sin ögonblicksbild.
 */
async function nextSortOrder(
  client: SupabaseClient,
  table: string,
  scope?: { column: string; value: string },
): Promise<number> {
  let query = client.from(table).select('sort_order').order('sort_order', { ascending: false }).limit(1);
  if (scope) query = query.eq(scope.column, scope.value);
  const { data } = await query;
  return ((data?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -1) + 1;
}

// En UPDATE eller DELETE som inte träffar någon rad svarar `error: null` med data null. Utan
// den här kontrollen ser ett borttaget avsnitt ut som en lyckad sparning i gränssnittet.
function requireRow<T>(row: T | null, code: string, message: string): T {
  if (!row) throw new InfoPageError(404, code, message);
  return row;
}

function failOn(error: { message: string } | null, code: string): void {
  if (error) throw new InfoPageError(500, code, error.message);
}

export async function createGroup(client: SupabaseClient, userId: string, title: string) {
  const sortOrder = await nextSortOrder(client, 'info_groups');
  const { data, error } = await client
    .from('info_groups')
    .insert({ title, sort_order: sortOrder, created_by: userId })
    .select('id, title, sort_order')
    .maybeSingle();
  failOn(error, 'group_create_failed');
  return requireRow(data, 'group_create_empty', 'Avsnittet skapades inte.');
}

export async function updateGroup(
  client: SupabaseClient,
  id: string,
  patch: { title?: string; sortOrder?: number },
) {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;

  const { data, error } = await client
    .from('info_groups')
    .update(row)
    .eq('id', id)
    .select('id, title, sort_order')
    .maybeSingle();
  failOn(error, 'group_update_failed');
  return requireRow(data, 'group_not_found', 'Avsnittet finns inte.');
}

// Raderar avsnittet OCH allt under det: sektionerna hänger på group_id med on delete cascade,
// bildraderna på section_id. Objekten i storage blir kvar — de kostar ingenting, och ett
// felklick går att rädda så länge filen finns.
export async function deleteGroup(client: SupabaseClient, id: string) {
  const { data, error } = await client.from('info_groups').delete().eq('id', id).select('id').maybeSingle();
  failOn(error, 'group_delete_failed');
  return requireRow(data, 'group_not_found', 'Avsnittet finns inte.');
}

export async function createSection(
  client: SupabaseClient,
  userId: string,
  input: { groupId: string; title: string; body?: unknown },
) {
  // Sist inom sitt eget avsnitt, inte sist av alla.
  const sortOrder = await nextSortOrder(client, 'info_sections', { column: 'group_id', value: input.groupId });
  const { data, error } = await client
    .from('info_sections')
    .insert({
      group_id: input.groupId,
      title: input.title,
      body: normalizeBlocks(input.body),
      sort_order: sortOrder,
      created_by: userId,
    })
    .select('id, group_id, title, body, sort_order')
    .maybeSingle();
  failOn(error, 'section_create_failed');
  return requireRow(data, 'section_create_empty', 'Fliken skapades inte.');
}

/**
 * `hasBody` skiljer "skickade ingen body" från "skickade en tom body". En PATCH som bara byter
 * rubrik ska inte råka tömma brödtexten på vägen, och `undefined` ensamt kan inte bära den
 * skillnaden genom ett Zod-schema.
 */
export function buildSectionPatch(
  input: { title?: string; groupId?: string; sortOrder?: number; body?: unknown },
  hasBody: boolean,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.groupId !== undefined) patch.group_id = input.groupId;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (hasBody) patch.body = normalizeBlocks(input.body);
  return patch;
}

export async function updateSection(client: SupabaseClient, id: string, patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) {
    throw new InfoPageError(400, 'invalid_input', 'Inget att ändra.');
  }

  const { data, error } = await client
    .from('info_sections')
    .update(patch)
    .eq('id', id)
    .select('id, group_id, title, body, sort_order')
    .maybeSingle();
  failOn(error, 'section_update_failed');
  return requireRow(data, 'section_not_found', 'Fliken finns inte.');
}

export async function deleteSection(client: SupabaseClient, id: string) {
  const { data, error } = await client.from('info_sections').delete().eq('id', id).select('id').maybeSingle();
  failOn(error, 'section_delete_failed');
  return requireRow(data, 'section_not_found', 'Fliken finns inte.');
}

export async function requireSection(client: SupabaseClient, id: string) {
  const { data, error } = await client.from('info_sections').select('id').eq('id', id).maybeSingle();
  failOn(error, 'section_lookup_failed');
  return requireRow(data, 'section_not_found', 'Fliken finns inte.');
}

/**
 * Bild eller pdf — allt annat avvisas.
 *
 * Gatas på BÅDA stegen (reservationen av sökvägen och registreringen av raden), inte bara på
 * det första: de är två separata anrop, och den som redan har en signerad uppladdning kan
 * lägga vad som helst på sökvägen innan raden skrivs. Vakten hör hemma här och inte i ett
 * Zod-schema eftersom det är samma funktion som läsvägen väljer renderare med.
 *
 * Varför det är mer än städning: filen serveras inline från storage-ursprunget, och
 * SELECT-policyn släpper igenom varje inloggad. En html- eller svg-fil hade blivit ett
 * skriptdokument som alla i appen kan öppna.
 */
export function assertSupportedFile(contentType: string | null | undefined, nameOrPath: string): void {
  if (resolveUploadKind(contentType, nameOrPath) === 'other') {
    throw new InfoPageError(400, 'unsupported_file_type', 'Bara bilder och PDF-filer kan läggas till här.');
  }
}

export async function registerImage(
  client: SupabaseClient,
  sectionId: string,
  input: { bucket: string; path: string; fileName: string; contentType?: string | null; caption?: string | null },
) {
  // 🧨 Sökvägen kommer utifrån och signeras sedan med service-role. Utan den här vakten kunde
  // raden peka på vilket objekt som helst i bucketen — och eftersom SELECT-policyn släpper
  // igenom varje inloggad hade en privat arbetsorderritning blivit synlig för alla.
  if (!isInfoImagePath(sectionId, input.path)) {
    throw new InfoPageError(400, 'invalid_path', 'Sökvägen hör inte till den här fliken.');
  }

  // Sökvägen, inte filnamnet: den är det vi själva byggde. Att sanitiseringen bevarar
  // ändelsen är det som gör att den här kontrollen ser samma sak som steg ett gjorde.
  assertSupportedFile(input.contentType, input.path);

  const sortOrder = await nextSortOrder(client, 'info_section_images', { column: 'section_id', value: sectionId });
  const { data, error } = await client
    .from('info_section_images')
    .insert({
      section_id: sectionId,
      storage_bucket: input.bucket,
      storage_path: input.path,
      // public_path lämnas null: check-villkoret i tabellen tillåter bara en källa, och den här
      // vägen är alltid storage. De gamla filerna under public/documents/ kom in via seedningen.
      public_path: null,
      file_name: input.fileName,
      // Null när webbläsaren inte kunde säga vad filen var. Läsvägen faller då tillbaka på
      // ändelsen i sökvägen, precis som för raderna från före kolumnen fanns.
      content_type: input.contentType || null,
      caption: input.caption ?? null,
      sort_order: sortOrder,
    })
    .select('id, file_name, content_type, caption, sort_order')
    .maybeSingle();
  failOn(error, 'image_create_failed');
  return requireRow(data, 'image_create_empty', 'Filen registrerades inte.');
}

// Läser sökvägen INNAN raden försvinner — efteråt finns inget som pekar ut objektet.
export async function deleteImage(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from('info_section_images')
    .delete()
    .eq('id', id)
    .select('id, storage_bucket, storage_path')
    .maybeSingle();
  failOn(error, 'image_delete_failed');
  return requireRow(data, 'image_not_found', 'Filen finns inte.') as {
    id: string;
    storage_bucket: string | null;
    storage_path: string | null;
  };
}
