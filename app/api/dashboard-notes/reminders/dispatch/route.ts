import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '@/lib/adminSupabase';
import { isWebPushConfigured, sendWebPush } from '@/lib/webPush';

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
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
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
  if (!adminSupabase) {
    return NextResponse.json({ ok: false, error: 'Admin-klient saknas.' }, { status: 500 });
  }
  if (!isWebPushConfigured()) {
    return NextResponse.json({ ok: false, error: 'Push är inte konfigurerat.' }, { status: 503 });
  }

  const isCronCall = isAuthorizedCron(req);
  const currentUserId = isCronCall ? null : await getUserId();

  if (!isCronCall && !currentUserId) {
    return NextResponse.json({ ok: false, error: 'Ej inloggad.' }, { status: 401 });
  }

  let query = adminSupabase
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
    return NextResponse.json({ ok: false, error: dueError.message }, { status: 500 });
  }

  const results: Array<{ noteId: string; sent: number; failed: number; skipped: boolean }> = [];

  for (const note of (dueNotes || []) as DueNote[]) {
    const { data: subscriptions, error: subError } = await adminSupabase
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
        await adminSupabase
          .from('dashboard_push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq('id', subscription.id);
      } catch (error: any) {
        failedCount += 1;
        const statusCode = Number(error?.statusCode || 0);
        const message = String(error?.body || error?.message || 'Push send failed');
        if (statusCode === 404 || statusCode === 410) {
          await adminSupabase.from('dashboard_push_subscriptions').delete().eq('id', subscription.id);
        } else {
          await adminSupabase
            .from('dashboard_push_subscriptions')
            .update({ last_failure_at: new Date().toISOString(), last_error: message.slice(0, 1000) })
            .eq('id', subscription.id);
        }
      }
    }

    if (sentCount > 0) {
      await adminSupabase
        .from('dashboard_work_items')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', note.id);
    }

    results.push({ noteId: note.id, sent: sentCount, failed: failedCount, skipped: false });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function POST(req: NextRequest) {
  return dispatchReminders(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: 'Method not allowed.' }, { status: 405 });
  }

  return dispatchReminders(req);
}