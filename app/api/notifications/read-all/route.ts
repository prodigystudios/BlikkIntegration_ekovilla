import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError } from '@/lib/api/responses';
import { markAllNotificationsRead } from '@/lib/domains/notifications/mutations';

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await markAllNotificationsRead(supabase, currentUser.id);
    if (error) return routeError(500, 'notifications_read_all_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'notifications_unexpected', e?.message || 'Failed to mark all read');
  }
}
