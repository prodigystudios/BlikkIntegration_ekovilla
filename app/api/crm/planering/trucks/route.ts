import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listAllTrucks, createTruck } from '@/lib/domains/planning/trucks';
import { ok, routeError, validationError, requirePermission, createTruckSchema } from '../_lib';

// All trucks (incl inactive) for the fleet-management panel.
export async function GET() {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listAllTrucks(supabase);
    if (error) return routeError(500, 'planning_trucks_list_failed', error.message);

    return ok({ trucks: data || [] });
  } catch (e: any) {
    return routeError(500, 'planning_trucks_list_unexpected', e?.message || 'Failed to list trucks');
  }
}

// Add a truck.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const parsed = createTruckSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createTruck(supabase, { name: parsed.data.name, color: parsed.data.color ?? null });
    if (error) return routeError(500, 'planning_truck_create_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_truck_create_unexpected', e?.message || 'Failed to create truck');
  }
}
