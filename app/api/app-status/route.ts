import { createSessionClient } from '@/lib/supabase/session';
import { ok, routeError } from '@/lib/api/responses';
import { listActiveSystemNotices } from '@/lib/domains/systemNotices/queries';
import { sortSystemNoticesForDisplay, toSystemNoticeView } from '@/lib/domains/systemNotices/notices';
import { APP_BUILD_ID } from '@/lib/domains/systemNotices/appVersion';
import type { SystemNoticeRow } from '@/lib/domains/systemNotices/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Det bannern överst i appen visar. Hämtas av varje inloggad klient var minut, så både svaret och arbetet hålls litet:
// bara det som är aktivt just nu, och bara sessionen — ingen profil, rollen behövs inte. Vem som får läsa avgör RLS
// (app_system_notices_select: alla inloggade, med flit — samma behörighet som en montör).
export async function GET() {
  try {
    const supabase = createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return routeError(401, 'unauthorized', 'Unauthorized');

    const { data, error } = await listActiveSystemNotices(supabase, new Date().toISOString());
    if (error) return routeError(500, 'app_status_failed', error.message);

    const notices = sortSystemNoticesForDisplay(((data ?? []) as SystemNoticeRow[]).map(toSystemNoticeView));
    // Den här driftsättningens version. En flik vars kod har en annan visar "Appen har uppdaterats".
    return ok({ notices, build: APP_BUILD_ID });
  } catch (e: any) {
    return routeError(500, 'app_status_unexpected', e?.message || 'Failed to read app status');
  }
}
