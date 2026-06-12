// getSupabaseAdmin: the crew picker lists every named employee (installers included), which reads
// across users — session RLS would restrict profiles to the requester's own row (same reason the
// @-mention list uses the admin client). Read access is still gated on planning.schedule.read.
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listMentionableProfiles } from '@/lib/domains/crm/work-orders';
import { ok, routeError, requirePermission } from '../_lib';

// People the planner can assign as crew on a segment.
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await listMentionableProfiles(supabase);
    if (error) return routeError(500, 'planning_crew_list_failed', error.message);

    const people = (data || [])
      .filter((p): p is { id: string; full_name: string } => Boolean(p.full_name))
      .map((p) => ({ id: p.id, full_name: p.full_name }));
    return ok({ people });
  } catch (e: any) {
    return routeError(500, 'planning_crew_list_unexpected', e?.message || 'Failed to list crew');
  }
}
