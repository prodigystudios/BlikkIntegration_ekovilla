import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateJobType, deleteJobType } from '@/lib/domains/planning/jobTypes';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updateJobTypeSchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Rename / recolor / (de)activate / reorder a job type (key stays fixed).
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updateJobTypeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateJobType(supabase, context.params.id, {
      label: parsed.data.label,
      color: parsed.data.color,
      active: parsed.data.active,
      sortIndex: parsed.data.sort_index,
    });
    if (error) return routeError(500, 'planning_job_type_update_failed', error.message);

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_job_type_update_unexpected', e?.message || 'Failed to update job type');
  }
}

// Delete a job type. Segments still carrying its key resolve to a neutral chip.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.truck.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await deleteJobType(supabase, context.params.id);
    if (error) return routeError(500, 'planning_job_type_delete_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_job_type_delete_unexpected', e?.message || 'Failed to delete job type');
  }
}
