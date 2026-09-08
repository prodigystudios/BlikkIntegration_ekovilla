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
import { ok, requirePermission, routeError, sendTimeRemindersSchema, validationError } from '@/app/api/time/_lib';

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
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('time.approve');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = sendTimeRemindersSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

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
    const targets = rows
      .map((row) => ({ row, reason: reminderReasonFor(row) }))
      .filter((item): item is { row: (typeof rows)[number]; reason: ReminderReason } =>
        item.reason !== null && wanted.has(item.row.user_id.toLowerCase()),
      );

    if (targets.length === 0) {
      return routeError(409, 'time_reminder_no_targets', 'Ingen av de valda behöver påminnas längre — listan kan ha hunnit ändras.');
    }

    const admin = getSupabaseAdmin();

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

    if (parsed.data.send_sms) {
      const ids = targets.map((t) => t.row.user_id);
      const { data: profiles } = await admin.from('profiles').select('id, phone').in('id', ids);
      const phoneById = new Map((profiles ?? []).map((p: { id: string; phone: string | null }) => [p.id, p.phone]));
      const origin = getPublicOrigin(req);

      for (const { row, reason } of targets) {
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
      // De som valdes men inte längre behövde påminnas. Klienten säger det rakt ut i stället för
      // att tyst rapportera en lägre siffra än antalet man kryssade i.
      skipped: wanted.size - targets.length,
    });
  } catch (e: any) {
    return routeError(500, 'time_reminder_unexpected', e?.message || 'Kunde inte skicka påminnelsen');
  }
}
