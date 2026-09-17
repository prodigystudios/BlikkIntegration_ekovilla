import type { SupabaseClient } from '@supabase/supabase-js';
import { EmailSendError, sendEmail } from '@/lib/email';
import {
  classifySendError,
  composedOrderDiffers,
  materialOrderIdempotencyKey,
  materialOrderSendMode,
  warningsFingerprint,
  type OrderWarning,
} from './materialOrders';
import { claimSend, finalizeSend, getOrder, recordSendError, releaseSend, resolveSend, type MaterialOrder } from './materialOrdersStore';
import { composeFromRegistry, draftInputOf, warningsForOrder } from './materialOrdersService';

// Utskicket av en materialbeställning till fabriken.
//
// Server-side. Kontraktet med databasen står i supabase/sql/20260917_ops_material_orders.sql och i planen
// (~/.claude/plans/etapp4-bestallningsmail.md, "BYGGT 2026-09-17"). Reglerna som INTE får brytas:
//
// 🧨 ETT NÄTVERKSFEL FÅR ALDRIG BLI TVÅ LASS. Samma order + samma försök = samma idempotensnyckel, och det
//    LAGRADE mailet skickas byte för byte. Ett nytt försök (ny nyckel) kommer bara efter ett bevisat avslag
//    på ett försök som aldrig skickats om — det avgör release_material_order_send, inte den här filen.
// 🧨 ETT OKLART UTFALL ÄR OKLART. Timeout, 5xx, okänd kod, `id` saknas: ordern står kvar som 'sending', och
//    "Försök igen" skickar samma bytes med samma nyckel. Aldrig finalize utan Resends id, aldrig release.
// 🧨 SKARPT BARA I PRODUKTION MED FLAGGAN. Spärren prövas FÖRE varje skrivning — en blockerad miljö får inte
//    ens ta ett utskick.

export const SEND_TIMEOUT_MS = 15_000;
/**
 * Hela budgeten för en förfrågan. Routen har maxDuration 30 s; marginalen täcker finalize och svaret. Dödas
 * funktionen mitt i utskicket blir klienten utan besked och inget fel bokförs — ordern står säkert kvar som
 * "skickas", men ett 202 med rådet att vänta är bättre än ett 504.
 */
export const REQUEST_BUDGET_MS = 25_000;
/** Minsta tid som måste finnas kvar för att ett utskick alls ska påbörjas. */
export const MIN_SEND_WINDOW_MS = 8_000;
/** Hur länge ett utskick räknas som pågående i databasen (claim/resolve). */
export const RETRY_AFTER_SECONDS = 120;

export type SendOutcome =
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'already_sent'; order: MaterialOrder | null }
  | { kind: 'conflict'; code: string; message: string }
  | { kind: 'acknowledge_required'; warnings: OrderWarning[]; fingerprint: string }
  | { kind: 'sent'; order_no: number; created: number; expected: number }
  /** attempt = försöket nästa Skicka ska använda. */
  | { kind: 'rejected'; code: string; message: string; attempt: number }
  | { kind: 'unknown'; message: string; retry_after_seconds: number }
  | { kind: 'db_error'; message: string };

const CLAIM_CONFLICT: Record<string, string> = {
  in_progress: 'Ett utskick av den här beställningen pågår redan — vänta en stund och läs om',
  revision_changed: 'Beställningen har ändrats sedan du granskade den — granska igen',
  attempt_changed: 'Någon annan har hanterat utskicket sedan du läste in det — läs om',
  window_expired: 'Mer än 23 timmar har gått sedan utskicket — titta i kopian i order@ och ange om mailet gick fram',
  not_reviewed: 'Beställningen har inget granskat mail att skicka — granska den först',
  lines_invalid: 'Raderna på beställningen går inte att registrera — granska om den, inget har skickats',
};

