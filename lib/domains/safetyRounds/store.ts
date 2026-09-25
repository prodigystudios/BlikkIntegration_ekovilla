import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  SafetyRound,
  SafetyRoundAction,
  SafetyRoundBundle,
  SafetyRoundItem,
  SafetyRoundListRow,
  SafetyRoundOrder,
  SafetyRoundParticipant,
  SafetyRoundPhoto,
} from './types';

// Databasen för skyddsronderna — tunna frågor med SESSIONSKLIENTEN. RLS gör auktoriseringen
// (supabase/archive/sql/20260924_safety_rounds.sql): läsning kräver safety.round.read eller .write,
// skrivning .write och — på rondinfo, deltagare och punkter — att ronden är ett utkast.
//
// ⚠️ En UPDATE eller DELETE som RLS stoppar ger INGET fel från PostgREST, bara noll rader. Därför
// avslutas varje skrivning med `.select()` och `maybeSingle()`: `data === null` utan fel betyder
// "låst eller finns inte", och rutten svarar på det i stället för att rapportera framgång.

const ROUNDS = 'safety_rounds';
export const PARTICIPANTS = 'safety_round_participants';
export const ITEMS = 'safety_round_items';
export const ACTIONS = 'safety_round_actions';
export const PHOTOS = 'safety_round_photos';

const LIST_SELECT =
  'id, work_order_id, round_number, status, order_number, fortnox_order_number, project_name, held_on, leader_name, next_round_due, created_at';

/**
 * Ronderna, senaste först. Med `workOrderId` en orders ronder (kortet på arbetsordern), annars alla
 * (listan på /skyddsrond). Sista sorteringen på id: två ronder samma dag får inte byta plats mellan
 * två laddningar.
 */
export async function listSafetyRounds(supabase: SupabaseClient, opts: { workOrderId?: string; limit?: number } = {}) {
  let query = supabase.from(ROUNDS).select(LIST_SELECT);
  if (opts.workOrderId) query = query.eq('work_order_id', opts.workOrderId);
  return query
    .order('held_on', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit ?? 50)
    .returns<SafetyRoundListRow[]>();
}

/** Öppna åtgärder (inte Klar/Avskriven) på en orders ronder — kortets räknare. */
export async function countOpenActionsForOrder(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from(ACTIONS)
    .select('id, round:safety_rounds!inner(work_order_id)', { count: 'exact', head: true })
    .eq('round.work_order_id', workOrderId)
    .not('status', 'in', '(done,written_off)');
}

export async function getSafetyRound(supabase: SupabaseClient, id: string) {
  return supabase.from(ROUNDS).select('*').eq('id', id).maybeSingle<SafetyRound>();
}

/** Ronden med deltagare, punkter och åtgärder — i formulärets ordning. null = finns inte / syns inte. */
export async function getSafetyRoundBundle(
  supabase: SupabaseClient,
  id: string,
): Promise<{ data: SafetyRoundBundle | null; error: { message: string } | null }> {
  const [round, participants, items, actions, photos] = await Promise.all([
    getSafetyRound(supabase, id),
    supabase.from(PARTICIPANTS).select('*').eq('round_id', id).order('position').order('created_at').order('id').returns<SafetyRoundParticipant[]>(),
    supabase.from(ITEMS).select('*').eq('round_id', id).order('position').order('id').returns<SafetyRoundItem[]>(),
    supabase.from(ACTIONS).select('*').eq('round_id', id).order('position').order('created_at').order('id').returns<SafetyRoundAction[]>(),
    supabase.from(PHOTOS).select('*').eq('round_id', id).order('photo_no').returns<SafetyRoundPhoto[]>(),
  ]);
  const error = round.error ?? participants.error ?? items.error ?? actions.error ?? photos.error;
  if (error) return { data: null, error };
  if (!round.data) return { data: null, error: null };
  return {
    data: {
      round: round.data,
      participants: participants.data ?? [],
      items: items.data ?? [],
      actions: actions.data ?? [],
      photos: photos.data ?? [],
    },
    error: null,
  };
}

