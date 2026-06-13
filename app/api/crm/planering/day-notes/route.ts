import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listDayNotes, createDayNote } from '@/lib/domains/planning/dayNotes';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, requirePermission, listSegmentsQuerySchema, createDayNoteSchema } from '../_lib';

// Day notes whose day falls inside the visible window.
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
    const { data, error } = await listDayNotes(supabase, { from: parsed.data.from, to: parsed.data.to });
    if (error) return routeError(500, 'planning_day_notes_failed', error.message);

    return ok({ notes: data });
  } catch (e: any) {
    return routeError(500, 'planning_day_notes_unexpected', e?.message || 'Failed to load day notes');
  }
}

// Pin a note to a day.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createDayNoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createDayNote(supabase, {
      noteDay: parsed.data.note_day,
      body: parsed.data.body,
      actorUserId: gate.currentUser.id,
    });
    if (error) return routeError(500, 'planning_day_note_create_failed', error.message);

    await logActivity(supabase, gate.currentUser, {
      action: 'day_note.add',
      entityType: 'day_note',
      entityId: data?.id ?? null,
      summary: `La till dagsanteckning (${parsed.data.note_day})`,
      details: { note_day: parsed.data.note_day },
    });

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_day_note_create_unexpected', e?.message || 'Failed to create day note');
  }
}
