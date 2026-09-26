import { createSessionClient } from '@/lib/supabase/session';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { participantPatchSchema } from '@/lib/domains/safetyRounds/schemas';
import { deleteParticipant, updateParticipant } from '@/lib/domains/safetyRounds/store';
import { writeFailure } from '../../../_lib';

// Ändra eller ta bort en deltagare — bara i ett utkast.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; participantId: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.participantId);
    if (badId) return badId;

    const parsed = participantPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createSessionClient();
    const { data, error } = await updateParticipant(supabase, context.params.id, context.params.participantId, parsed.data);
    if (error || !data) return writeFailure(error, 'deltagaren');
    return ok({ participant: data });
  } catch (e: unknown) {
    console.error('[safety-rounds] ändra deltagare:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_participant_unexpected', 'Kunde inte spara deltagaren.');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.participantId);
    if (badId) return badId;

    const supabase = createSessionClient();
    const { data, error } = await deleteParticipant(supabase, context.params.id, context.params.participantId);
    if (error || !data) return writeFailure(error, 'deltagaren');
    return ok({ id: data.id });
  } catch (e: unknown) {
    console.error('[safety-rounds] ta bort deltagare:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_participant_unexpected', 'Kunde inte ta bort deltagaren.');
  }
}
