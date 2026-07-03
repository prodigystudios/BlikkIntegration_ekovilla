import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError } from '@/lib/api/responses';
import { countUnreadNotifications } from '@/lib/domains/notifications/queries';

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const supabase = createRouteHandlerClient({ cookies });
    const { count, error } = await countUnreadNotifications(supabase, currentUser.id);
    if (error) return routeError(500, 'notifications_count_failed', error.message);

    return ok({ count: count ?? 0 });
  } catch (e: any) {
    return routeError(500, 'notifications_unexpected', e?.message || 'Failed to count notifications');
  }
}
