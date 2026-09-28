import { getSupabaseAdmin } from '@/lib/supabase/server';
import { runPortalCron } from '@/lib/domains/portal/cron';
import { ok, routeError, requirePermission } from '../../_shared';

// Samma varv som cron-routen: omräkningen, utskicket och Fortnox-försöken (lib/domains/portal/cron.ts).
export const maxDuration = 300;

// "Skicka väntande nu": gör det cron gör varje minut i prod. Testmiljön har ingen cron, och i prod slipper den som
// just publicerat eller skickat om vänta på nästa körning.
//
// Service-rollen: kön töms bara av service_role (claim_portal_outbound_events). Grinden är crm.portal.manage; routen
// tar ingen indata. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function POST() {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const summary = await runPortalCron(getSupabaseAdmin(), { env: process.env });
    const dispatch = summary.dispatch;
    if ('error' in dispatch) return routeError(500, 'portal_dispatch_failed', `Kön kunde inte skickas: ${dispatch.error}`);
    if (!dispatch.ran) {
      return routeError(409, 'portal_integration_off', `Integrationen med portalen är inte påslagen här. ${dispatch.reason}`);
    }
    const again = summary.redispatch && !('error' in summary.redispatch) && summary.redispatch.ran ? summary.redispatch : null;
    return ok({
      claimed: dispatch.claimed + (again?.claimed ?? 0),
      sent: dispatch.sent + (again?.sent ?? 0),
      retried: dispatch.retried + (again?.retried ?? 0),
      dead: dispatch.dead + (again?.dead ?? 0),
      summary,
    });
  } catch (e: any) {
    return routeError(500, 'portal_dispatch_unexpected', e?.message || 'Kön kunde inte skickas');
  }
}
