import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { ok, routeError, validationError, requireCrmUser } from '@/app/api/crm/_shared';
import { fetchCrmOverviewSummary, type CrmOverviewWindow } from '@/lib/domains/crm/overviewSummary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)');

// The overview asks for eight days at most (today plus the rolling seven). The margin is for a
// reader whose calendar day differs from the server's, not for arbitrary history.
const MAX_WINDOW_DAYS = 31;

function daysBetween(fromDay: string, toDay: string) {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

const querySchema = z.object({
  today: dateSchema,
  since: dateSchema,
  week_start: dateSchema,
  week_end: dateSchema,
});

// The window comes from the client, the way the reports route takes its range. The reader's own
// clock is the one that decides what "this week" and "the last 7 days" mean, and the server runs on
// UTC — computing the boundaries here would quietly move them for anyone whose calendar day differs
// from the server's. Passing them in also keeps the figures identical to what the page showed when
// it did this arithmetic in the browser.
export async function GET(req: Request) {
  try {
    // Same gate as the rest of the CRM reads: every seller may see the team's figures.
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      today: url.searchParams.get('today') || undefined,
      since: url.searchParams.get('since') || undefined,
      week_start: url.searchParams.get('week_start') || undefined,
      week_end: url.searchParams.get('week_end') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const window: CrmOverviewWindow = {
      today: parsed.data.today,
      since: parsed.data.since,
      weekStart: parsed.data.week_start,
      weekEnd: parsed.data.week_end,
    };
    if (window.since > window.today) return routeError(400, 'invalid_window', 'Fönstrets start måste ligga före idag.');
    if (window.weekStart >= window.weekEnd) return routeError(400, 'invalid_window', 'Veckans start måste ligga före dess slut.');
    // A ceiling on the width, not just the direction. The window is client-supplied, and
    // `since=1970-01-01` would turn three bounded reads into full-table scans on demand — for any
    // authenticated CRM user, konsult included. The page never asks for more than eight days.
    if (daysBetween(window.since, window.today) > MAX_WINDOW_DAYS) {
      return routeError(400, 'invalid_window', `Fönstret får vara högst ${MAX_WINDOW_DAYS} dagar.`);
    }

    // Session client on purpose: RLS decides what the reader may count, exactly as it did when the
    // page counted list rows. The task figures are personal precisely because of that policy.
    const supabase = createRouteHandlerClient({ cookies });
    const summary = await fetchCrmOverviewSummary(supabase, window);

    return ok({ summary });
  } catch (e: any) {
    return routeError(500, 'crm_overview_summary_failed', e?.message || 'Kunde inte räkna översiktens siffror.');
  }
}
