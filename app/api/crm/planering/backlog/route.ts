import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listSchedulableWorkOrders } from '@/lib/domains/planning/backlog';
import { ok, routeError, requirePermission } from '../_lib';

// CRM work orders eligible to be scheduled (the planning backlog). Source of jobs = CRM.
export async function GET() {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listSchedulableWorkOrders(supabase);
    if (error) return routeError(500, 'planning_backlog_failed', error.message);

    return ok({ items: data });
  } catch (e: any) {
    return routeError(500, 'planning_backlog_unexpected', e?.message || 'Failed to load backlog');
  }
}
