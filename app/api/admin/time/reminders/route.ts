import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/publicOrigin';
import { toSwedishE164 } from '@/lib/phone';
import { sendSms } from '@/lib/sms';
import { buildTimeReminderNotification } from '@/lib/domains/notifications/payload';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { listTimeApprovalOverview, normalizeOverviewRow, periodStartOf, type TimeApprovalOverviewRow } from '@/lib/domains/time/approvals';
import {
  reminderNotificationText,
  reminderReasonFor,
  reminderSmsBody,
  timeReminderHref,
  type ReminderReason,
} from '@/lib/domains/time/reminders';
import { can, getEffectivePermissions, ok, requirePermission, routeError, sendTimeRemindersSchema, validationError } from '@/app/api/time/_lib';

// POST /api/admin/time/reminders — påminn en eller flera anställda om att fylla i sin tid.
//
// Attestens motsvarighet till "öppna perioden igen", fast åt andra hållet: den som inte lämnat in
// får en knuff i stället för att någon väntar tyst på henne. Notisen går alltid; SMS är ett tillval
// för den som inte öppnar appen av sig själv.
//
// ⚠️ ANLEDNINGEN HÄRLEDS HÄR, INTE I KLIENTEN. Vem som är värd att påminna och varför läses ur
// samma RPC som ritar listan (time_approval_overview), så texten aldrig kan påstå "du har inte
// rapporterat något" om någon som rapporterat hela månaden. Klienten skickar bara vilka.
//
// ⚠️ Och appen påstår ALDRIG hur mycket som fattas. Se lib/domains/time/reminders.ts — det är samma
// regel som gör att attestens staplar saknar trösklar.

