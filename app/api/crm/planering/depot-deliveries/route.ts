import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createDelivery } from '@/lib/domains/planning/depotStock';
import { ok, routeError, validationError, requirePermission, createDeliverySchema } from '../_lib';

// Record a delivery of sacks into a depot (stock in).
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createDeliverySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createDelivery(supabase, {
      depotId: parsed.data.depot_id,
      material: parsed.data.material,
      sacks: parsed.data.sacks,
      deliveredOn: parsed.data.delivered_on,
      note: parsed.data.note ?? null,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_depot_delivery_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_depot_delivery_unexpected', e?.message || 'Failed to record delivery');
  }
}
