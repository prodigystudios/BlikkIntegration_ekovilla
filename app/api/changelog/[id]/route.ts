import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import { ok, routeError, validationError, invalidUuidParam } from '@/lib/api/responses';
import { updateChangelogEntrySchema } from '@/lib/domains/changelog/schemas';
import { getEntry } from '@/lib/domains/changelog/queries';
import {
  buildEntryUpdatePatch,
  deleteChangelogEntry,
  updateChangelogEntry,
} from '@/lib/domains/changelog/mutations';
import type { ChangelogEntryRow } from '@/lib/domains/changelog/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Både PATCH och DELETE gäller BARA fritt skrivna poster. En ärendehärledd rad tas ur changeloggen
// genom att avpubliceras på sitt ärende — den texten ägs där.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsed = updateChangelogEntrySchema.safeParse(rawBody ?? {});
    if (!parsed.success) return validationError(parsed.error);

    const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody) : [];

    const supabase = createRouteHandlerClient({ cookies });
    // Nuläget behövs för att avgöra publiceringstidpunkten: en redan publicerad post ska BEHÅLLA
    // sin, annars flyttas gamla poster till toppen så fort man rättar ett stavfel.
    const { data: current, error: readError } = await getEntry(supabase, params.id);
    if (readError) return routeError(500, 'changelog_get_failed', readError.message);
    if (!current) return routeError(404, 'not_found', 'Posten hittades inte.');

    const patch = buildEntryUpdatePatch(parsed.data, sentKeys, new Date().toISOString(), {
      published_at: (current as ChangelogEntryRow).published_at,
    });
    // updated_at ligger alltid i patchen; finns inget mer är det en tom sparning.
    if (Object.keys(patch).length <= 1) return routeError(400, 'nothing_to_update', 'Inget att spara.');

    const { data, error } = await updateChangelogEntry(supabase, params.id, patch);
    if (error) return routeError(500, 'changelog_update_failed', error.message);
    if (!data) return routeError(403, 'forbidden', 'Du kan inte ändra den här posten.');

    return ok({ entry: data });
  } catch (e: any) {
    return routeError(500, 'changelog_unexpected', e?.message || 'Failed to update changelog entry');
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
    if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');

    const badId = invalidUuidParam(params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteChangelogEntry(supabase, params.id);
    if (error) return routeError(500, 'changelog_delete_failed', error.message);
    if (!data) return routeError(404, 'not_found', 'Posten hittades inte.');

    return ok({ deleted: true });
  } catch (e: any) {
    return routeError(500, 'changelog_unexpected', e?.message || 'Failed to delete changelog entry');
  }
}
