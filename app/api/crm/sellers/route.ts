import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listCrmSellers } from '@/lib/domains/crm/customers';
import { ok, requireCrmUser, routeError } from '../_shared';

// Läs-katalog över säljare (profiles med role sales/admin) för kundansvarig-väljaren.
// profiles-RLS är self-only, så teamet läses med en elevated klient — en avgränsad,
// admin-hanterad läsmodell med minimala fält (id/namn/roll), gated av crm.access.
export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = getSupabaseAdmin();
    const sellers = await listCrmSellers(supabase);
    return ok({ sellers });
  } catch (e: any) {
    return routeError(500, 'crm_sellers_list_failed', e?.message || 'Kunde inte hämta säljare');
  }
}
