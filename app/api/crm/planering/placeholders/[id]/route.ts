import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updatePlaceholderSegment } from '@/lib/domains/planning/schedule';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updatePlaceholderSchema } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Redigera en platshållare: titel, kund, bil, datum, jobbtyp — och de två fälten som gör den till
// ett fältjobb (synlig för entreprenad + arbetsbeskrivning).
//
// Egen route i stället för segments/[id] PATCH: den vägen äger placeringen (dra, ändra längd,
// pausa, ordna) och gäller alla segment. Det här är platshållarens egen identitet, och den finns
// bara på rader utan arbetsorder — updatePlaceholderSegment spärrar därefter.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updatePlaceholderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.start_day && parsed.data.end_day && parsed.data.end_day < parsed.data.start_day) {
      return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error, notFound } = await updatePlaceholderSegment(supabase, context.params.id, {
      title: parsed.data.title,
      customer: parsed.data.customer,
      truckId: parsed.data.truck_id,
      startDay: parsed.data.start_day,
      endDay: parsed.data.end_day,
      jobType: parsed.data.job_type,
      fieldVisible: parsed.data.field_visible,
      workDescription: parsed.data.work_description,
    });
    if (error) {
      // Ett ensidigt datumbyte (bara start_day eller bara end_day) går inte att intervallkolla mot
      // den befintliga raden ovan, så ett omvänt intervall fångas av DB-CHECKen. Samma svar som
      // move-routen ger. Se segments/[id]/route.ts.
      if ((error as { code?: string }).code === '23514') {
        return routeError(400, 'invalid_range', 'Slutdatum kan inte vara före startdatum.');
      }
      return routeError(500, 'planning_placeholder_update_failed', error.message);
    }
    if (notFound || !data) {
      return routeError(404, 'planning_placeholder_not_found', 'Platshållaren finns inte längre, eller är ett riktigt jobb.');
    }

    // Synligheten loggas uttryckligen när den ändras: det är den enda ändringen här som får en
    // konsekvens utanför tavlan — raden dyker upp hos, eller försvinner från, ett gäng
    // installatörer. En rad som bara säger "Uppdaterade" hade dolt just det.
    const title = data.placeholder_title ?? 'platshållare';
    const summary =
      parsed.data.field_visible === true
        ? `Publicerade platshållare "${title}" för entreprenaden`
        : parsed.data.field_visible === false
          ? `Dolde platshållare "${title}" för entreprenaden`
          : `Uppdaterade platshållare "${title}"`;

    await logActivity(supabase, gate.currentUser, {
      action: 'segment.update',
      entityType: 'segment',
      entityId: context.params.id,
      segmentId: context.params.id,
      summary,
      details: { ...parsed.data, placeholder: true },
    });

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_placeholder_update_unexpected', e?.message || 'Failed to update placeholder');
  }
}