type Deps = {
  supabase: SupabaseClient;
  env: Record<string, string | undefined>;
  today: string;
  actor: { id: string; name: string | null };
  /** Klockan, injicerbar för testerna av tidsbudgeten. */
  now?: () => number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function sendMaterialOrder(
  deps: Deps,
  input: { orderId: string; revision: number; attempt: number; acknowledgedWarnings: string | null },
): Promise<SendOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const unknown = (message: string): SendOutcome => ({ kind: 'unknown', message, retry_after_seconds: RETRY_AFTER_SECONDS });

  // 1. Spärren, före allt annat.
  if (materialOrderSendMode(deps.env) !== 'live') return { kind: 'blocked' };

  const { supabase } = deps;
  const read = await getOrder(supabase, input.orderId);
  if (read.error) return { kind: 'db_error', message: read.error.message };
  const order = read.data;
  if (!order) return { kind: 'not_found' };
  if (order.status === 'sent') return { kind: 'already_sent', order };

  // 2. Ett utkast kontrolleras mot registret och varningarna innan det tas. Ett pågående utskick gör det INTE:
  //    dess bytes är frysta, och ett omförsök MÅSTE skicka samma bytes — annars svarar Resend 409 på nyckeln.
  if (order.status === 'draft') {
    if (order.revision !== input.revision) return { kind: 'conflict', code: 'revision_changed', message: CLAIM_CONFLICT.revision_changed };
    if (!order.supplier_id) return { kind: 'conflict', code: 'supplier_missing', message: 'Leverantören finns inte längre i registret' };
    if (!order.email_subject || !order.email_text || !order.recipient_email) {
      return { kind: 'conflict', code: 'not_reviewed', message: CLAIM_CONFLICT.not_reviewed };
    }
    const fresh = await composeFromRegistry(supabase, {
      ...draftInputOf(order),
      supplierId: order.supplier_id,
      orderNo: order.order_no,
      composedByName: order.composed_by_name ?? 'Ekovilla',
      today: deps.today,
      env: deps.env,
    });
    if (!fresh.ok) {
      if (fresh.failure.kind === 'db_error') return { kind: 'db_error', message: fresh.failure.message };
      return {
        kind: 'conflict',
        code: 'needs_review',
        message: 'Beställningen stämmer inte längre mot registret (t.ex. ett passerat datum, en inaktiv leverantör eller en depå utan Plats) — granska igen',
      };
    }
    if (!fresh.supplier.active) return { kind: 'conflict', code: 'needs_review', message: 'Leverantören är inaktiv — granska igen' };
    const stored = {
      recipient_email: order.recipient_email ?? '',
      email_subject: order.email_subject ?? '',
      email_text: order.email_text ?? '',
      email_language: order.email_language ?? 'sv',
      from_address: order.from_address ?? '',
      reply_to: order.reply_to ?? '',
      bcc: order.bcc ?? '',
    };
    if (composedOrderDiffers(stored, fresh.composed)) {
      return {
        kind: 'conflict',
        code: 'needs_review',
        message: 'Leverantörens adress, mall eller en depås adress har ändrats sedan granskningen — granska igen så du ser mailet som går',
      };
    }
    const warnings = await warningsForOrder(supabase, order, fresh.supplier, deps.today);
    // Kvitteringen gäller exakt de varningar som visades — se warningsFingerprint.
    if (warnings.length > 0 && input.acknowledgedWarnings !== warningsFingerprint(warnings)) {
      return { kind: 'acknowledge_required', warnings, fingerprint: warningsFingerprint(warnings) };
    }
  }

  // Kontrollerna ovan läser prognosen och kan ta tid. Räcker inte budgeten till ett utskick tas det inte alls —
  // ingenting är påbörjat, och ett nytt tryck börjar om.
  const remaining = REQUEST_BUDGET_MS - (now() - started);
  if (remaining < MIN_SEND_WINDOW_MS) {
    return { kind: 'conflict', code: 'slow_checks', message: 'Kontrollerna tog för lång tid — inget har skickats. Försök igen.' };
  }

  // 3. Ta utskicket.
  const claim = await claimSend(supabase, order.id, input.revision, input.attempt);
  if (claim.error) return { kind: 'db_error', message: claim.error.message };
  switch (claim.data) {
    case 'claimed':
    case 'reclaimed':
      break;
    case 'already_sent':
      return { kind: 'already_sent', order: null };
    case 'not_found':
      return { kind: 'not_found' };
    case null:
      return { kind: 'db_error', message: 'Inget svar från databasen' };
    default:
      return { kind: 'conflict', code: claim.data, message: CLAIM_CONFLICT[claim.data] ?? 'Utskicket kunde inte påbörjas' };
  }

  // 4. Skicka det LAGRADE mailet med försökets nyckel.
  const key = materialOrderIdempotencyKey(order.id, input.attempt);
  let result: Awaited<ReturnType<typeof sendEmail>> | 'timeout';
  try {
    result = await withTimeout(
      sendEmail(
        {
          to: order.recipient_email!,
          from: order.from_address ?? undefined,
          replyTo: order.reply_to ?? undefined,
          bcc: order.bcc ?? undefined,
          subject: order.email_subject!,
          text: order.email_text!,
        },
        { idempotencyKey: key },
      ),
      Math.min(SEND_TIMEOUT_MS, remaining - 2_000),
    );
  } catch (e) {
    if (e instanceof EmailSendError && classifySendError(e.code) === 'rejected') {
      const released = await releaseSend(supabase, order.id, input.attempt, e.code, e.message);
      if (released.data === 'released') return { kind: 'rejected', code: e.code, message: e.message, attempt: input.attempt + 1 };
      // 'retried': försöket har skickats om, och ett avslag bevisar då inget om det första anropet.
      await recordSendError(supabase, order.id, input.attempt, e.code, e.message).catch(() => {});
      return unknown(`Oklart om mailet gick fram (${e.message}). Tryck Försök igen om ett par minuter — inget nytt mail skickas.`);
    }
    const code = e instanceof EmailSendError ? e.code : 'exception';
    const message = e instanceof Error ? e.message : 'Okänt fel';
    await recordSendError(supabase, order.id, input.attempt, code, message).catch(() => {});
    return unknown(`Oklart om mailet gick fram (${message}). Tryck Försök igen om ett par minuter — inget nytt mail skickas.`);
  }

  if (result === 'timeout') {
    await recordSendError(supabase, order.id, input.attempt, 'timeout', 'Inget svar från Resend i tid').catch(() => {});
    return unknown('Inget svar från mailtjänsten i tid. Tryck Försök igen om ett par minuter — inget nytt mail skickas.');
  }
  if (result.skipped) {
    // Mail är inte konfigurerat: DET HÄR anropet skickade inget. Släpp försöket — men bara om det aldrig
    // skickats om; annars kan ett tidigare anrop ha gått fram ('retried').
    const released = await releaseSend(supabase, order.id, input.attempt, 'not_configured', 'Mail är inte konfigurerat');
    if (released.data === 'released') {
      return { kind: 'rejected', code: 'not_configured', message: 'Mail är inte konfigurerat i den här miljön', attempt: input.attempt + 1 };
    }
    await recordSendError(supabase, order.id, input.attempt, 'not_configured', 'Mail är inte konfigurerat').catch(() => {});
    return unknown('Mail är inte konfigurerat, och ett tidigare försök kan ha gått fram. Titta i kopian i order@.');
  }
  if (!result.id) {
    await recordSendError(supabase, order.id, input.attempt, 'no_id', 'Resend svarade utan id').catch(() => {});
    return unknown('Mailtjänsten svarade utan kvitto. Tryck Försök igen om ett par minuter — inget nytt mail skickas.');
  }

  // 5. Resend tog emot mailet: registrera.
  const finalized = await finalizeSend(supabase, order.id, result.id);
  if (finalized.error || finalized.data === null) {
    await recordSendError(supabase, order.id, input.attempt, 'finalize_failed', finalized.error?.message ?? 'Inget svar').catch(() => {});
    return unknown('Mailet är skickat men beställningen kunde inte registreras. Tryck Försök igen om ett par minuter — inget nytt mail skickas.');
  }
  return { kind: 'sent', order_no: order.order_no, created: finalized.data, expected: order.lines.length };
}

