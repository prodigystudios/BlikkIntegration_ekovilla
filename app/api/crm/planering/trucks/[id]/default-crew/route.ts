import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { replaceDefaultCrew, validateDefaultCrew } from '@/lib/domains/planning/defaultCrew';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, replaceDefaultCrewSchema } from '../../../_lib';

type RouteContext = { params: { id: string } };

// Replace a truck's standing team (standardbemanning) in one go.
export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = replaceDefaultCrewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const invalid = validateDefaultCrew(parsed.data.members);
    if (invalid === 'too_many_leaders') return routeError(400, 'too_many_leaders', 'Ett team kan bara ha en teamledare.');
    if (invalid === 'empty_name') return routeError(400, 'empty_name', 'Alla i teamet måste ha ett namn.');

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await replaceDefaultCrew(supabase, context.params.id, parsed.data.members, gate.currentUser.id);
    if (error) return routeError(500, 'planning_default_crew_save_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'truck_crew.default',
      entityType: 'truck_crew',
      entityId: context.params.id,
      summary: `Uppdaterade standardbemanning (${parsed.data.members.length} personer)`,
      details: { truck_id: context.params.id },
    });

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_default_crew_save_unexpected', e?.message || 'Failed to save default crew');
  }
}
