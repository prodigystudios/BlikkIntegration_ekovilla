import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, routeError, validationError, invalidUuidParam } from '@/lib/api/responses';
import { updateTicketSchema } from '@/lib/domains/support/schemas';
import { getTicket } from '@/lib/domains/support/queries';
import { buildTicketUpdatePatch, checkChangelogPublishable, updateTicket } from '@/lib/domains/support/mutations';
import { mapTicketRow } from '@/lib/domains/support/mappers';
import { getScreenshotUrl } from '@/lib/domains/support/storage';
import type { AppTicketRow } from '@/lib/domains/support/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    // RLS släpper igenom rapportören (egen rad) eller admin (alla). En rad man inte får se blir
    // null — svara 404, inte 500.
    const { data, error } = await getTicket(supabase, params.id);
    if (error) return routeError(500, 'app_ticket_get_failed', error.message);
    if (!data) return routeError(404, 'not_found', 'Ärendet hittades inte.');

    const row = data as AppTicketRow;
    // Skärmbilden signeras först här, efter att RLS redan avgjort att den här användaren får läsa
    // raden. Listan signerar inget — se kommentaren på has_screenshot i types.ts.
    const screenshot_url = row.screenshot_path
      ? await getScreenshotUrl(getSupabaseAdmin(), row.screenshot_bucket, row.screenshot_path)
      : null;

    return ok({ item: { ...mapTicketRow(row), screenshot_url } });
  } catch (e: any) {
    return routeError(500, 'app_tickets_unexpected', e?.message || 'Failed to load ticket');
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    // Bara admin ändrar ett ärende. Samma grind som RLS (app_tickets_update) — den här ger ett
    // ärligt 403 i stället för RLS:ens tysta noll-raders-UPDATE, som annars hade blivit ett 404.
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsed = updateTicketSchema.safeParse(rawBody ?? {});
    if (!parsed.success) return validationError(parsed.error);

    // Bara det klienten faktiskt skickade skrivs — annars hade en statusändring nollat ett svar
    // som redan stod i ärendet.
    const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody) : [];
    const patch = buildTicketUpdatePatch(parsed.data, sentKeys, { id: currentUser.id }, new Date().toISOString());
    // updated_at ligger alltid i patchen; finns inget mer är det en tom sparning.
    if (Object.keys(patch).length <= 1) return routeError(400, 'nothing_to_update', 'Inget att spara.');

    const supabase = createRouteHandlerClient({ cookies });
    const { data: current, error: readError } = await getTicket(supabase, params.id);
    if (readError) return routeError(500, 'app_ticket_get_failed', readError.message);
    if (!current) return routeError(404, 'not_found', 'Ärendet hittades inte.');

    // Changelog-publicering kräver både klarmarkering och en text. Kontrolleras mot nuläget +
    // patchen, eftersom båda kan sättas i samma sparning.
    const publishError = checkChangelogPublishable({
      patch,
      current: {
        status: String((current as AppTicketRow).status),
        changelog_note: (current as AppTicketRow).changelog_note,
      },
    });
    if (publishError) return routeError(400, 'changelog_not_publishable', publishError);

    const { data, error } = await updateTicket(supabase, params.id, patch);
    if (error) return routeError(500, 'app_ticket_update_failed', error.message);
    // Noll rader trots att läsningen ovan hittade raden = RLS nekade skrivningen.
    if (!data) return routeError(403, 'forbidden', 'Du kan inte ändra det här ärendet.');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'app_tickets_unexpected', e?.message || 'Failed to update ticket');
  }
}
