import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { deleteProductivityRate, upsertProductivityRate } from '@/lib/domains/crm/calcSettings';
import { ok, requireCrmAdmin, routeError, upsertProductivityRateSchema, validationError } from '../_lib';

// Produktivitet per konstruktion och material — m³ per timme och TEAM.
//
// ⚠️ EN TOM RUTA ÄR EN BORTTAGNING, INTE EN NOLLA. `m3_per_hour: null` i kroppen tar bort raden, så
// offerten säger "produktivitet saknas" i stället för att dela med noll. Databasens
// `check (m3_per_hour > 0)` avvisar nollan ändå — det här är den begripliga vägen till samma sak.
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response || !crmAdmin.currentUser) return crmAdmin.response;

    const parsedBody = upsertProductivityRateSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const { construction, material, m3_per_hour: rate } = parsedBody.data;
    const supabase = createRouteHandlerClient({ cookies });

    if (rate == null) {
      const { error } = await deleteProductivityRate(supabase, construction, material);
      if (error) {
        return routeError(500, 'crm_productivity_rate_delete_failed', error.message);
      }
      // Noll borttagna rader är inte ett fel här: rutan var redan tom, och utfallet är det önskade.
      return ok({ construction, material, m3_per_hour: null });
    }

    const { data, error } = await upsertProductivityRate(supabase, {
      construction,
      material,
      m3PerHour: rate,
      userId: crmAdmin.currentUser.id,
    });
    if (error || !data) {
      return routeError(500, 'crm_productivity_rate_upsert_failed', error?.message || 'Kunde inte spara takten.');
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_productivity_rate_unexpected', e?.message || 'Failed to save productivity rate');
  }
}
