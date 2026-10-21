import { createSessionClient } from '@/lib/supabase/session';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, validationError } from '@/lib/api/responses';
import { createSystemNoticeSchema } from '@/lib/domains/systemNotices/schemas';
import { insertSystemNotice, listActiveSystemNotices, listRecentSystemNotices } from '@/lib/domains/systemNotices/queries';
import { systemNoticeEndProblem, toSystemNoticeView } from '@/lib/domains/systemNotices/notices';
import type { SystemNoticeRow } from '@/lib/domains/systemNotices/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin → Driftmeddelanden: aktiva och historik.
export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const supabase = createSessionClient();
    const [active, recent] = await Promise.all([
      listActiveSystemNotices(supabase, new Date().toISOString()),
      listRecentSystemNotices(supabase, 20),
    ]);
    if (active.error) return routeError(500, 'system_notices_list_failed', active.error.message);
    if (recent.error) return routeError(500, 'system_notices_list_failed', recent.error.message);

    // Alla aktiva, oavsett ålder, plus den senaste historiken — utan dubbletter.
    const rows = [...((active.data ?? []) as SystemNoticeRow[])];
    const seen = new Set(rows.map((r) => r.id));
    for (const r of (recent.data ?? []) as SystemNoticeRow[]) if (!seen.has(r.id)) rows.push(r);

    return ok({ notices: rows.map(toSystemNoticeView) });
  } catch (e: any) {
    return routeError(500, 'system_notices_unexpected', e?.message || 'Failed to list system notices');
  }
}

// Slår på ett nytt meddelande — det syns för alla inloggade vid deras nästa hämtning (inom en minut).
export async function POST(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const parsed = createSystemNoticeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const endProblem = systemNoticeEndProblem(parsed.data.ends_at, new Date());
    if (endProblem) return routeError(400, 'ends_at_in_past', endProblem);

    const supabase = createSessionClient();
    const { data, error } = await insertSystemNotice(supabase, {
      ...parsed.data,
      created_by: currentUser.id,
      created_by_name: currentUser.name || 'Okänd användare',
    });
    if (error || !data) return routeError(500, 'system_notice_create_failed', error?.message || 'Kunde inte spara meddelandet.');

    return ok({ notice: toSystemNoticeView(data as SystemNoticeRow) }, 201);
  } catch (e: any) {
    return routeError(500, 'system_notices_unexpected', e?.message || 'Failed to create system notice');
  }
}
