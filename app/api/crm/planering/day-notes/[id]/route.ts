import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteDayNote } from '@/lib/domains/planning/dayNotes';
import { ok, routeError, invalidUuidParam, requirePermission } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Remove a day note.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await deleteDayNote(supabase, context.params.id);
    if (error) return routeError(500, 'planning_day_note_delete_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_day_note_delete_unexpected', e?.message || 'Failed to delete day note');
  }
}
