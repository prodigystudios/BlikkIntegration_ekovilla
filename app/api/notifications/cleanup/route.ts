import { NextRequest, NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { pruneReadNotifications } from '@/lib/domains/notifications/mutations';

export const dynamic = 'force-dynamic';

// Auto-gallring av lästa notiser (D). Scheduled via vercel.json cron; Vercel sends
// `Authorization: Bearer <CRON_SECRET>`. Deletes READ notifications older than 30 days so the
// table stays tidy; unread rows are never touched. Allowlisted in middleware.ts.
const RETENTION_DAYS = 30;

function isAuthorizedCron(req: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const custom = (process.env.NOTIFICATIONS_CLEANUP_SECRET || '').trim();
  const authHeader = String(req.headers.get('authorization') || '').trim();
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = String(req.headers.get('x-cleanup-secret') || '').trim();

  if (cronSecret && bearer === cronSecret) return true;
  if (custom && (bearer === custom || headerSecret === custom)) return true;
  return false;
}

async function run(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = getOptionalSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'service_role_missing' }, { status: 500 });
  }

  const { data, error } = await pruneReadNotifications(admin, RETENTION_DAYS);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: { deleted: data?.length ?? 0, retentionDays: RETENTION_DAYS } });
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
