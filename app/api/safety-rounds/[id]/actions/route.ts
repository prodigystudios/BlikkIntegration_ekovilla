import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { actionCreateSchema } from '@/lib/domains/safetyRounds/schemas';
import { ACTIONS, insertAction, itemBelongsToRound, nextPosition } from '@/lib/domains/safetyRounds/store';
import { writeFailure } from '../../_lib';

// Ny rad i handlingsplanen — bara i ett utkast (insert-policyn). Uppföljningen sker på raden efteråt.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const roundId = context.params.id;
    const badId = invalidUuidParam(roundId);
    if (badId) return badId;

    const parsed = actionCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });

    // "Från punkt" måste vara en punkt i SAMMA rond — foreign key:n ser bara att punkten finns.
    if (parsed.data.item_id) {
      const { data: belongs, error: itemError } = await itemBelongsToRound(supabase, roundId, parsed.data.item_id);
      if (itemError) return routeError(500, 'safety_round_action_failed', itemError.message);
      if (!belongs) return routeError(400, 'safety_round_invalid', 'Punkten hör inte till den här ronden.');
    }

    const position = await nextPosition(supabase, ACTIONS, roundId);
    if (position.error || position.data == null) {
      return routeError(500, 'safety_round_action_failed', position.error?.message || 'Kunde inte lägga till åtgärden.');
    }

    const { data, error } = await insertAction(supabase, { ...parsed.data, round_id: roundId, position: position.data });
    if (error || !data) {
      if (error?.code === '42501') return routeError(409, 'safety_round_locked', 'Ronden är slutförd. Handlingsplanen kan bara följas upp.');
      if (error?.code === '23503') return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
      return writeFailure(error, 'åtgärden');
    }
    return ok({ action: data }, 201);
  } catch (e: unknown) {
    console.error('[safety-rounds] ny åtgärd:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_action_unexpected', 'Kunde inte lägga till åtgärden.');
  }
}
