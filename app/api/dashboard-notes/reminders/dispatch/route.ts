import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { isWebPushConfigured, sendWebPush } from '@/lib/webPush';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type DueNote = {
  id: string;
  user_id: string;
  kind: 'note' | 'meeting' | string;
  title: string;
  body: string | null;
  starts_at: string | null;
  remind_at: string | null;
  reminder_sent_at: string | null;
  status: 'active' | 'done' | 'cancelled' | string;
};

type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function getUserId() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

function buildPushTitle(item: DueNote) {
  if (item.kind === 'meeting') {
    const when = formatPushWhen(item.starts_at);
    return when ? `Möte ${when}` : 'Möte snart';
  }
  return 'Påminnelse';
}

function buildPushBody(item: DueNote) {
  if (item.kind === 'meeting') {
    const details = [item.title.trim(), truncatePushText(item.body, 72)].filter(Boolean);
    return details.join(' • ');
  }
  const details = [item.title.trim(), truncatePushText(item.body, 96)].filter(Boolean);
  return details.join(' • ');
}

function formatPushWhen(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const isSameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const clock = `kl ${date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  if (isSameDay) return `idag ${clock}`;
  return `${date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${clock}`;
}

function truncatePushText(value: string | null, maxLength: number) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function isAuthorizedCron(req: NextRequest) {
  const customSecret = (process.env.REMINDER_DISPATCH_SECRET || '').trim();
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const headerSecret = String(req.headers.get('x-reminder-secret') || '').trim();
  const authHeader = String(req.headers.get('authorization') || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

  if (customSecret && headerSecret === customSecret) return true;
  if (customSecret && bearerToken === customSecret) return true;
  if (cronSecret && bearerToken === cronSecret) return true;
  return false;
}

async function dispatchReminders(req: NextRequest) {
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    return routeError(500, 'service_role_missing', 'Admin-klient saknas.');
  }
  if (!isWebPushConfigured()) {
    return routeError(503, 'push_not_configured', 'Push är inte konfigurerat.');
  }

  const isCronCall = isAuthorizedCron(req);
  const currentUserId = isCronCall ? null : await getUserId();

  if (!isCronCall && !currentUserId) {
    return routeError(401, 'unauthorized', 'Ej inloggad.');
  }

  let query = supabase
    .from('dashboard_work_items')
    .select('id,user_id,kind,title,body,starts_at,remind_at,reminder_sent_at,status')
    .not('remind_at', 'is', null)
    .is('reminder_sent_at', null)
    .eq('status', 'active')
    .lte('remind_at', new Date().toISOString())
    .order('remind_at', { ascending: true })
    .limit(50);

  if (currentUserId) {
    query = query.eq('user_id', currentUserId);
  }

  const { data: dueNotes, error: dueError } = await query;
  if (dueError) {
    return routeError(500, 'load_due_notes_failed', dueError.message);
  }

  const results: Array<{ noteId: string; sent: number; failed: number; skipped: boolean }> = [];

  for (const note of (dueNotes || []) as DueNote[]) {
    const { data: subscriptions, error: subError } = await supabase
      .from('dashboard_push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', note.user_id);

    if (subError) {
      results.push({ noteId: note.id, sent: 0, failed: 1, skipped: true });
      continue;
    }

    if (!subscriptions?.length) {
      results.push({ noteId: note.id, sent: 0, failed: 0, skipped: true });
      continue;
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const subscription of subscriptions as PushRow[]) {
      try {
        await sendWebPush(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          {
            title: buildPushTitle(note),
            body: buildPushBody(note),
            tag: `dashboard-item-${note.id}`,
            url: '/',
            noteId: note.id,
            kind: note.kind,
            reminderAt: note.remind_at,
            startsAt: note.starts_at,
          },
        );
        sentCount += 1;
        await supabase
          .from('dashboard_push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq('id', subscription.id);
      } catch (error: any) {
        failedCount += 1;
        const statusCode = Number(error?.statusCode || 0);
        const message = String(error?.body || error?.message || 'Push send failed');
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('dashboard_push_subscriptions').delete().eq('id', subscription.id);
        } else {
          await supabase
            .from('dashboard_push_subscriptions')
            .update({ last_failure_at: new Date().toISOString(), last_error: message.slice(0, 1000) })
            .eq('id', subscription.id);
        }
      }
    }

    if (sentCount > 0) {
      await supabase
        .from('dashboard_work_items')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', note.id);
    }

    results.push({ noteId: note.id, sent: sentCount, failed: failedCount, skipped: false });
  }

  const payload = { processed: results.length, results };
  return ok(payload, payload);
}

export async function POST(req: NextRequest) {
  return dispatchReminders(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return routeError(405, 'method_not_allowed', 'Method not allowed.');
  }

  return dispatchReminders(req);
}