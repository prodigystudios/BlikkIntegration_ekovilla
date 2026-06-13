import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { moveSegment, removeSegment, getSegmentRef } from '@/lib/domains/planning/schedule';
import { logActivity, describeSegmentPatch } from '@/lib/domains/planning/activity';
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
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = moveSegmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.start_day && parsed.data.end_day && parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const patch = {
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      sortIndex: parsed.data.sort_index,
      jobType: parsed.data.job_type,
      onHold: parsed.data.on_hold,
    };
    const { data, error } = await moveSegment(supabase, context.params.id, patch);
    if (error) {
      // A one-sided patch (only start_day or only end_day) can't be range-checked above against the
      // existing row, so an inverted range is caught by the DB CHECK — surface it as a clean 400.
      if ((error as { code?: string }).code === '23514') {
        return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
      }
      return routeError(500, 'planning_segment_move_failed', error.message);
    }

    const { action, summary } = describeSegmentPatch(patch, data?.job?.ref ?? 'jobb');
    await logActivity(supabase, gate.currentUser, {
      action,
      entityType: 'segment',
      entityId: context.params.id,
      segmentId: context.params.id,
      workOrderId: data?.work_order_id ?? null,
      summary,
      details: { ...patch },
    });

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_segment_move_unexpected', e?.message || 'Failed to move segment');
  }
}

// Unschedule a placement (dragged back to the backlog / removed from the calendar).
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    // Read the job reference before the row is gone, so the audit line names the unscheduled job.
    const { workOrderId, ref } = await getSegmentRef(supabase, context.params.id);
    const { error } = await removeSegment(supabase, context.params.id);
    if (error) return routeError(500, 'planning_segment_delete_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'segment.delete',
      entityType: 'segment',
      entityId: context.params.id,
      segmentId: context.params.id,
      workOrderId,
      summary: `Tog bort ${ref} från kalendern`,
    });

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_segment_delete_unexpected', e?.message || 'Failed to remove segment');
  }
}
