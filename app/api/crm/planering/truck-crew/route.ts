import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listTruckCrew, assignTruckCrew } from '@/lib/domains/planning/truckCrew';
import { ok, routeError, validationError, requirePermission, listSegmentsQuerySchema, assignTruckCrewSchema } from '../_lib';

// Truck crew rows overlapping the visible window.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const url = new URL(req.url);
    const parsed = listSegmentsQuerySchema.safeParse({
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listTruckCrew(supabase, { from: parsed.data.from, to: parsed.data.to });
    if (error) return routeError(500, 'planning_truck_crew_failed', error.message);

    return ok({ crew: data });
  } catch (e: any) {
    return routeError(500, 'planning_truck_crew_unexpected', e?.message || 'Failed to load truck crew');
  }
}

// Assign a crew member to a truck for a date range.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = assignTruckCrewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await assignTruckCrew(supabase, {
      truckId: parsed.data.truck_id,
      memberId: parsed.data.member_id,
      memberName: parsed.data.member_name,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      actorUserId: gate.currentUser.id,
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return routeError(409, 'planning_truck_crew_already_assigned', 'Personen är redan i bilbesättningen den veckan.');
      }
      return routeError(500, 'planning_truck_crew_assign_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_truck_crew_assign_unexpected', e?.message || 'Failed to assign truck crew');
  }
}
