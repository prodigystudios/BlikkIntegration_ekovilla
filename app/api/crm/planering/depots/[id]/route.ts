import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateDepot, deleteDepot } from '@/lib/domains/planning/depots';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updateDepotSchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Rename / relocate / (de)activate a depot.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updateDepotSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateDepot(supabase, context.params.id, {
      name: parsed.data.name,
      location: parsed.data.location,
      active: parsed.data.active,
    });
    if (error) return routeError(500, 'planning_depot_update_failed', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_depot_update_unexpected', e?.message || 'Failed to update depot');
  }
}

// Delete a depot. Trucks referencing it are ON DELETE SET NULL.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await deleteDepot(supabase, context.params.id);
    if (error) return routeError(500, 'planning_depot_delete_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_depot_delete_unexpected', e?.message || 'Failed to delete depot');
  }
}
