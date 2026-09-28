import { getSupabaseAdmin } from '@/lib/supabase/server';
import { runPortalCron } from '@/lib/domains/portal/cron';
import { markPortalJobForSync } from '@/lib/domains/portal/jobSync';
import { requeueDeadPortalEvent } from '@/lib/domains/portal/outbox';
import { invalidUuidParam, ok, routeError, requirePermission } from '../../../../_shared';

export const maxDuration = 300;

type RouteContext = { params: { id: string } };

// "Skicka om" en uppgiven händelse på portalsidans flik Utskick (fas 4b). Bara den senaste för sitt jobb (eller
// prislistan): se requeueDeadPortalEvent. En bekräftelse som skickas om markerar jobbet, så att planerat datum och
// resten följer när den levererats. Sedan ett varv som "Skicka väntande nu".
//
// Service-rollen: kön skrivs bara av service_role. Grinden är crm.portal.manage; indata är bara händelsens id. Se
// "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const admin = getSupabaseAdmin();
    const now = new Date();
    const result = await requeueDeadPortalEvent(admin, context.params.id, now);
    switch (result.kind) {
      case 'not_found':
        return routeError(404, 'portal_event_not_found', 'Händelsen finns inte.');
      case 'not_dead':
        return routeError(409, 'portal_event_not_dead', 'Händelsen är inte uppgiven; den ligger redan i kön eller har skickats.');
      case 'superseded_by_later':
        return routeError(409, 'portal_event_superseded', 'En senare händelse för samma jobb har redan skickats eller väntar. Den här skickas inte om.');
      case 'requeued':
        break;
    }
    if (result.orderingKey.startsWith('job:')) await markPortalJobForSync(admin, result.orderingKey.slice(4), now);

    const summary = await runPortalCron(admin, { env: process.env });
    return ok({ requeued: true, summary });
  } catch (e: any) {
    return routeError(500, 'portal_event_retry_unexpected', e?.message || 'Händelsen kunde inte skickas om');
  }
}
