// getSupabaseAdmin: listing assignable users reads profiles across all users, which
// session-scoped RLS would restrict to the requesting user's own profile.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listAssignableCrmUsers } from '@/lib/domains/crm/ringlists';
import { ok, requirePermission, routeError } from '../_lib';

export async function GET() {
  try {
    // ⚠️ `crm.workorder.read` och INTE den grova `requireCrmUser()` (= `crm.access`).
    //
    // Rollmängden är IDENTISK — admin, konsult och sales bär båda nycklarna
    // (20260608_permissions_model.sql), så ingen befintlig roll märker bytet. Skälet är en roll som
    // ska läsa ARBETSORDRAR och ingenting annat: lönebyrån, som tar fram fakturaunderlag.
    // `crm.access` hade gett dem /api/crm/reports, /sellers och /calc-settings på köpet — och de
    // tre läser med getSupabaseAdmin(), alltså förbi RLS. En extern part hade fått företagets
    // försäljningssiffror och inköpspriser genom en nyckel som bara skulle öppna en orderlista.
    //
    // Det är också riktningen _shared.ts pekar ut: grova metanycklar ersätts av per-resursnycklar
    // på de rutter som faktiskt handlar om en resurs.
    const crmUser = await requirePermission('crm.workorder.read');
    if (crmUser.response) return crmUser.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await listAssignableCrmUsers(supabase);

    if (error) {
      return routeError(500, 'crm_work_order_assignees_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_assignees_unexpected', e?.message || 'Failed to list assignees');
  }
}