export type ResolveOutcome =
  | { kind: 'marked_sent' | 'released' }
  | { kind: 'conflict'; code: string; message: string }
  | { kind: 'not_found' }
  | { kind: 'db_error'; message: string };

const RESOLVE_CONFLICT: Record<string, string> = {
  window_open: 'Mindre än 23 timmar har gått — tryck Försök igen i stället. Samma mail skickas inte två gånger.',
  in_progress: 'Ett utskick pågår — vänta en stund',
  not_sending: 'Beställningen väntar inte på ett besked',
  already_sent: 'Beställningen är redan skickad',
  lines_invalid: 'Raderna på beställningen går inte att registrera — kontakta administratören',
};

/** En människas besked om ett oklart utskick, efter att ha tittat i kopian i order@. */
export async function resolveMaterialOrder(supabase: SupabaseClient, orderId: string, delivered: boolean): Promise<ResolveOutcome> {
  const r = await resolveSend(supabase, orderId, delivered);
  if (r.error) return { kind: 'db_error', message: r.error.message };
  switch (r.data) {
    case 'marked_sent':
    case 'released':
      return { kind: r.data };
    case 'not_found':
      return { kind: 'not_found' };
    case null:
      return { kind: 'db_error', message: 'Inget svar från databasen' };
    default:
      return { kind: 'conflict', code: r.data, message: RESOLVE_CONFLICT[r.data] ?? 'Beskedet kunde inte registreras' };
  }
}
