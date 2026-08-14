import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { periodRange, periodStartOf } from '@/lib/domains/time/approvals';
import { listCompensations } from '@/lib/domains/time/compensations';
import { listTimeEntries, toSummarizableEntry, type TimeEntryRow } from '@/lib/domains/time/entries';
import { summarizePerson } from '@/lib/domains/time/summary';
import { ok, personPeriodQuerySchema, requirePermission, routeError, validationError } from '@/app/api/time/_lib';

// GET /api/admin/time/entries?period=YYYY-MM&user_id=<uuid> — en persons månad, dag för dag.
//
// Det lönepersonen bad om, ordagrant: "starttid, sluttid och total arbetad tid". Attestöversikten
// (../approvals) svarar bara med månadsaggregat, och ett aggregat går inte att granska — det är
// summan av det man vill titta på. Den här routen är därför inte en bekvämlighet: den är det enda
// stället där någon annan än den anställde kan se HUR timmarna uppstod.
//
// Extra vikt sedan piloten blåstes av (2026-08-14): parallellkörningen mot Blikk, som skulle ha
// jämfört summorna maskinellt, blir inte av. Kontroller görs i stället för hand — och då är
// läsbarheten här ersättningen för kvittot.
//
// ⚠️ NYCKELN ÄR `time.entry.read.all`, INTE `time.approve`. De sitter på samma roll i seeden, så
// valet syns inte i dag — men RLS:en på crm_time_entries och crm_time_compensations släpper igenom
// andras rader på just read.all. Vaktade routen på time.approve skulle en person som fått
// attesträtt per användarundantag (`set_user_permission`) få ett TOMT svar i stället för ett nekat:
// noll rader ser likadant ut som "har inte rapporterat något", och det är fel besked att ge någon
// som ska attestera en månad.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('time.entry.read.all');
    if (gate.response || !gate.currentUser) return gate.response;

    const url = new URL(req.url);
    const parsed = personPeriodQuerySchema.safeParse({
      period: url.searchParams.get('period'),
      user_id: url.searchParams.get('user_id'),
    });
    if (!parsed.success) return validationError(parsed.error);

    const periodStart = periodStartOf(parsed.data.period);
    const range = periodRange(periodStart);
    // Gemener. Postgres jämför `uuid` skiftlägesokänsligt och zods uuid() släpper igenom versaler,
    // så en versal parameter hade gett rader tillbaka — med gemena user_id, som summarizePersons
    // strikta jämförelse sedan filtrerat bort allihop. Svaret hade blivit en tom månad med status
    // 200: "har inte rapporterat något" om någon som rapporterat hela augusti.
    const userId = parsed.data.user_id.toLowerCase();
    const supabase = createRouteHandlerClient({ cookies });

    // Sessionsklient, inte getSupabaseAdmin(): read.all-grenen i RLS är redan svaret på "får den
    // här personen se andras tid", och service-role hade öppnat hela databasen för att slippa den.
    const [entries, compensations] = await Promise.all([
      listTimeEntries(supabase, range, { userId }),
      listCompensations(supabase, range, { userId }),
    ]);
    if (entries.error) return routeError(500, 'time_entries_failed', entries.error.message);
    if (compensations.error) return routeError(500, 'time_compensations_failed', compensations.error.message);

    const summary = summarizePerson(
      ((entries.data ?? []) as unknown as TimeEntryRow[]).map(toSummarizableEntry),
      range,
      userId,
    );

    return ok({
      period_start: periodStart,
      user_id: userId,
      ...summary,
      compensations: compensations.data ?? [],
    });
  } catch (e: any) {
    return routeError(500, 'admin_time_entries_unexpected', e?.message || 'Kunde inte hämta personens tid');
  }
}
