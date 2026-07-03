import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, validationError } from '@/lib/api/responses';
import { listNotificationsQuerySchema } from '@/lib/domains/notifications/schemas';
import { listNotifications } from '@/lib/domains/notifications/queries';
import { mapNotificationRows } from '@/lib/domains/notifications/mappers';
import type { NotificationRow } from '@/lib/domains/notifications/types';

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const url = new URL(req.url);
    const parsed = listNotificationsQuerySchema.safeParse({
      unreadOnly: url.searchParams.get('unreadOnly') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      before: url.searchParams.get('before') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listNotifications(supabase, parsed.data);
    if (error) return routeError(500, 'notifications_list_failed', error.message);

    return ok({ items: mapNotificationRows(data as NotificationRow[] | null) });
  } catch (e: any) {
    return routeError(500, 'notifications_unexpected', e?.message || 'Failed to list notifications');
  }
}
