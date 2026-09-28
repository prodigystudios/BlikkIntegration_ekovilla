import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { userCanWriteWorkOrders } from '@/lib/domains/portal/assignment';
import { RESELLER_ID_PATTERN, setResellerSeller } from '@/lib/domains/portal/resellers';
import { ok, routeError, validationError, requirePermission } from '../../../_shared';

type RouteContext = { params: { resellerId: string } };

const bodySchema = z.object({
  // null = ingen egen säljare: jobbet går vidare i kedjan (kundansvarig, länet, reserven).
  seller_user_id: z.string().uuid('Välj en säljare i listan').nullable(),
});

// Sätt butikens säljare, steg 1 i fördelningen av portalens jobb (RESELLER_PORTAL_CRM_PLAN.md fas 3a).
//
// Sparandet går med sessionen (RLS: crm.portal.manage, kolumngrant på seller_user_id). Att den valda kan skriva
// arbetsordrar prövas med service-rollen, eftersom en annan användares behörigheter inte är läsbara för sessionen.
// Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    let resellerId = '';
    try {
      resellerId = decodeURIComponent(context.params.resellerId);
    } catch {
      // En trasig procentkod (`%E0`) är ett fel i förfrågan, inte ett 500.
    }
    if (!RESELLER_ID_PATTERN.test(resellerId)) return routeError(400, 'invalid_reseller_id', 'Ogiltigt butiks-id.');

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const sellerUserId = parsed.data.seller_user_id;
    if (sellerUserId && !(await userCanWriteWorkOrders(getSupabaseAdmin(), sellerUserId))) {
      return routeError(422, 'portal_assignee_cannot_write', 'Den valda användaren kan inte skriva arbetsordrar.');
    }

    const outcome = await setResellerSeller(createSessionClient(), resellerId, sellerUserId, gate.currentUser.id);
    switch (outcome.kind) {
      case 'saved':
        return ok({ reseller_id: resellerId, seller_user_id: outcome.userId });
      case 'not_found':
        return routeError(404, 'portal_reseller_not_found', 'Butiken finns inte.');
      case 'forbidden':
        return routeError(403, 'forbidden', 'Forbidden');
      case 'db_error':
        return routeError(500, 'portal_reseller_save_failed', outcome.message);
    }
  } catch (e: any) {
    return routeError(500, 'portal_reseller_unexpected', e?.message || 'Butikens säljare kunde inte sparas');
  }
}
