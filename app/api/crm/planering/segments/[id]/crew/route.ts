import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { assignCrew, unassignCrew } from '@/lib/domains/planning/crew';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, assignCrewSchema } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Assign a crew member to this placement (besättning på jobbet).
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = assignCrewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await assignCrew(supabase, {
      segmentId: context.params.id,
      memberId: parsed.data.member_id,
      memberName: parsed.data.member_name,
      actorUserId: gate.currentUser.id,
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return routeError(409, 'planning_crew_already_assigned', 'Personen är redan tillagd på jobbet.');
      }
      return routeError(500, 'planning_crew_assign_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_crew_assign_unexpected', e?.message || 'Failed to assign crew');
  }
}

// Remove a crew member from this placement (?member_id=…).
export async function DELETE(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const memberId = new URL(req.url).searchParams.get('member_id') || undefined;
    const badMember = invalidUuidParam(memberId);
    if (badMember) return badMember;

    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await unassignCrew(supabase, context.params.id, memberId as string);
    if (error) return routeError(500, 'planning_crew_unassign_failed', error.message);

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_crew_unassign_unexpected', e?.message || 'Failed to remove crew');
  }
}
