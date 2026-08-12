import type { SupabaseClient } from '@supabase/supabase-js';

// EN literal, inte ihopslagna delsträngar — supabase-js typar svaret utifrån select-strängens
// literaltyp, och `'a' + 'b'` degraderar den till `string`.
export const changelogEntrySelect =
  'id, category, title, body, published_at, created_by, created_by_name, created_at, updated_at';

// Bara de fält changeloggen behöver ur ärendet. Beskrivning, skärmbild och det interna svaret till
// rapportören ska ALDRIG nå den här vyn — den läses av alla, ärendet av rapportören och admin.
export const changelogTicketSelect = 'id, kind, changelog_note, changelog_published_at, reporter_name';

// Publicerade fria poster. RLS släpper igenom utkast till admin, så filtret här är det som gör
// listan till "det alla ser" oavsett vem som frågar.
export function listPublishedEntries(supabase: SupabaseClient, limit: number) {
  return supabase
    .from('app_changelog_entries')
    .select(changelogEntrySelect)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);
}

// Adminvyn: publicerat OCH utkast, nyast först. `published_at` är null för utkast och sorteras sist
// med nullsFirst:false, så det som är ute ligger överst och det oskrivna längst ned.
export function listAllEntries(supabase: SupabaseClient, limit: number) {
  return supabase
    .from('app_changelog_entries')
    .select(changelogEntrySelect)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
}

// Publicerade appärenden — changeloggens andra källa. Texten bor kvar på ärendet med flit: ett
// stängt ärende ÄR posten, och en kopia hit hade blivit en andra sanning.
export function listPublishedTickets(supabase: SupabaseClient, limit: number) {
  return supabase
    .from('app_tickets')
    .select(changelogTicketSelect)
    .not('changelog_published_at', 'is', null)
    .order('changelog_published_at', { ascending: false })
    .limit(limit);
}

export function getEntry(supabase: SupabaseClient, id: string) {
  return supabase.from('app_changelog_entries').select(changelogEntrySelect).eq('id', id).maybeSingle();
}
