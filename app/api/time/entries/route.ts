import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { buildTimeEntryRow, createTimeEntry, listTimeEntries } from '@/lib/domains/time/entries';
import { createTimeEntrySchema, ok, periodLockError, rangeQuerySchema, requirePermission, requireSignedInUser, routeError, validationError } from '../_lib';

// GET /api/time/entries?from&to — den inloggades tidrader i perioden.
//
// Ingen userId-parameter. Dagens Blikk-motsvarighet tar en (app/api/blikk/time-reports/route.ts) och
// använder den utan behörighetskontroll, så vem som helst kan läsa vem som helsts tid med ?userId=.
// Här sköter RLS avgränsningen: man ser sitt eget, och den som har time.entry.read.all ser allas.
// Löneunderlaget (fas 4.5) blir en egen route med en egen nyckel, inte en parameter på den här.
export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const url = new URL(req.url);
    const parsed = rangeQuerySchema.safeParse({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.from > parsed.data.to) return routeError(400, 'invalid_range', 'Från-datum är efter till-datum');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listTimeEntries(supabase, parsed.data, { userId: user.currentUser.id });
    if (error) return routeError(500, 'time_entries_list_failed', error.message);

    return ok({ items: data ?? [] });
  } catch (e: any) {
    return routeError(500, 'time_entries_unexpected', e?.message || 'Kunde inte hämta tidrader');
  }
}

// POST /api/time/entries — rapportera tid.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createTimeEntrySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    // Minuterna räknas HÄR, ur klockslagen — aldrig ur något klienten skickar.
    const built = buildTimeEntryRow(parsed.data, gate.currentUser.id);
    if (built.error || !built.row) return routeError(400, 'time_entry_invalid', built.error || 'Ogiltig tidrad');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createTimeEntry(supabase, built.row);
    if (error) {
      // Periodlåset först: låstriggern kastar (P0001) INNAN RLS:ens with check hinner utvärderas —
      // Postgres kör before-triggers före policykontrollen — så en stängd månad känns igen här och
      // får sitt eget meddelande i stället för att felaktigt läsas som en åtkomstfråga.
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      // RLS nekar med noll rader; de vanligaste orsakerna är att man inte når arbetsordern eller
      // saknar time.entry.write. Säg det i stället för att skicka vidare ett rått Postgres-fel.
      if (error.code === 'PGRST116' || error.code === '42501') {
        return routeError(403, 'time_entry_forbidden', 'Du kan inte rapportera tid på det här jobbet');
      }
      return routeError(500, 'time_entry_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'time_entry_create_unexpected', e?.message || 'Kunde inte spara tidraden');
  }
}
