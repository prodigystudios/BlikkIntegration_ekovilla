import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getPlanningInsights } from '@/lib/domains/planning/insights';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { ok, routeError, requirePermission } from '../_lib';

// Forward-looking planning insights (scheduled revenue/sacks per week, per truck, per material +
// unplanned backlog value). Read-only aggregation over the next `weeks` weeks (default 8).
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const weeksParam = Number(new URL(req.url).searchParams.get('weeks'));
    const weeks = Number.isFinite(weeksParam) && weeksParam >= 1 && weeksParam <= 26 ? Math.floor(weeksParam) : 8;
    // Swedish day, not the server's UTC day. mondayOf() below turns a one-day error into a full
    // week's shift of the chart axis, so between 00:00 and 02:00 this disagreed with the board
    // rendered right beside it.
    const fromISO = stockholmTodayISO();

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getPlanningInsights(supabase, { fromISO, weeks });
    if (error) return routeError(500, 'planning_insights_failed', error.message);

    return ok(data);
  } catch (e: any) {
    return routeError(500, 'planning_insights_unexpected', e?.message || 'Failed to load insights');
  }
}
