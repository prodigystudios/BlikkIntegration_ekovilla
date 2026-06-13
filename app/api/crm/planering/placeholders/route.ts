import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createPlaceholderSegment } from '@/lib/domains/planning/schedule';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, requirePermission, createPlaceholderSchema } from '../_lib';

// Create a placeholder placement — a booked truck/day slot a sales rep blocks before the real CRM
// work order exists, so other planners see something is booked. Linking it to the real order later
// is a separate slice.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createPlaceholderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createPlaceholderSegment(supabase, {
      title: parsed.data.title,
      customer: parsed.data.customer ?? null,
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      jobType: parsed.data.job_type,
      actorUserId: gate.currentUser.id,
      actorName: gate.currentUser.name ?? null,
    });
    if (error) return routeError(500, 'planning_placeholder_create_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'segment.create',
      entityType: 'segment',
      entityId: data?.id ?? null,
      segmentId: data?.id ?? null,
      summary: `Placerade platshållare "${parsed.data.title}"`,
      details: { truck_id: parsed.data.truck_id, start_day: parsed.data.start_day, end_day: parsed.data.end_day, placeholder: true },
    });

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_placeholder_create_unexpected', e?.message || 'Failed to create placeholder');
  }
}