// SMS skickas sekventiellt, en Twilio-rundtur per mottagare. Tjugotalet anställda tar några
// sekunder, men taket i schemat är 200 — och en timeout här är dyr på ett särskilt sätt: notiserna
// är redan skrivna, så en användare som trycker igen dubbelnotifierar alla OCH dubbelbetalar varje
// SMS som redan gick. Marginalen är därför satt uttryckligen i stället för att ärvas.
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const gate = await requirePermission('time.approve');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = sendTimeRemindersSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    // ⚠️ SMS kräver en EGEN nyckel. Notisen i appen är intern och gratis; ett SMS går till en privat
    // mobil på företagets kostnad, och `time.approve` innehas av lönebyrån — en extern part. Samma
    // gräns som `time.entry.write.all` drar mellan att godkänna någons tid och att skriva i deras
    // ställe. Se 20260908_time_reminder_sms_permission.sql.
    //
    // Nekas FÖRE någonting skrivits: UI:t döljer rutan för den som saknar nyckeln, så ett anrop hit
    // är antingen en gammal flik eller något handgjort. Att i stället skicka notiserna och tiga om
    // SMS:et hade gett ett halvt utfört uppdrag som ser lyckat ut.
    if (parsed.data.send_sms && !can(await getEffectivePermissions(), 'time.reminder.sms')) {
      return routeError(403, 'time_reminder_sms_forbidden', 'Du har inte behörighet att skicka påminnelser som SMS.');
    }

    const periodStart = periodStartOf(parsed.data.period);
    const supabase = createRouteHandlerClient({ cookies });

    // Underlaget, hämtat med SESSIONSKLIENTEN: RPC:n är security definer med has_permission som
    // första rad, alltså samma säkerhetsgräns som attestvyn själv läser bakom.
    const { data, error } = await listTimeApprovalOverview(supabase, periodStart);
    if (error) return routeError(500, 'time_reminder_overview_failed', error.message);

    // Gemener på båda sidor. Postgres jämför uuid skiftlägesokänsligt och zods uuid() släpper
    // igenom versaler, så en versal parameter hade matchat i databasen men fallit på en strikt
    // strängjämförelse här — och svaret blivit "ingen att påminna" med status 200. Samma fälla som
    // redan kostat en gång på den här ytan (se /api/admin/time/entries).
    const wanted = new Set(parsed.data.user_ids.map((id) => id.toLowerCase()));
    // Typad uttryckligen — RPC-svaret är `any`, och utan det blir raderna implicit any hela vägen.
    const rows: TimeApprovalOverviewRow[] = ((data ?? []) as Record<string, unknown>[]).map(normalizeOverviewRow);

    // Bara de som BÅDE valdes och faktiskt går att påminna. Filtret sitter här och inte i klienten
    // för att listan kan ha ändrats sedan sidan laddades: någon hinner lämna in medan modalen står
    // öppen, och då ska hon inte få en påminnelse om något hon just gjort.
    const selected = rows
      .map((row) => ({ row, reason: reminderReasonFor(row) }))
      .filter((item): item is { row: (typeof rows)[number]; reason: ReminderReason } =>
        item.reason !== null && wanted.has(item.row.user_id.toLowerCase()),
      );

    // ⛔ INGEN "minus the actor" här, till skillnad från notissystemets övriga producenter.
    //
    // Den konventionen finns för att en notis om DIN EGEN handling är brus — man @-taggar inte sig
    // själv. Den här notisen handlar om MOTTAGARENS saknade tid, vilket är precis lika sant när
    // mottagaren är du: en admin som attesterar rapporterar också sin egen tid.
    //
    // Regeln fanns kort och togs bort: den gjorde funktionen omöjlig att prova på sig själv, och
    // gav ett 409 som skyllde på att listan ändrats. Att någon står med i ett massutskick som inte
    // borde löses i stället SYNLIGT, med kryssrutorna i modalen.

    const admin = getSupabaseAdmin();

    /**
     * Idempotensfönster — skyddet mot en OMTRYCKNING, inte mot att påminna igen.
     *
     * 🧨 Notiserna skrivs och SMS:en går innan svaret når klienten. Tappas svaret på vägen (bruten
     * uppkoppling, eller taket i maxDuration mitt i SMS-loopen) ser användaren ett nätverksfel,
     * ingen rad hinner få sitt "Påmind i dag", och det naturliga är att trycka igen — varpå alla
     * dubbelnotifieras och varje redan skickat SMS betalas en gång till.
     *
     * Fönstret är därför kort med flit. Att påminna någon igen en timme senare är en giltig
     * åtgärd och ska fungera; att göra det inom två minuter är i praktiken alltid ett omtryck.
     */
    const justReminded = await recentlyRemindedIds(admin, selected.map((t) => t.row.user_id), periodStart);
    const targets = selected.filter((item) => !justReminded.has(item.row.user_id));

    if (targets.length === 0) {
      return routeError(
        409,
        'time_reminder_no_targets',
        justReminded.size > 0
          ? 'De valda är redan påminda alldeles nyss.'
          : 'Ingen av de valda behöver påminnas längre — listan kan ha hunnit ändras.',
      );
    }

    // Notisen först, och den går ALLTID. Den är gratis, når alla som öppnar appen och är dessutom
    // det historiken läses tillbaka ur ("påmind 3 sep") — hoppar man över den finns det ingen
    // spår av att någon blivit påmind.
    const href = timeReminderHref(periodStart);
    const rowsToInsert = targets.map(({ row, reason }) => {
      const text = reminderNotificationText(reason, periodStart, parsed.data.message);
      return { recipient_user_id: row.user_id, ...buildTimeReminderNotification({ ...text, href }) };
    });

    // ⚠️ INTE best-effort här, till skillnad från övriga producenter. Hos dem är notisen en bieffekt
    // av en skrivning som redan lyckats; här ÄR notisen hela åtgärden, och ett tyst misslyckande
    // hade rapporterat "20 påminda" utan att en enda fick något.
    const delivered = await deliverNotifications(admin, rowsToInsert);
    if (delivered.error) return routeError(500, 'time_reminder_notify_failed', delivered.error.message);

    // ── SMS (tillval) ────────────────────────────────────────────────────────
    // Numren läses med adminklienten: profiles har self-select-RLS, så attestansvarig kan inte läsa
    // någon annans telefonnummer under sin egen session. Urvalet är redan avgränsat till dem som
    // ska påminnas, och numret lämnar aldrig servern.
    let smsSent = 0;
    const smsFailed: string[] = [];
    let missingPhone = 0;
    let smsLookupFailed = false;

    if (parsed.data.send_sms) {
      const ids = targets.map((t) => t.row.user_id);
      const { data: profiles, error: phoneError } = await admin.from('profiles').select('id, phone').in('id', ids);
      const phoneById = new Map((profiles ?? []).map((p: { id: string; phone: string | null }) => [p.id, p.phone]));
      const origin = getPublicOrigin(req);

      // 🧨 Läsfelet får inte tappas. Utan det blir en misslyckad uppslagning en TOM karta, varje
      // mottagare faller i "saknar nummer"-grenen, och svaret blir ett glatt 200 med "20 saknar
      // telefonnummer" — varpå någon letar i tjugo profiler efter nummer som redan står där.
      // Samma felklass som `reminders_ok` vaktar på GET-sidan: fel som ser ut som tomma värden.
      //
      // Notiserna är redan skrivna, så anropet kan inte rullas tillbaka. Svaret säger i stället
      // rakt ut att SMS-delen inte gick att göra.
      if (phoneError) {
        console.error('[time.reminder] kunde inte läsa telefonnummer', phoneError);
        smsLookupFailed = true;
      }

      for (const { row, reason } of targets) {
        // Gick uppslagningen fel vet vi ingenting om numren — då är rätt svar att avstå, inte att
        // rapportera alla som nummerlösa.
        if (smsLookupFailed) break;
        const to = toSwedishE164(phoneById.get(row.user_id) ?? null);
        if (!to) {
          // Inget nummer är inte ett fel — det är en upplysning. Notisen har redan gått fram, och
          // svaret säger hur många som bara fick den, så ingen tror att alla blivit sms:ade.
          missingPhone++;
          continue;
        }
        try {
          await sendSms({ to, body: reminderSmsBody({ reason, periodStart, origin, message: parsed.data.message }) });
          smsSent++;
        } catch (e) {
          // Ett fel per mottagare stoppar inte de andra. sendSms KASTAR när Twilio saknar
          // konfiguration, så utan try/catch hade en env-miss i en miljö fällt hela utskicket —
          // efter att notiserna redan skrivits.
          smsFailed.push(row.full_name || 'Okänd');
          console.error('[time.reminder] sms failed', row.user_id, e);
        }
      }
    }

    return ok({
      notified: targets.length,
      sms_sent: smsSent,
      sms_missing_phone: missingPhone,
      sms_failed: smsFailed,
      sms_lookup_failed: smsLookupFailed,
      // De som valdes men inte fick något: redan inlämnade, avsändaren själv, eller nyss påminda.
      // Klienten säger det rakt ut i stället för att tyst rapportera en lägre siffra än antalet
      // man kryssade i.
      skipped: wanted.size - targets.length,
    });
  } catch (e: any) {
    return routeError(500, 'time_reminder_unexpected', e?.message || 'Kunde inte skicka påminnelsen');
  }
}

