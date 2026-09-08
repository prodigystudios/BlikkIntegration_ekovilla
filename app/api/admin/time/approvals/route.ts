import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { toSwedishE164 } from '@/lib/phone';
import { listTimeApprovalOverview, normalizeOverviewRow, periodStartOf, type TimeApprovalOverviewRow } from '@/lib/domains/time/approvals';
import { timeReminderHref } from '@/lib/domains/time/reminders';
import { can, getEffectivePermissions, ok, periodQuerySchema, requirePermission, routeError, validationError } from '@/app/api/time/_lib';

// GET /api/admin/time/approvals?period=YYYY-MM — attestvyns underlag.
//
// Alla anställda × månaden: status, rapporterade timmar, frånvaro och ersättningar. Ligger under
// /api/admin med flit — det är kontorets yta, inte den anställdes, och /api/time/** ska förbli
// "min egen tid" utan en enda parameter som öppnar för andras.
//
// SESSIONSKLIENT, inte getSupabaseAdmin(). Läsningen kräver att man ser andras profiler, vilket
// self-select-RLS:en på profiles annars hindrar — men lösningen är RPC:n time_approval_overview,
// som är security definer med has_permission('time.approve') som första rad. Urvalet är
// säkerhetsgränsen; service-role hade öppnat hela databasen för att slippa en radpolicy.
export async function GET(req: Request) {
  try {
    const gate = await requirePermission('time.approve');
    if (gate.response || !gate.currentUser) return gate.response;

    const url = new URL(req.url);
    const parsed = periodQuerySchema.safeParse({ period: url.searchParams.get('period') });
    if (!parsed.success) return validationError(parsed.error);

    const periodStart = periodStartOf(parsed.data.period);
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listTimeApprovalOverview(supabase, periodStart);
    if (error) return routeError(500, 'time_approval_overview_failed', error.message);

    // ⚠️ ATT ATTESTERA OCH ATT RÄTTA ÄR TVÅ SKILDA NYCKLAR, och sedan rollen `ekonomi` finns är de
    // inte längre samma personer: lönebyrån attesterar men får aldrig ändra någons timmar.
    //
    // Klienten kan inte fråga efter sina egna behörigheter, så flaggan följer med underlaget. Utan
    // den ritade vyn "Rätta" och "Ta bort" på varje öppen rad för alla som kom in — knappar vars
    // enda utfall är ett 403 från PATCH:en. En knapp som inte kan lyckas är värre än ingen knapp:
    // den som trycker tror att systemet är trasigt, inte att hon saknar behörighet.
    //
    // getEffectivePermissions är React-cachad per request, så det här kostar ingen extra rundtur.
    const perms = await getEffectivePermissions();
    // Typad uttryckligen: RPC-svaret är `any`, och utan det blir varje efterföljande `row` en
    // implicit any som type-check inte kan säga något om.
    const people: TimeApprovalOverviewRow[] = ((data ?? []) as Record<string, unknown>[]).map(normalizeOverviewRow);

    return ok({
      period_start: periodStart,
      people,
      can_correct: can(perms, 'time.entry.write.all'),
      ...(await remindersEnrichment(people.map((row) => row.user_id), periodStart)),
    });
  } catch (e: any) {
    return routeError(500, 'time_approval_overview_unexpected', e?.message || 'Kunde inte hämta attestöversikten');
  }
}

/**
 * Två upplysningar som attestvyn behöver för påminnelseknappen: när personen senast påmindes om
 * just den här månaden, och om det ens finns ett telefonnummer att sms:a till.
 *
 * ⚠️ ADMINKLIENT, och det är två smala läsningar av två skäl som båda är RLS:
 *   • `notifications` är läsbar BARA för sin mottagare — attestansvarig kan alltså inte se att hon
 *     redan påmint någon, hur mycket behörighet hon än har.
 *   • `profiles` är self-select. Numret självt lämnar aldrig servern; klienten får en boolean, för
 *     den behöver bara veta om SMS-rutan har någon att gå till.
 *
 * 🧨 `ok: false` är inte samma sak som "ingen är påmind" och "ingen har nummer". Går läsningen fel
 * ska vyn TIGA om båda i stället för att rita frånvaron som ett faktum — annars ser en trasig
 * servicenyckel ut som att hela personalen saknar telefonnummer, och någon börjar leta i
 * profilerna efter ett fel som inte finns. Det är samma felklass som redan kostat på den här ytan:
 * fel som ser ut som tomma värden i stället för som fel.
 */
async function remindersEnrichment(userIds: string[], periodStart: string) {
  if (userIds.length === 0) return { reminders: {}, has_phone: {}, reminders_ok: true };
  try {
    const admin = getSupabaseAdmin();
    const [notifications, profiles] = await Promise.all([
      admin
        .from('notifications')
        .select('recipient_user_id, created_at')
        .eq('type', 'time.reminder')
        // Perioden bärs av href:en — notifications.entity_id är uuid-typad och en periodstart är
        // ingen uuid. `timeReminderHref` ägs av tid-domänen och anropas av BÅDA sidor, så
        // producenten och den här frågan inte kan glida isär. Se den funktionen.
        .eq('href', timeReminderHref(periodStart))
        .in('recipient_user_id', userIds)
        .order('created_at', { ascending: false }),
      admin.from('profiles').select('id, phone').in('id', userIds),
    ]);
    if (notifications.error || profiles.error) throw notifications.error || profiles.error;

    // Senast först i sorteringen, så den FÖRSTA raden per person är den senaste påminnelsen.
    const reminders: Record<string, string> = {};
    for (const row of (notifications.data ?? []) as { recipient_user_id: string; created_at: string }[]) {
      if (!reminders[row.recipient_user_id]) reminders[row.recipient_user_id] = row.created_at;
    }

    const has_phone: Record<string, boolean> = {};
    for (const row of (profiles.data ?? []) as { id: string; phone: string | null }[]) {
      // Samma normalisering som utskicket gör. Ett nummer som Twilio ändå hade avvisat ska räknas
      // som inget nummer här, annars lovar rutan ett SMS som tyst uteblir.
      has_phone[row.id] = toSwedishE164(row.phone) !== null;
    }

    return { reminders, has_phone, reminders_ok: true };
  } catch (e) {
    console.error('[time.reminder] kunde inte läsa påminnelsehistorik', e);
    return { reminders: {}, has_phone: {}, reminders_ok: false };
  }
}
