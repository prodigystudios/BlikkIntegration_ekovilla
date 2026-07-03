import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListNotificationsQuery } from './schemas';

const notificationSelect = 'id, recipient_user_id, type, title, body, href, entity_type, entity_id, read_at, created_at';

// List the caller's notifications (RLS scopes to recipient_user_id = auth.uid()). Keyset
// paginated on created_at so it stays under the PostgREST row cap.
export async function listNotifications(supabase: SupabaseClient, options: ListNotificationsQuery) {
  let query = supabase
    .from('notifications')
    .select(notificationSelect)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit);

  if (options.unreadOnly) {
    query = query.is('read_at', null);
  }
  if (options.before) {
    query = query.lt('created_at', options.before);
  }

  return query;
}

// Unread count for the badge. head+count avoids materialising rows.
export async function countUnreadNotifications(supabase: SupabaseClient, recipientId: string) {
  return supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', recipientId)
    .is('read_at', null);
}
