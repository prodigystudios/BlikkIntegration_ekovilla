import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateTruck, deleteTruck } from '@/lib/domains/planning/trucks';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updateTruckSchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Rename / recolor / (de)activate a truck.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updateTruckSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateTruck(supabase, context.params.id, {
      name: parsed.data.name,
      color: parsed.data.color,
      active: parsed.data.active,
      depotId: parsed.data.depot_id,
    });
    if (error) return routeError(500, 'planning_truck_update_failed', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_truck_update_unexpected', e?.message || 'Failed to update truck');
  }
}

// Delete a truck. A truck still used by a placement is FK-restricted (23503) — surface a friendly
// "deactivate instead" message rather than a raw DB error.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await deleteTruck(supabase, context.params.id);
    if (error) {
      if ((error as { code?: string }).code === '23503') {
        return routeError(409, 'truck_in_use', 'Bilen används av schemalagda jobb — avaktivera den istället.');
      }
      return routeError(500, 'planning_truck_delete_failed', error.message);
    }

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_truck_delete_unexpected', e?.message || 'Failed to delete truck');
  }
}
