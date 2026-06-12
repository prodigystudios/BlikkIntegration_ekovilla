import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { unassignTruckCrew } from '@/lib/domains/planning/truckCrew';
import { ok, routeError, invalidUuidParam, requirePermission } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Remove a crew member from a truck's rota.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await unassignTruckCrew(supabase, context.params.id);
    if (error) return routeError(500, 'planning_truck_crew_unassign_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_truck_crew_unassign_unexpected', e?.message || 'Failed to remove truck crew');
  }
}
