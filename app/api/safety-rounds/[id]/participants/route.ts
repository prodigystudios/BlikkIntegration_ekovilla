import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { participantCreateSchema } from '@/lib/domains/safetyRounds/schemas';
import { PARTICIPANTS, insertParticipant, nextPosition } from '@/lib/domains/safetyRounds/store';
import { insertFailure } from '../../_lib';

// Lägg till en deltagare. Bara i ett utkast (insert-policyn). `round_id` ur rutt-parametern, aldrig
// ur kroppen.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const roundId = context.params.id;
    const badId = invalidUuidParam(roundId);
    if (badId) return badId;

    const parsed = participantCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const position = await nextPosition(supabase, PARTICIPANTS, roundId);
    if (position.error || position.data == null) {
      return routeError(500, 'safety_round_participant_failed', position.error?.message || 'Kunde inte lägga till deltagaren.');
    }

    const { data, error } = await insertParticipant(supabase, { ...parsed.data, round_id: roundId, position: position.data });
    if (error || !data) return insertFailure(error, 'deltagaren');
    return ok({ participant: data }, 201);
  } catch (e: unknown) {
    console.error('[safety-rounds] ny deltagare:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_participant_unexpected', 'Kunde inte lägga till deltagaren.');
  }
}
