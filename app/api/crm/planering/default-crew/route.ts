import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listAllDefaultCrew } from '@/lib/domains/planning/defaultCrew';
import { ok, routeError, requirePermission } from '../_lib';

// All trucks' default crew (standardbemanning), for the board's lane fallback + the admin editor.
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listAllDefaultCrew(supabase);
    if (error) return routeError(500, 'planning_default_crew_failed', error.message);

    return ok({ crew: data });
  } catch (e: any) {
    return routeError(500, 'planning_default_crew_unexpected', e?.message || 'Failed to load default crew');
  }
}
