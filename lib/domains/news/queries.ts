import type { SupabaseClient } from '@supabase/supabase-js';

// Read model for the news archive. The query lives here (domain layer) rather
// than inline in the page, per the architecture conventions.
export const newsItemSelect = 'id, headline, body, image_url, created_at';

export function listNewsItems(supabase: SupabaseClient, limit = 200) {
  return supabase
    .from('news_items')
    .select(newsItemSelect)
    .order('created_at', { ascending: false })
    .limit(limit);
}
