// getSupabaseAdmin: listing all profiles for @-mention suggestions reads across users,
// which session-scoped RLS would restrict to the requesting user's own profile.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listMentionableProfiles } from '@/lib/domains/crm/work-orders';
import { ok, requireCrmUser, routeError } from '../_lib';

export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await listMentionableProfiles(supabase);

    if (error) {
      return routeError(500, 'crm_work_order_mention_users_failed', error.message);
    }

    return ok({ items: data || [] });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_mention_users_unexpected', e?.message || 'Failed to list mention users');
  }
}
