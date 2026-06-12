import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listAllDepots, createDepot } from '@/lib/domains/planning/depots';
import { ok, routeError, validationError, requirePermission, createDepotSchema } from '../_lib';

// All depots (incl inactive) — readable by anyone who can read the schedule (board lanes / pickers).
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listAllDepots(supabase);
    if (error) return routeError(500, 'planning_depots_list_failed', error.message);

    return ok({ depots: data || [] });
  } catch (e: any) {
    return routeError(500, 'planning_depots_list_unexpected', e?.message || 'Failed to list depots');
  }
}

// Add a depot.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const parsed = createDepotSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createDepot(supabase, { name: parsed.data.name, location: parsed.data.location ?? null });
    if (error) return routeError(500, 'planning_depot_create_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_depot_create_unexpected', e?.message || 'Failed to create depot');
  }
}
