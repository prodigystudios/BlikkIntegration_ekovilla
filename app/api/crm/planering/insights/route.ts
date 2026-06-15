import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getPlanningInsights } from '@/lib/domains/planning/insights';
import { ok, routeError, requirePermission } from '../_lib';

// Forward-looking planning insights (scheduled revenue/sacks per week, per truck, per material +
// unplanned backlog value). Read-only aggregation over the next `weeks` weeks (default 8).
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const weeksParam = Number(new URL(req.url).searchParams.get('weeks'));
    const weeks = Number.isFinite(weeksParam) && weeksParam >= 1 && weeksParam <= 26 ? Math.floor(weeksParam) : 8;
    const fromISO = new Date().toISOString().slice(0, 10);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getPlanningInsights(supabase, { fromISO, weeks });
    if (error) return routeError(500, 'planning_insights_failed', error.message);

    return ok(data);
  } catch (e: any) {
    return routeError(500, 'planning_insights_unexpected', e?.message || 'Failed to load insights');
  }
}
