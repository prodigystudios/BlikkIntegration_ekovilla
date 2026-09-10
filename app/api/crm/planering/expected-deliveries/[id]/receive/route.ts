import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { receiveExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, receiveExpectedDeliverySchema } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Kvittera ankomst: den väntade raden blir en riktig lagerrad.
//
// planning.schedule.write, inte depot.manage: att ta emot gods är lagerarbete, samma nyckel som
// "Registrera leverans" redan kräver. Med admin-grinden här hade ingen annan kunnat kvittera en
// leverans som stod på depån en fredag. Att BESTÄLLA är fortfarande depot.manage.
//
// 🧨 SESSIONSKLIENTEN. receive_expected_delivery är SECURITY DEFINER och prövar has_permission, som
// nycklar på auth.uid() — under service-role är den null och grinden nekar alltid.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = receiveExpectedDeliverySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { deliveryId, error } = await receiveExpectedDelivery(supabase, {
      expectedId: context.params.id,
      deliveredOn: parsed.data.delivered_on,
      sacks: parsed.data.sacks,
      note: parsed.data.note ?? null,
    });

    if (error) {
      // Databasen äger regeln "ta emot en gång" — en dubbelkvittering är en dubbeldebitering av
      // lagret, inte ett gränssnittsfel. Översätt de förväntade avslagen till begripliga svar i
      // stället för att skicka vidare ett Postgres-meddelande.
      const message = error.message || '';
      if (message.includes('expected_not_open')) {
        return routeError(409, 'planning_expected_delivery_not_open', 'Leveransen är redan kvitterad eller avbruten');
      }
      if (message.includes('expected_not_found')) {
        return routeError(404, 'planning_expected_delivery_missing', 'Den väntade leveransen finns inte');
      }
      if (message.includes('delivered_on_in_future')) {
        return routeError(400, 'planning_expected_delivery_future', 'Ankomstdatum kan inte ligga i framtiden');
      }
      return routeError(500, 'planning_expected_delivery_receive_failed', message || 'Kunde inte kvittera leveransen');
    }

    await logActivity(supabase, gate.currentUser, {
      action: 'expected_delivery.receive',
      entityType: 'expected_delivery',
      entityId: context.params.id,
      summary: `Bekräftade ankomst: ${parsed.data.sacks} säck (${parsed.data.delivered_on})`,
      details: { delivery_id: deliveryId, sacks: parsed.data.sacks, delivered_on: parsed.data.delivered_on },
    });

    return ok({ delivery_id: deliveryId }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_expected_delivery_receive_unexpected', e?.message || 'Failed to receive delivery');
  }
}
