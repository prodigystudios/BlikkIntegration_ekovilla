import { createSessionClient } from '@/lib/supabase/session';
import { z } from 'zod';
import { searchWorkOrdersForTimeReport } from '@/lib/domains/crm/work-orders';
import { ok, requirePermission, routeError, validationError } from '../_lib';

// GET /api/time/work-orders?q= — order search for the time report's job picker.
//
// WHY A SEPARATE ROUTE from the office one (/api/crm/work-orders): that route is gated by
// requireCrmUser, so it answers 403 for the very people who report time in the field. This one is
// gated by `time.entry.write` — the key that says "may write a time entry at all" — and returns
// the four fields the picker renders, nothing else.
//
// SCOPE IS RLS. The session client is passed on purpose: an installer sees the orders they are crew
// on, which is the same set crm_time_entries' INSERT policy lets them write against. So the search
// can only ever offer jobs the save would accept, and nothing here needs to re-derive that rule.
//
// The picker still LEADS with the day's scheduled jobs (get_my_crm_jobs). This is the way out when
// the work happened on another day than the one it was planned for.

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  // Two characters before we ask the database: a one-letter ilike matches most of the register and
  // the answer would be noise either way.
  q: z.string().trim().min(2, 'Sök på minst två tecken').max(64),
});

export async function GET(req: Request) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response) return gate.response;

    const parsed = QuerySchema.safeParse({ q: new URL(req.url).searchParams.get('q') ?? '' });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createSessionClient();
    const { data, error } = await searchWorkOrdersForTimeReport(supabase, parsed.data.q);
    if (error) return routeError(500, 'time_work_order_search_failed', error.message);

    return ok({ items: data });
  } catch (e: any) {
    return routeError(500, 'time_work_order_search_unexpected', e?.message || 'Kunde inte söka arbetsordrar');
  }
}
