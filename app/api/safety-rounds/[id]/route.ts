import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { invalidUuidParam, ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { completionProblems, summarizeItems } from '@/lib/domains/safetyRounds/completion';
import { leaderIdForName } from '@/lib/domains/safetyRounds/rules';
import { roundPatchSchema } from '@/lib/domains/safetyRounds/schemas';
import { deleteSafetyRound, getSafetyRoundBundle, listChecklistCategories, updateSafetyRound } from '@/lib/domains/safetyRounds/store';
import type { SafetyRound } from '@/lib/domains/safetyRounds/types';
import { requireSafetyRoundReader, writeFailure } from '../_lib';

// EN skyddsrond: hämta allt formuläret behöver, spara rondinfo, ta bort ett utkast.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const guard = await requireSafetyRoundReader();
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const [{ data, error }, categories] = await Promise.all([
      getSafetyRoundBundle(supabase, context.params.id),
      listChecklistCategories(supabase),
    ]);
    if (error) return routeError(500, 'safety_round_read_failed', error.message);
    if (!data) return routeError(404, 'safety_round_not_found', 'Skyddsronden hittades inte.');
    if (categories.error) console.warn('[safety-rounds] kategorierna:', categories.error.message);

    return ok({
      ...data,
      // Katalogens kategorier — var en egen punkt kan läggas. Bästa-försök: utan dem går det bara att
      // lägga egna punkter i kategorier som ronden redan har.
      categories: categories.error ? [] : categories.data ?? [],
      summary: summarizeItems(data.items),
      // Samma lista som slutför-rutten nekar med — formuläret visar den i stället för att gissa.
      problems: completionProblems(data),
      can_write: guard.canWrite,
    });
  } catch (e: unknown) {
    console.error('[safety-rounds] hämta:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_read_unexpected', 'Kunde inte hämta skyddsronden.');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response || !guard.currentUser) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = roundPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const patch: Partial<SafetyRound> = { ...parsed.data };
    // Rondledarens profil följer namnet — se leaderIdForName.
    if ('leader_name' in parsed.data) patch.leader_id = leaderIdForName(parsed.data.leader_name ?? null, guard.currentUser);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateSafetyRound(supabase, context.params.id, patch);
    if (error || !data) return writeFailure(error, 'rondinfo');
    return ok({ round: data });
  } catch (e: unknown) {
    console.error('[safety-rounds] spara rondinfo:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_update_unexpected', 'Kunde inte spara rondinfon.');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    // Bara ett utkast går att ta bort (policyn). En slutförd rond är ett protokoll.
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteSafetyRound(supabase, context.params.id);
    if (error || !data) return writeFailure(error, 'ronden');
    return ok({ id: data.id });
  } catch (e: unknown) {
    console.error('[safety-rounds] ta bort:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_delete_unexpected', 'Kunde inte ta bort skyddsronden.');
  }
}
