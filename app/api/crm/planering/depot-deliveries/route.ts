import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createDelivery, listDeliveriesInRange } from '@/lib/domains/planning/depotStock';
import { ok, routeError, validationError, requirePermission, listSegmentsQuerySchema, createDeliverySchema } from '../_lib';

// Leveranser vars datum faller i det synliga fönstret — tavlans leveransremsa.
//
// Läsning är board-nivå (planning.schedule.read), samma som segment och dagsanteckningar: en
// planerare som får se schemat ska se att det kommer material. Att REGISTRERA en leverans är
// fortfarande planning.schedule.write, se POST nedan.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const url = new URL(req.url);
    const parsed = listSegmentsQuerySchema.safeParse({
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listDeliveriesInRange(supabase, { from: parsed.data.from, to: parsed.data.to });
    if (error) return routeError(500, 'planning_depot_deliveries_failed', error.message);

    return ok({ deliveries: data });
  } catch (e: any) {
    return routeError(500, 'planning_depot_deliveries_unexpected', e?.message || 'Failed to load deliveries');
  }
}

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
