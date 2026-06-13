import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listActivityEvents } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, requirePermission, listActivityQuerySchema } from '../_lib';

// The planning activity log (audit trail): newest-first, keyset-paginated by `before`, with optional
// actor/action/search filters. Read-only — events are written best-effort by the mutation routes.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const url = new URL(req.url);
    const parsed = listActivityQuerySchema.safeParse({
      before: url.searchParams.get('before') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      actor: url.searchParams.get('actor') || undefined,
      action: url.searchParams.get('action') || undefined,
      search: url.searchParams.get('search') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listActivityEvents(supabase, {
      limit: parsed.data.limit ?? 100,
      before: parsed.data.before ?? null,
      actor: parsed.data.actor ?? null,
      action: parsed.data.action ?? null,
      search: parsed.data.search ?? null,
    });
    if (error) return routeError(500, 'planning_activity_failed', error.message);

    return ok({ events: data });
  } catch (e: any) {
    return routeError(500, 'planning_activity_unexpected', e?.message || 'Failed to load activity log');
  }
}
