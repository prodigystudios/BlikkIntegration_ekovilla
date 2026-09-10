import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listExpectedInRange, createExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, requirePermission, listSegmentsQuerySchema, createExpectedDeliverySchema } from '../_lib';

// Väntade leveranser i det synliga fönstret — tavlans leveransremsa.
//
// Läsning är board-nivå (planning.schedule.read): raden bär bara depå, material, antal och datum,
// och en planerare som får se schemat ska se att det kommer material.
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
    const { data, error } = await listExpectedInRange(supabase, { from: parsed.data.from, to: parsed.data.to });
    if (error) return routeError(500, 'planning_expected_deliveries_failed', error.message);

    return ok({ expected: data });
  } catch (e: any) {
    return routeError(500, 'planning_expected_deliveries_unexpected', e?.message || 'Failed to load expected deliveries');
  }
}

// Lägg in en väntad leverans.
//
// planning.depot.manage, inte schedule.write: att säga att material är på väg ÄR inköpsbeslutet,
// samma gräns som materialbeställningen till fabriken kommer kräva. Att ta emot godset är däremot
// lagerarbete och ligger på schedule.write — se [id]/receive.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createExpectedDeliverySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createExpectedDelivery(supabase, {
      depotId: parsed.data.depot_id,
      material: parsed.data.material,
      sacks: parsed.data.sacks,
      expectedOn: parsed.data.expected_on,
      note: parsed.data.note ?? null,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_expected_delivery_create_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'expected_delivery.add',
      entityType: 'expected_delivery',
      entityId: data?.id ?? null,
      summary: `La in väntad leverans: ${parsed.data.sacks} säck ${parsed.data.material} (${parsed.data.expected_on})`,
      details: { depot_id: parsed.data.depot_id, material: parsed.data.material, sacks: parsed.data.sacks, expected_on: parsed.data.expected_on },
    });

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_expected_delivery_create_unexpected', e?.message || 'Failed to create expected delivery');
  }
}
