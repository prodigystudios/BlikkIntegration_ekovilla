import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { materializeDefaultCrew, clearTruckCrewRange } from '@/lib/domains/planning/truckCrew';
import { ok, routeError, validationError, requirePermission, truckCrewWeekSchema } from '../../_lib';

// A week's relationship to the default crew: 'materialize' forks the standing team into editable
// ops_truck_crew rows for the week; 'restore' drops the week's override so it falls back to default.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = truckCrewWeekSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    const { action, truck_id, start_day, end_day } = parsed.data;
    if (end_day < start_day) return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');

    const supabase = createRouteHandlerClient({ cookies });

    if (action === 'restore') {
      const { error } = await clearTruckCrewRange(supabase, truck_id, start_day, end_day);
      if (error) return routeError(500, 'planning_truck_crew_restore_failed', error.message);
      return ok({ ok: true });
    }

    const { data, error } = await materializeDefaultCrew(supabase, {
      truckId: truck_id,
      startDay: start_day,
      endDay: end_day,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_truck_crew_materialize_failed', error.message);
    return ok({ copied: data?.copied ?? 0 });
  } catch (e: any) {
    return routeError(500, 'planning_truck_crew_week_unexpected', e?.message || 'Failed to update week crew');
  }
}
