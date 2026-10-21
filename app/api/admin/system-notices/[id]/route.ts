import { createSessionClient } from '@/lib/supabase/session';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, validationError, invalidUuidParam } from '@/lib/api/responses';
import { updateSystemNoticeSchema } from '@/lib/domains/systemNotices/schemas';
import { deleteSystemNotice, updateSystemNotice } from '@/lib/domains/systemNotices/queries';
import { buildSystemNoticeUpdate, systemNoticeEndProblem, toSystemNoticeView } from '@/lib/domains/systemNotices/notices';
import type { SystemNoticeRow } from '@/lib/domains/systemNotices/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ändrar ett meddelande, eller slår av det (`{ end: true }`). En ändrad text visas igen för den som stängt den gamla.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const parsed = updateSystemNoticeSchema.safeParse((await req.json().catch(() => null)) ?? {});
    if (!parsed.success) return validationError(parsed.error);

    const now = new Date();
    if (!parsed.data.end) {
      const endProblem = systemNoticeEndProblem(parsed.data.ends_at, now);
      if (endProblem) return routeError(400, 'ends_at_in_past', endProblem);
    }

    const patch = buildSystemNoticeUpdate(parsed.data, now.toISOString());
    // updated_at ligger alltid i patchen; finns inget mer är det en tom sparning.
    if (Object.keys(patch).length <= 1) return routeError(400, 'nothing_to_update', 'Inget att spara.');

    const supabase = createSessionClient();
    const { data, error } = await updateSystemNotice(supabase, params.id, patch);
    if (error) return routeError(500, 'system_notice_update_failed', error.message);
    if (!data) return routeError(404, 'not_found', 'Meddelandet hittades inte.');

    return ok({ notice: toSystemNoticeView(data as SystemNoticeRow) });
  } catch (e: any) {
    return routeError(500, 'system_notices_unexpected', e?.message || 'Failed to update system notice');
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const supabase = createSessionClient();
    const { data, error } = await deleteSystemNotice(supabase, params.id);
    if (error) return routeError(500, 'system_notice_delete_failed', error.message);
    if (!data) return routeError(404, 'not_found', 'Meddelandet hittades inte.');

    return ok({ deleted: true });
  } catch (e: any) {
    return routeError(500, 'system_notices_unexpected', e?.message || 'Failed to delete system notice');
  }
}
