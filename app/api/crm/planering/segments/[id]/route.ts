import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { moveSegment, removeSegment } from '@/lib/domains/planning/schedule';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, moveSegmentSchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Move/reorder a placement (drag to another truck/day, change day-range).
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = moveSegmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.start_day && parsed.data.end_day && parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await moveSegment(supabase, context.params.id, {
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      sortIndex: parsed.data.sort_index,
    });
    if (error) return routeError(500, 'planning_segment_move_failed', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_segment_move_unexpected', e?.message || 'Failed to move segment');
  }
}

// Unschedule a placement (dragged back to the backlog / removed from the calendar).
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await removeSegment(supabase, context.params.id);
    if (error) return routeError(500, 'planning_segment_delete_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_segment_delete_unexpected', e?.message || 'Failed to remove segment');
  }
}