/** Hur länge en påminnelse räknas som "nyss skickad". Se idempotensnoten ovan. */
const RESEND_WINDOW_MS = 2 * 60 * 1000;

/**
 * De av mottagarna som redan fått en påminnelse om perioden de senaste minuterna.
 *
 * Läses med adminklienten av samma skäl som historiken i översikten: `notifications` är läsbar bara
 * för sin MOTTAGARE, så avsändaren kan inte se sina egna utskick under sin session.
 *
 * ⚠️ Failar läsningen returneras en TOM mängd, alltså skickas påminnelsen. Det är medvetet åt det
 * hållet: att missa ett dubblettskydd kostar ett extra SMS, att tro att alla nyss påmints hade
 * tystat funktionen helt.
 */
async function recentlyRemindedIds(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
  periodStart: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  try {
    const since = new Date(Date.now() - RESEND_WINDOW_MS).toISOString();
    const { data, error } = await admin
      .from('notifications')
      .select('recipient_user_id')
      .eq('type', 'time.reminder')
      // Samma ankare som historiken i översikten — se timeReminderHref.
      .eq('href', timeReminderHref(periodStart))
      .in('recipient_user_id', userIds)
      .gte('created_at', since);
    if (error) throw error;
    return new Set((data ?? []).map((row: { recipient_user_id: string }) => row.recipient_user_id));
  } catch (e) {
    console.error('[time.reminder] kunde inte läsa nyliga påminnelser', e);
    return new Set();
  }
}
