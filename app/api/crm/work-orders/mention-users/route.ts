// getSupabaseAdmin: listing all profiles for @-mention suggestions reads across users,
// which session-scoped RLS would restrict to the requesting user's own profile.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listMentionableProfiles } from '@/lib/domains/crm/work-orders';
import { ok, requireSignedInUser, routeError } from '../_lib';

export async function GET() {
  try {
    // Any signed-in employee (incl. installers writing comments) can list mention targets.
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

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
