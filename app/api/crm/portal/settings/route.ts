import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { userCanWriteWorkOrders } from '@/lib/domains/portal/assignment';
import { setPortalFallbackUser } from '@/lib/domains/portal/resellers';
import { ok, routeError, validationError, requirePermission } from '../../_shared';

const bodySchema = z.object({
  // null = ingen reserv: ett jobb som inte hittar någon annan tas då inte emot (William 2026-09-28).
  fallback_user_id: z.string().uuid('Välj en säljare i listan').nullable(),
});

// Sätt reserven, steg 4 i fördelningen av portalens jobb (RESELLER_PORTAL_CRM_PLAN.md fas 3a). Säljare eller admin,
// så länge den kan skriva arbetsordrar (William 2026-09-28).
//
// Sparandet går med sessionen (RLS: crm.portal.manage, kolumngrant på fallback_user_id). Behörighetsfrågan om en annan
// användare går med service-rollen. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function PUT(req: Request) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const userId = parsed.data.fallback_user_id;
    if (userId && !(await userCanWriteWorkOrders(getSupabaseAdmin(), userId))) {
      return routeError(422, 'portal_assignee_cannot_write', 'Den valda användaren kan inte skriva arbetsordrar.');
    }

    const outcome = await setPortalFallbackUser(createSessionClient(), userId, gate.currentUser.id);
    switch (outcome.kind) {
      case 'saved':
        return ok({ fallback_user_id: outcome.userId });
      case 'not_found':
        // Raden skapas av migreringen och tas aldrig bort; saknas den har migreringen inte körts.
        return routeError(500, 'portal_settings_missing', 'Portalens inställningar saknas i databasen.');
      case 'forbidden':
        return routeError(403, 'forbidden', 'Forbidden');
      case 'db_error':
        return routeError(500, 'portal_settings_save_failed', outcome.message);
    }
  } catch (e: any) {
    return routeError(500, 'portal_settings_unexpected', e?.message || 'Reserven kunde inte sparas');
  }
}
