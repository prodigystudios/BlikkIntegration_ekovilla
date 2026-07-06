import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationInsert } from './types';
import { createNotifications } from './mutations';
import { isWebPushConfigured, sendWebPush } from '@/lib/webPush';

// Deliver notifications: insert the rows (the bell is the source of truth) AND, best-effort, send a
// web push to each recipient's registered devices so the notification also reaches phones. Push is a
// pure enhancement — a push failure never affects the insert, and callers get the same result shape
// as createNotifications. Service-role client required (fan-out writes rows for OTHER users).
//
// Because every notification row already carries title/body/href, routing all producers through this
// single helper means every notification type gets push for free — no per-feature work, no SW change.
export async function deliverNotifications(admin: SupabaseClient, rows: NotificationInsert[]) {
  const result = await createNotifications(admin, rows);
  // Never let push break the caller or the underlying insert.
  try {
    await pushToRecipients(admin, rows);
  } catch (e) {
    console.error('[notifications] push fan-out failed', e);
  }
  return result;
}

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

// Best-effort web push for a batch of notification rows. Loads each recipient's devices once and
// fans a push out per device, pruning dead endpoints (404/410) exactly like the reminders dispatch.
async function pushToRecipients(admin: SupabaseClient, rows: NotificationInsert[]) {
  if (!isWebPushConfigured() || rows.length === 0) return;

  // A recipient may receive several rows in one batch — group so we look up devices once per user.
  const rowsByRecipient = new Map<string, NotificationInsert[]>();
  for (const row of rows) {
    const list = rowsByRecipient.get(row.recipient_user_id) ?? [];
    list.push(row);
    rowsByRecipient.set(row.recipient_user_id, list);
  }

  const { data: subscriptions, error } = await admin
    .from('dashboard_push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth')
    .in('user_id', [...rowsByRecipient.keys()]);

  if (error || !subscriptions?.length) return;

  const subsByUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of subscriptions as PushSubscriptionRow[]) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  const sends: Promise<void>[] = [];
  for (const [userId, userRows] of rowsByRecipient) {
    const devices = subsByUser.get(userId);
    if (!devices?.length) continue; // no opted-in device → bell only, no push
    for (const row of userRows) {
      for (const device of devices) {
        sends.push(sendToDevice(admin, device, row));
      }
    }
  }

  await Promise.all(sends);
}

async function sendToDevice(admin: SupabaseClient, device: PushSubscriptionRow, row: NotificationInsert) {
  try {
    await sendWebPush(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      {
        title: row.title,
        body: row.body ?? '',
        url: row.href ?? '/',
        // Collapse repeated push banners for the same thing (a new mention on the same order
        // replaces the previous banner); the bell still lists every notification.
        tag: `${row.type}:${row.entity_id ?? ''}`,
      },
    );
    await admin
      .from('dashboard_push_subscriptions')
      .update({ last_success_at: new Date().toISOString(), last_error: null })
      .eq('id', device.id);
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      // Endpoint is gone (unsubscribed / expired) — drop it so we stop trying.
      await admin.from('dashboard_push_subscriptions').delete().eq('id', device.id);
    } else {
      const message = String(error?.body || error?.message || 'Push send failed');
      await admin
        .from('dashboard_push_subscriptions')
        .update({ last_failure_at: new Date().toISOString(), last_error: message.slice(0, 1000) })
        .eq('id', device.id);
    }
  }
}