// ── Ordern (förbi crm_work_orders-RLS, smalt — se SQL-filen avsnitt 7) ──────

export async function lookupSafetyRoundOrders(supabase: SupabaseClient, query: string) {
  return supabase.rpc('safety_round_order_lookup', { p_query: query }).returns<SafetyRoundOrder[]>();
}

export async function getSafetyRoundOrderHeader(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .rpc('safety_round_order_header', { p_work_order_id: workOrderId })
    .returns<SafetyRoundOrder[]>()
    .maybeSingle<SafetyRoundOrder>();
}

export async function startSafetyRound(
  supabase: SupabaseClient,
  input: { workOrderId: string; heldOn: string; siteAddress: string | null; employer: string; workType: string },
) {
  return supabase.rpc('start_safety_round', {
    p_work_order_id: input.workOrderId,
    p_held_on: input.heldOn,
    p_site_address: input.siteAddress,
    p_employer: input.employer,
    p_work_type: input.workType,
  });
}

// ── Skrivningar ──────────────────────────────────────────────────────────────

export async function updateSafetyRound(supabase: SupabaseClient, id: string, patch: Partial<SafetyRound>) {
  return supabase.from(ROUNDS).update(patch).eq('id', id).select('*').maybeSingle<SafetyRound>();
}

export async function deleteSafetyRound(supabase: SupabaseClient, id: string) {
  return supabase.from(ROUNDS).delete().eq('id', id).select('id').maybeSingle<{ id: string }>();
}

export async function insertParticipant(supabase: SupabaseClient, row: Omit<SafetyRoundParticipant, 'id'>) {
  return supabase.from(PARTICIPANTS).insert(row).select('*').single<SafetyRoundParticipant>();
}

export async function updateParticipant(supabase: SupabaseClient, roundId: string, id: string, patch: Partial<SafetyRoundParticipant>) {
  return supabase.from(PARTICIPANTS).update(patch).eq('id', id).eq('round_id', roundId).select('*').maybeSingle<SafetyRoundParticipant>();
}

export async function deleteParticipant(supabase: SupabaseClient, roundId: string, id: string) {
  return supabase.from(PARTICIPANTS).delete().eq('id', id).eq('round_id', roundId).select('id').maybeSingle<{ id: string }>();
}

export async function updateItem(supabase: SupabaseClient, roundId: string, id: string, patch: Partial<SafetyRoundItem>) {
  return supabase.from(ITEMS).update(patch).eq('id', id).eq('round_id', roundId).select('*').maybeSingle<SafetyRoundItem>();
}

export async function insertCustomItem(
  supabase: SupabaseClient,
  row: Pick<SafetyRoundItem, 'round_id' | 'category_code' | 'category_label' | 'text' | 'position'>,
) {
  return supabase
    .from(ITEMS)
    .insert({ ...row, catalog_item_id: null, number: null })
    .select('*')
    .single<SafetyRoundItem>();
}

export async function deleteCustomItem(supabase: SupabaseClient, roundId: string, id: string) {
  return supabase.from(ITEMS).delete().eq('id', id).eq('round_id', roundId).select('id').maybeSingle<{ id: string }>();
}

export async function insertAction(supabase: SupabaseClient, row: Omit<SafetyRoundAction, 'id' | 'status' | 'followed_up_on' | 'effect' | 'cost_note' | 'responsible_id'>) {
  return supabase.from(ACTIONS).insert(row).select('*').single<SafetyRoundAction>();
}

export async function updateAction(supabase: SupabaseClient, roundId: string, id: string, patch: Partial<SafetyRoundAction>) {
  return supabase.from(ACTIONS).update(patch).eq('id', id).eq('round_id', roundId).select('*').maybeSingle<SafetyRoundAction>();
}

export async function deleteAction(supabase: SupabaseClient, roundId: string, id: string) {
  return supabase.from(ACTIONS).delete().eq('id', id).eq('round_id', roundId).select('id').maybeSingle<{ id: string }>();
}

/** Katalogens kategorier — en egen punkt får bara läggas i en känd kategori. */
export async function listChecklistCategories(supabase: SupabaseClient) {
  return supabase
    .from('safety_checklist_categories')
    .select('code, label, position')
    .eq('active', true)
    .order('position')
    .returns<Array<{ code: string; label: string; position: number }>>();
}

