import { createSessionClient } from '@/lib/supabase/session';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError } from '@/lib/api/responses';
import { listActiveSystemNotices } from '@/lib/domains/systemNotices/queries';
import { sortSystemNoticesForDisplay, toSystemNoticeView } from '@/lib/domains/systemNotices/notices';
import type { SystemNoticeRow } from '@/lib/domains/systemNotices/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Det bannern överst i appen visar. Hämtas av varje inloggad klient var minut, så svaret hålls litet: bara det som
// är aktivt just nu.
export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const supabase = createSessionClient();
    const { data, error } = await listActiveSystemNotices(supabase, new Date().toISOString());
    if (error) return routeError(500, 'app_status_failed', error.message);

    const notices = sortSystemNoticesForDisplay(((data ?? []) as SystemNoticeRow[]).map(toSystemNoticeView));
    return ok({ notices });
  } catch (e: any) {
    return routeError(500, 'app_status_unexpected', e?.message || 'Failed to read app status');
  }
}
