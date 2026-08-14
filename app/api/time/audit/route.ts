import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { auditInRange, listTimeEntryAudit, type TimeEntryAuditRow } from '@/lib/domains/time/audit';
import { ok, rangeQuerySchema, requireSignedInUser, routeError, validationError } from '@/app/api/time/_lib';

// GET /api/time/audit?from&to — "har någon annan rört min tid?"
//
// Den anställdes egen insyn i revisionsloggen. Att en admin kan rätta någons timmar är försvarbart
// bara om den det gäller kan se att det hänt — annars är loggen en försäkring för kontoret och inte
// för den vars lön det handlar om.
//
// INGEN userId-parameter, av samma skäl som /api/time/entries: den här ytan är "min egen tid", och
// att se andras går genom time.entry.read.all och adminytan. RLS på crm_time_entry_audit gör samma
// avgränsning en gång till.
//
// Loggen innehåller bara ändringar som NÅGON ANNAN gjort — triggern hoppar över egna sparningar med
// flit. Ett tomt svar betyder alltså "ingen har rört din tid".
export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const url = new URL(req.url);
    const parsed = rangeQuerySchema.safeParse({
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listTimeEntryAudit(supabase, { userId: user.currentUser.id });
    if (error) return routeError(500, 'time_audit_failed', error.message);

    // Intervallet gäller radens ARBETSDATUM, som bor i jsonb — se listTimeEntryAudit.
    const items = ((data ?? []) as unknown as TimeEntryAuditRow[]).filter((row) => auditInRange(row, parsed.data));
    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'time_audit_unexpected', e?.message || 'Kunde inte hämta ändringsloggen');
  }
}
