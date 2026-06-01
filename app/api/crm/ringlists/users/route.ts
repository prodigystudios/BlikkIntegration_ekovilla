// getSupabaseAdmin: listing assignable users requires reading profiles across all
// users, which session-scoped RLS would restrict to the requesting user's own profile.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listAssignableCrmUsers } from '@/lib/domains/crm/ringlists';
import { ok, requireCrmAdmin, routeError } from '../_lib';

export async function GET() {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response) return crmAdmin.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await listAssignableCrmUsers(supabase);

    if (error) {
      return routeError(500, 'crm_ringlists_users_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_ringlists_users_unexpected', e?.message || 'Failed to list assignable users');
  }
}