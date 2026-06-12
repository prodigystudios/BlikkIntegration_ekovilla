import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { copyTruckCrewWeek } from '@/lib/domains/planning/truckCrew';
import { ok, routeError, validationError, requirePermission, copyTruckCrewSchema } from '../../_lib';

// Copy a truck's crew from one week to another (e.g. this week → next week), skipping anyone already
// on the target week.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = copyTruckCrewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await copyTruckCrewWeek(supabase, {
      truckId: parsed.data.truck_id,
      sourceFrom: parsed.data.source_start,
      sourceTo: parsed.data.source_end,
      targetFrom: parsed.data.target_start,
      targetTo: parsed.data.target_end,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_truck_crew_copy_failed', error.message);

    return ok({ copied: data?.copied ?? 0 });
  } catch (e: any) {
    return routeError(500, 'planning_truck_crew_copy_unexpected', e?.message || 'Failed to copy truck crew');
  }
}
