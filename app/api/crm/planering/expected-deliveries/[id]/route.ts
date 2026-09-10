import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cancelExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, invalidUuidParam, requirePermission } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Avbryt en väntad leverans.
//
// Raden raderas inte, den får status 'cancelled': den är revision över vad vi trodde skulle komma,
// och en beställning som ströks är ett beslut värt att kunna se i efterhand. Domänfunktionen
// villkorar dessutom på status 'expected', så en redan kvitterad ankomst inte går att avbryta i
// efterhand — då hade lagerraden blivit kvar utan förklaring.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await cancelExpectedDelivery(supabase, context.params.id);
    if (error) return routeError(500, 'planning_expected_delivery_cancel_failed', error.message);
    // ⚠️ PostgREST svarar `error: null` när noll rader matchade — raden kan vara redan kvitterad,
    // avbruten eller osynlig bakom RLS. Tigande skulle läsas som "avbruten", och den väntade
    // leveransen stod kvar på tavlan.
    if (!data) return routeError(409, 'planning_expected_delivery_not_open', 'Leveransen är redan kvitterad eller avbruten');

    await logActivity(supabase, gate.currentUser, {
      action: 'expected_delivery.cancel',
      entityType: 'expected_delivery',
      entityId: context.params.id,
      summary: 'Avbröt en väntad leverans',
    });

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_expected_delivery_cancel_unexpected', e?.message || 'Failed to cancel expected delivery');
  }
}
