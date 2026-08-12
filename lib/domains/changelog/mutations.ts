import type { SupabaseClient } from '@supabase/supabase-js';
import { changelogEntrySelect } from './queries';
import type { CreateChangelogEntryInput, UpdateChangelogEntryInput } from './schemas';
import { categoryLabel, toChangelogCategory, type ChangelogDraftView, type ChangelogEntryRow } from './types';

export function mapEntryToDraft(row: ChangelogEntryRow): ChangelogDraftView {
  const category = toChangelogCategory(row.category);
  return {
    id: row.id,
    category,
    category_label: categoryLabel[category],
    title: row.title,
    body: row.body,
    published_at: row.published_at,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
  };
}

export function mapEntriesToDrafts(rows: ChangelogEntryRow[] | null | undefined): ChangelogDraftView[] {
  return (rows || []).map(mapEntryToDraft);
}

type MutationResult = { data: ChangelogDraftView | null; error: { message: string; code?: string } | null };

export async function createChangelogEntry(
  supabase: SupabaseClient,
  input: CreateChangelogEntryInput & { created_by: string; created_by_name: string; now: string },
): Promise<MutationResult> {
  const result = await supabase
    .from('app_changelog_entries')
    .insert({
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      // Publiceringstidpunkten är sorteringsnyckeln, inte created_at — så en post kan skrivas i
      // förväg och dateras när den faktiskt går ut.
      published_at: input.publish ? input.now : null,
      created_by: input.created_by,
      created_by_name: input.created_by_name,
    })
    .select(changelogEntrySelect)
    .single();

  return { data: result.data ? mapEntryToDraft(result.data as ChangelogEntryRow) : null, error: result.error };
}

// Bygger kolumnuppdateringen ur admins indata. Ren funktion — reglerna nedan är enhetstestade.
//
// `sentKeys` är nycklarna klienten faktiskt skickade: Zod fyller i defaults för utelämnade fält, och
// att skriva dem hade nollat kolumner ingen rört.
export function buildEntryUpdatePatch(
  input: UpdateChangelogEntryInput,
  sentKeys: string[],
  now: string,
  current: { published_at: string | null },
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: now };
  const sent = new Set(sentKeys);

  if (sent.has('category') && input.category) patch.category = input.category;
  if (sent.has('title') && input.title) patch.title = input.title;
  if (sent.has('body')) patch.body = input.body ?? null;

  if (sent.has('publish')) {
    if (input.publish) {
      // En redan publicerad post BEHÅLLER sin tidsstämpel. Att sätta om den vid varje sparning
      // hade flyttat gamla poster till toppen så fort man rättade ett stavfel — och läsaren hade
      // sett en två veckor gammal ändring presenteras som ny.
      patch.published_at = current.published_at ?? now;
    } else {
      patch.published_at = null;
    }
  }

  return patch;
}

export async function updateChangelogEntry(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<MutationResult> {
  const result = await supabase
    .from('app_changelog_entries')
    .update(patch)
    .eq('id', id)
    .select(changelogEntrySelect)
    .maybeSingle();

  return { data: result.data ? mapEntryToDraft(result.data as ChangelogEntryRow) : null, error: result.error };
}

// Raderar en fritt skriven post. Ärendehärledda rader raderas INTE här — de tas ur changeloggen
// genom att avpubliceras på ärendet, som äger sin text.
export async function deleteChangelogEntry(supabase: SupabaseClient, id: string) {
  return supabase.from('app_changelog_entries').delete().eq('id', id).select('id').maybeSingle();
}
