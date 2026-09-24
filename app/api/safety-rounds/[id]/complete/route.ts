import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { completionProblems } from '@/lib/domains/safetyRounds/completion';
import { getSafetyRoundBundle, updateSafetyRound } from '@/lib/domains/safetyRounds/store';
import { writeFailure } from '../../_lib';

// Slutför ronden: prövar samma regler som formuläret visar (completion.ts) och sätter status
// `completed`. Vem och när sätts av triggern i databasen, inte här. Därefter är rondinfo, deltagare
// och checklista låsta; handlingsplanens uppföljning lever vidare.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: bundle, error } = await getSafetyRoundBundle(supabase, context.params.id);
    if (error) return routeError(500, 'safety_round_read_failed', error.message);
    if (!bundle) return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
    if (bundle.round.status === 'completed') {
      return routeError(409, 'safety_round_already_completed', 'Ronden är redan slutförd.');
    }

    const problems = completionProblems(bundle);
    if (problems.length > 0) {
      return routeError(400, 'safety_round_incomplete', problems[0].message, { problems });
    }

    const { data, error: updateError } = await updateSafetyRound(supabase, context.params.id, { status: 'completed' });
    if (updateError || !data) return writeFailure(updateError, 'ronden');
    return ok({ round: data });
  } catch (e: unknown) {
    console.error('[safety-rounds] slutför:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_complete_unexpected', 'Kunde inte slutföra skyddsronden.');
  }
}
