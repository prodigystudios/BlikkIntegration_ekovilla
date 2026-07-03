import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, invalidUuidParam } from '@/lib/api/responses';
import { markNotificationRead } from '@/lib/domains/notifications/mutations';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await markNotificationRead(supabase, params.id);
    if (error) return routeError(500, 'notification_read_failed', error.message);

    return ok({ id: params.id });
  } catch (e: any) {
    return routeError(500, 'notifications_unexpected', e?.message || 'Failed to mark read');
  }
}