/** Nästa `position` i en av rondens listor (deltagare, punkter, åtgärder) — sist i listan. */
export async function nextPosition(
  supabase: SupabaseClient,
  table: typeof PARTICIPANTS | typeof ITEMS | typeof ACTIONS,
  roundId: string,
): Promise<{ data: number | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from(table)
    .select('position')
    .eq('round_id', roundId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  if (error) return { data: null, error };
  return { data: (data?.position ?? 0) + 1, error: null };
}

/**
 * Hör punkten till ronden? "Från punkt" på en åtgärd får bara peka på en punkt i SAMMA rond —
 * främmande nyckeln ser bara att punkten finns någonstans.
 */
export async function itemBelongsToRound(supabase: SupabaseClient, roundId: string, itemId: string) {
  const { data, error } = await supabase.from(ITEMS).select('id').eq('id', itemId).eq('round_id', roundId).maybeSingle();
  return { data: data !== null, error };
}

// ── Foton ────────────────────────────────────────────────────────────────────

export async function listPhotos(supabase: SupabaseClient, roundId: string) {
  return supabase.from(PHOTOS).select('*').eq('round_id', roundId).order('photo_no').returns<SafetyRoundPhoto[]>();
}

/** Redan registrerad? Då tillhör objektet en rad och får aldrig städas bort av bekräftelsesteget. */
export async function findPhotoByPath(supabase: SupabaseClient, storagePath: string) {
  return supabase.from(PHOTOS).select('id').eq('storage_path', storagePath).maybeSingle<{ id: string }>();
}

/**
 * Sparar ett uppladdat foto via add_safety_round_photo() — den enda vägen in (ingen INSERT-grant).
 * Funktionen låser ronden och sätter numret ur räknaren; se 20260925_safety_round_photos.sql för
 * felkoderna (22023 sökväg, 55000 slutförd, 23505 redan sparad, 54000 taket, 23503 fel punkt).
 * Sessionsklienten: funktionen kräver auth.uid().
 */
export async function addPhoto(
  supabase: SupabaseClient,
  input: { roundId: string; itemId: string; storagePath: string; printPath: string; sizeBytes: number; printSizeBytes: number },
): Promise<{ data: SafetyRoundPhoto | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await supabase.rpc('add_safety_round_photo', {
    p_round_id: input.roundId,
    p_item_id: input.itemId,
    p_storage_path: input.storagePath,
    p_print_path: input.printPath,
    p_size_bytes: input.sizeBytes,
    p_print_size_bytes: input.printSizeBytes,
  });
  return { data: (data as SafetyRoundPhoto | null) ?? null, error };
}

/** Tar bort raden (RLS: skrivnyckeln och ett utkast) och svarar med sökvägarna att städa. */
export async function deletePhoto(supabase: SupabaseClient, roundId: string, id: string) {
  return supabase
    .from(PHOTOS)
    .delete()
    .eq('id', id)
    .eq('round_id', roundId)
    .select('storage_path, print_path')
    .maybeSingle<Pick<SafetyRoundPhoto, 'storage_path' | 'print_path'>>();
}

/**
 * Sökvägarna under en punkt i ronden. Läses FÖRE borttagningen av en egen punkt, som kaskaderar
 * till fotona — efteråt finns raderna inte längre, och objekten hade blivit kvar i lagringen. Ett
 * fel här ska stoppa borttagningen (anroparen), inte svaras med en tom lista.
 */
export async function listItemPhotoPaths(
  supabase: SupabaseClient,
  roundId: string,
  itemId: string,
): Promise<{ data: string[] | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from(PHOTOS)
    .select('storage_path, print_path')
    .eq('round_id', roundId)
    .eq('item_id', itemId)
    .returns<Array<Pick<SafetyRoundPhoto, 'storage_path' | 'print_path'>>>();
  if (error) return { data: null, error };
  return { data: (data ?? []).flatMap((row) => [row.storage_path, row.print_path]), error: null };
}
