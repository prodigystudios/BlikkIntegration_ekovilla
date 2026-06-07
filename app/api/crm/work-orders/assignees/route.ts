// getSupabaseAdmin: listing assignable users reads profiles across all users, which
// session-scoped RLS would restrict to the requesting user's own profile.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listAssignableCrmUsers } from '@/lib/domains/crm/ringlists';
import { ok, requireCrmUser, routeError } from '../_lib';

export async function GET() {
  try {
    const crmUser = await requireCrmUser();
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
