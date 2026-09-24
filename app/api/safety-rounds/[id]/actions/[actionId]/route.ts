import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { isFollowUpOnlyPatch } from '@/lib/domains/safetyRounds/rules';
import { actionPatchSchema } from '@/lib/domains/safetyRounds/schemas';
import { deleteAction, getSafetyRound, itemBelongsToRound, updateAction } from '@/lib/domains/safetyRounds/store';
import { writeFailure } from '../../../_lib';

// Ändra eller ta bort en rad i handlingsplanen.
//
// I ett utkast får allt ändras. När ronden är slutförd får bara UPPFÖLJNINGEN ändras (status,
// uppföljt datum, effekt, notering) — triggern i databasen spärrar resten, och rutten svarar på det
// i förväg med ett begripligt meddelande. Ta bort går bara i ett utkast (delete-policyn).
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; actionId: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.actionId);
    if (badId) return badId;

    const parsed = actionPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: round, error: roundError } = await getSafetyRound(supabase, context.params.id);
    if (roundError) return routeError(500, 'safety_round_read_failed', roundError.message);
    if (!round) return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');

    if (round.status === 'completed' && !isFollowUpOnlyPatch(parsed.data)) {
      return routeError(409, 'safety_round_locked', 'Ronden är slutförd. Bara uppföljningen av åtgärden kan ändras.');
    }

    if (parsed.data.item_id) {
      const { data: belongs, error: itemError } = await itemBelongsToRound(supabase, context.params.id, parsed.data.item_id);
      if (itemError) return routeError(500, 'safety_round_action_failed', itemError.message);
      if (!belongs) return routeError(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');
    }

    const { data, error } = await updateAction(supabase, context.params.id, context.params.actionId, parsed.data);
    if (error || !data) return writeFailure(error, 'åtgärden');
    return ok({ action: data });
  } catch (e: unknown) {
    console.error('[safety-rounds] ändra åtgärd:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_action_unexpected', 'Kunde inte spara åtgärden.');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id) ?? invalidUuidParam(context.params.actionId);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteAction(supabase, context.params.id, context.params.actionId);
    if (error || !data) return writeFailure(error, 'åtgärden');
    return ok({ id: data.id });
  } catch (e: unknown) {
    console.error('[safety-rounds] ta bort åtgärd:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_action_unexpected', 'Kunde inte ta bort åtgärden.');
  }
}
