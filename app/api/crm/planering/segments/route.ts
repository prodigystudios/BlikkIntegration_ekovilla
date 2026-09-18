import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listSegments, listTrucks, placeSegment } from '@/lib/domains/planning/schedule';
import { logActivity } from '@/lib/domains/planning/activity';
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

    // `scopeSpans` är jobbens ALLA placeringar, även de utanför [from, to]. Tavlan behöver dem som
    // nämnare när den fördelar omsättningen över veckor — se fönsterfällan i listScopeSpans.
    return ok({ segments: segRes.data || [], trucks: truckRes.data || [], scopeSpans: segRes.scopeSpans || [] });
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
      stageId: parsed.data.stage_id ?? null,
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      sortIndex: parsed.data.sort_index,
      jobType: parsed.data.job_type,
      actorUserId: gate.currentUser.id,
      actorName: gate.currentUser.name ?? null,
    });
    if (error) return routeError(500, 'planning_segment_create_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'segment.create',
      entityType: 'segment',
      entityId: data?.id ?? null,
      segmentId: data?.id ?? null,
      workOrderId: parsed.data.work_order_id,
      // Etappen med i sammanfattningen: "Placerade #5418 Etapp 2 på kalendern". Utan den går det
      // inte att se i loggen VILKEN del av ett uppdelat jobb som bokades.
      summary: `Placerade ${data?.job?.ref ?? 'jobb'}${data?.job?.stage ? ` Etapp ${data.job.stage.number}` : ''} på kalendern`,
      details: {
        truck_id: parsed.data.truck_id,
        start_day: parsed.data.start_day,
        end_day: parsed.data.end_day,
        ...(parsed.data.stage_id ? { stage_id: parsed.data.stage_id } : {}),
      },
    });

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_segment_create_unexpected', e?.message || 'Failed to place segment');
  }
}
