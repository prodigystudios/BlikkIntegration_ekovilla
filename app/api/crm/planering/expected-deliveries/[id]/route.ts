import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cancelExpectedDelivery, updateExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updateExpectedDeliverySchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Ändra en väntad leverans.
//
// Finns för att en flyttad leverans inte ska behöva avbokas och läggas upp på nytt: avbokningen
// tappar spåret av vad som faktiskt beställdes, och den nya raden ser ut som en andra beställning.
//
// planning.depot.manage, samma gräns som att lägga in den — att ändra vad som är beställt är samma
// besked som att beställa. (Ankomsten går inte här, se receive.)
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updateExpectedDeliverySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateExpectedDelivery(supabase, context.params.id, {
      depotId: parsed.data.depot_id,
      material: parsed.data.material,
      sacks: parsed.data.sacks,
      expectedOn: parsed.data.expected_on,
      note: parsed.data.note,
    });
    if (error) return routeError(500, 'planning_expected_delivery_update_failed', error.message);
    // ⚠️ Noll matchande rader svarar `error: null` i PostgREST. Raden kan vara kvitterad, avbokad
    // eller osynlig bakom RLS — och en kvitterad rad SKA inte gå att ändra, eftersom lagerraden den
    // gav upphov till då hade sagt något annat. Tigande hade lästs som "sparat".
    if (!data) {
      return routeError(409, 'planning_expected_delivery_not_open', 'Leveransen är redan kvitterad eller avbruten');
    }

    await logActivity(supabase, gate.currentUser, {
      action: 'expected_delivery.update',
      entityType: 'expected_delivery',
      entityId: context.params.id,
      summary: `Ändrade väntad leverans: ${data.sacks} säck ${data.material} (${data.expected_on})`,
      details: parsed.data as Record<string, unknown>,
    });

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_expected_delivery_update_unexpected', e?.message || 'Failed to update expected delivery');
  }
}

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
