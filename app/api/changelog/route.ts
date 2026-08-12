import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, validationError } from '@/lib/api/responses';
import { createChangelogEntrySchema, listChangelogQuerySchema } from '@/lib/domains/changelog/schemas';
import { listAllEntries, listPublishedEntries, listPublishedTickets } from '@/lib/domains/changelog/queries';
import { createChangelogEntry, mapEntriesToDrafts } from '@/lib/domains/changelog/mutations';
import { mergeChangelog } from '@/lib/domains/changelog/merge';
import type { ChangelogEntryRow, ChangelogTicketRow } from '@/lib/domains/changelog/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');

    const url = new URL(req.url);
    const parsed = listChangelogQuerySchema.safeParse({
      scope: url.searchParams.get('scope') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });

    // Adminvyn: fria poster inklusive utkast, INTE sammanslagna med ärendena. Ärendehärledda rader
    // redigeras på sitt ärende — att visa dem som redigerbara här hade inbjudit till två vägar in
    // i samma text.
    if (parsed.data.scope === 'drafts') {
      if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');
      const { data, error } = await listAllEntries(supabase, parsed.data.limit);
      if (error) return routeError(500, 'changelog_list_failed', error.message);
      return ok({ entries: mapEntriesToDrafts(data as ChangelogEntryRow[] | null) });
    }

    // Den publika listan: båda källorna, sammanslagna och sorterade i TS. Två frågor i stället för
    // en vy i databasen — texterna bor i olika tabeller med olika ägare, och en SQL-vy hade låst
    // ihop dem.
    const [entries, tickets] = await Promise.all([
      listPublishedEntries(supabase, parsed.data.limit),
      listPublishedTickets(supabase, parsed.data.limit),
    ]);

    if (entries.error) return routeError(500, 'changelog_list_failed', entries.error.message);
    if (tickets.error) return routeError(500, 'changelog_list_failed', tickets.error.message);

    const items = mergeChangelog(
      entries.data as ChangelogEntryRow[] | null,
      tickets.data as ChangelogTicketRow[] | null,
    );

    return ok({ items: items.slice(0, parsed.data.limit) });
  } catch (e: any) {
    return routeError(500, 'changelog_unexpected', e?.message || 'Failed to list changelog');
  }
}

export async function POST(req: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const parsed = createChangelogEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createChangelogEntry(supabase, {
      ...parsed.data,
      created_by: currentUser.id,
      created_by_name: currentUser.name || 'Okänd användare',
      now: new Date().toISOString(),
    });

    if (error || !data) return routeError(500, 'changelog_create_failed', error?.message || 'Kunde inte spara posten.');

    return ok({ entry: data }, 201);
  } catch (e: any) {
    return routeError(500, 'changelog_unexpected', e?.message || 'Failed to create changelog entry');
  }
}
