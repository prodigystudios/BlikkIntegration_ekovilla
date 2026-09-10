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
    if (error) {
      // ops_expected_deliveries.depot_id är ON DELETE RESTRICT, och den spärren vet inget om status
      // — kvitterad och avbokad historik håller emot precis som en utestående leverans. En depå som
      // använts en gång går alltså inte att radera, med flit: historiken ska inte kunna raderas
      // bort under fötterna på lagersaldot. Men säg det på svenska, i stället för att skicka vidare
      // "violates foreign key constraint" till någon som tryckte på en knapp.
      if ((error as { code?: string }).code === '23503') {
        return routeError(
          409,
          'planning_depot_in_use',
          'Depån har leveranshistorik och kan inte tas bort. Avaktivera den i stället — då försvinner den ur listorna men historiken finns kvar.',
        );
      }
      return routeError(500, 'planning_depot_delete_failed', error.message);
    }

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_depot_delete_unexpected', e?.message || 'Failed to delete depot');
  }
}
