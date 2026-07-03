import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationContent, NotificationInsert } from './types';

// Mark one of the caller's notifications read (session client — RLS enforces ownership).
export async function markNotificationRead(supabase: SupabaseClient, id: string) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
    .select('id')
    .maybeSingle();
}

// Mark all the caller's unread notifications read.
export async function markAllNotificationsRead(supabase: SupabaseClient, recipientId: string) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_user_id', recipientId)
    .is('read_at', null);
}

// Bulk insert notifications for OTHER users (fan-out). Must be called with the service-role
// client (getSupabaseAdmin()) — there is no INSERT policy for authenticated users.
export async function createNotifications(admin: SupabaseClient, rows: NotificationInsert[]) {
  if (rows.length === 0) return { data: [], error: null };
  return admin.from('notifications').insert(rows).select('id');
}

// Auto-gallring: delete READ notifications older than `olderThanDays`. Unread rows are always
// kept. Service-role only (cron). Returns the deleted rows so the caller can log a count.
export async function pruneReadNotifications(admin: SupabaseClient, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  return admin
    .from('notifications')
    .delete()
    .not('read_at', 'is', null)
    .lt('read_at', cutoff)
    .select('id');
}

// Convenience: expand one content object to one insert per recipient id.
export function expandNotificationToRecipients(content: NotificationContent, recipientIds: string[]): NotificationInsert[] {
  return recipientIds.map((recipient_user_id) => ({ recipient_user_id, ...content }));
}
