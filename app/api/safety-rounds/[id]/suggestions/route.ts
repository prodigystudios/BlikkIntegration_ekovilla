import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { dedupeDirectory } from '@/lib/domains/crm/kmaPlans/directory';
import { listKmaDirectory } from '@/lib/domains/crm/kmaPlans/store';
import { listWorkOrderCrew } from '@/lib/domains/planning/workOrderCrew';
import { getSafetyRound } from '@/lib/domains/safetyRounds/store';

// Namnförslagen i ronden: Kontaktlistan (rondledare, skyddsombud, ansvarig för en åtgärd) och
// besättningen på ordern (deltagare med profil, så att PR 3 kan låta dem kvittera själva).
//
// Båda källorna är bästa-försök. Kontaktlistan läser varje inloggad; besättningen kräver
// planning.schedule.read, och utan den blir listan tom — en rondledare utan planeringsåtkomst skriver
// namnen själv. Ett fel i en källa loggas och ger en tom lista, aldrig ett fel i formuläret.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: round, error } = await getSafetyRound(supabase, context.params.id);
    if (error) return routeError(500, 'safety_round_read_failed', error.message);
    if (!round) return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');

    const [directory, crew] = await Promise.all([
      listKmaDirectory(supabase),
      listWorkOrderCrew(supabase, round.work_order_id),
    ]);
    if (directory.error) console.warn('[safety-rounds] kontaktlistan:', directory.error.message);
    if (crew.error) console.warn('[safety-rounds] besättningen:', crew.error.message);

    return ok({
      directory: directory.error ? [] : dedupeDirectory(directory.data ?? []),
      crew: crew.error ? [] : crew.data,
    });
  } catch (e: unknown) {
    console.error('[safety-rounds] förslag:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_suggestions_unexpected', 'Kunde inte hämta namnförslagen.');
  }
}
