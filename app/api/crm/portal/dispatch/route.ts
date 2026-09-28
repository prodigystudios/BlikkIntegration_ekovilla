import { getSupabaseAdmin } from '@/lib/supabase/server';
import { dispatchPortalOutbox } from '@/lib/domains/portal/outbox';
import { ok, routeError, requirePermission } from '../../_shared';

// Utskicket tar nya händelser i 60 s, och ett anrop får ta 10 s (lib/domains/portal/outbox.ts).
export const maxDuration = 90;

// "Skicka väntande nu": skickar det som står i kön till portalen (RESELLER_PORTAL_CRM_PLAN.md). Testmiljön har ingen
// cron, och i prod slipper den som just publicerat vänta på nästa körning.
//
// Service-rollen: kön töms bara av service_role (claim_portal_outbound_events). Grinden är crm.portal.manage; routen
// skickar bara det som redan är köat och tar ingen indata. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function POST() {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const summary = await dispatchPortalOutbox(getSupabaseAdmin(), { env: process.env });
    if (!summary.ran) {
      return routeError(409, 'portal_integration_off', `Integrationen med portalen är inte påslagen här. ${summary.reason}`);
    }
    return ok(summary);
  } catch (e: any) {
    return routeError(500, 'portal_dispatch_unexpected', e?.message || 'Kön kunde inte skickas');
  }
}
