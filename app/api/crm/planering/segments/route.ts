import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listSegments, listTrucks, placeSegment } from '@/lib/domains/planning/schedule';
import { ok, routeError, validationError, requirePermission, listSegmentsQuerySchema, placeSegmentSchema } from '../_lib';

// Schedule (segments overlapping a date window) + the active trucks to render lanes for.
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
    const [segRes, truckRes] = await Promise.all([
      listSegments(supabase, { from: parsed.data.from, to: parsed.data.to }),
      listTrucks(supabase),
    ]);
    if (segRes.error) return routeError(500, 'planning_segments_failed', segRes.error.message);
    if (truckRes.error) return routeError(500, 'planning_trucks_failed', truckRes.error.message);

    return ok({ segments: segRes.data || [], trucks: truckRes.data || [] });
  } catch (e: any) {
    return routeError(500, 'planning_segments_unexpected', e?.message || 'Failed to load schedule');
  }
}

// Place a work order on a truck/day-range (creates an ops_segment).
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = placeSegmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await placeSegment(supabase, {
      workOrderId: parsed.data.work_order_id,
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      sortIndex: parsed.data.sort_index,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_segment_create_failed', error.message);

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_segment_create_unexpected', e?.message || 'Failed to place segment');
  }
}
