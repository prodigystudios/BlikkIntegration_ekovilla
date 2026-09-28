import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { buildPortalJobMessageNotification } from '@/lib/domains/notifications/payload';
import type { NotificationInsert } from '@/lib/domains/notifications/types';
import { enqueuePortalEvent } from './outbox';
import {
  PORTAL_JOB_MESSAGE_AUTHOR_MAX_CHARS,
  PORTAL_JOB_MESSAGE_MAX_CHARS,
  buildPortalJobMessageEvent,
  countChars,
  isPortalJobMessageDepartment,
  portalJobMessageKey,
  portalJobMessagePreview,
  portalReplyAuthorName,
  portalReplyDelivery,
  type PortalJobMessageDepartment,
  type PortalJobMessageDirection,
  type PortalJobMessagesView,
  type PortalJobMessageView,
} from './jobMessages';

/**
 * Meddelandena på ett portaljobb mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 6). Den rena delen står i
 * ./jobMessages.ts. Tabellen är `crm_portal_job_messages`, skild från de interna kommentarerna
 * (crm_work_order_comments), som den här filen aldrig rör.
 *
 *   in från portalen   receivePortalJobMessage (service-rollen: anropet har ingen användare), sedan notisen
 *   svar till butiken  sendPortalJobReply: sessionen sparar (RLS avgör vem som får svara), service-rollen köar; routen
 *                      skickar kön direkt efter svaret, utan att vänta på cron
 *   kortet             listPortalJobMessages, med sessionen
 *   cron               sweepPortalJobMessages: svar som sparats men inte köats, och notiser som inte gick iväg
 */

const TABLE = 'crm_portal_job_messages';

// ---------------------------------------------------------------------------------------------- in från portalen

const withinChars = (max: number) => (value: string) => countChars(value) <= max;

/** Portalens kropp (kontraktet): `{ messageId, authorName, body, sentAt }`. Namn och text trimmas, som portalen gör. */
export const portalJobMessageSchema = z.object({
  messageId: z.string().regex(/^[!-~]{1,200}$/, 'Ett meddelande-id med synliga ASCII-tecken, högst 200.'),
  authorName: z
    .string()
    .trim()
    .min(1, 'Namnet saknas.')
    .refine(withinChars(PORTAL_JOB_MESSAGE_AUTHOR_MAX_CHARS), `Högst ${PORTAL_JOB_MESSAGE_AUTHOR_MAX_CHARS} tecken.`),
  body: z
    .string()
    .trim()
    .min(1, 'Meddelandet är tomt.')
    .refine(withinChars(PORTAL_JOB_MESSAGE_MAX_CHARS), `Högst ${PORTAL_JOB_MESSAGE_MAX_CHARS} tecken.`),
  sentAt: z.string().datetime({ offset: true, message: 'Tidpunkten skrivs ISO 8601.' }),
});

export type PortalJobMessageInput = z.infer<typeof portalJobMessageSchema>;

/**
 * Vad intaget blev (William 2026-09-28):
 *   created / existing   sparat; ett meddelande som redan fanns (samma messageId, samma innehåll) sparas inte igen
 *   unknown_job          inget jobb med det quoteId:t                                      → 404
 *   not_ready            jobbet finns, men arbetsordern skapas just nu                      → 503, portalen gör om
 *   work_order_removed   arbetsordern är borttagen                                          → 409
 *   conflict             samma messageId finns redan, med ett annat innehåll                → 409
 *   invalid              databasen nekade texten (en check som zod inte ser)                → 400
 * En avbruten, utförd eller fakturerad order tar emot meddelanden som vanligt.
 */
export type ReceivePortalJobMessageResult =
  | { kind: 'created' | 'existing'; id: string }
  | { kind: 'unknown_job' | 'not_ready' | 'work_order_removed' | 'conflict' | 'invalid' };

export async function receivePortalJobMessage(
  admin: SupabaseClient,
  quoteId: string,
  message: PortalJobMessageInput,
): Promise<ReceivePortalJobMessageResult> {
  const job = await admin
    .from('crm_portal_jobs')
    .select('quote_id, work_order_id, work_order_created_at')
    .eq('quote_id', quoteId)
    .maybeSingle();
  if (job.error) throw new Error(`Jobbet gick inte att läsa: ${job.error.message}`);
  const row = job.data as { work_order_id: string | null; work_order_created_at: string | null } | null;
  if (!row) return { kind: 'unknown_job' };
  if (!row.work_order_id) return { kind: row.work_order_created_at ? 'work_order_removed' : 'not_ready' };

  const sentAt = new Date(message.sentAt).toISOString();
  const inserted = await admin
    .from(TABLE)
    .upsert(
      {
        quote_id: quoteId,
        direction: 'from_store',
        message_id: message.messageId,
        author_name: message.authorName,
        body: message.body,
        sent_at: sentAt,
      },
      // Samma messageId sparas en gång, också när portalen skickar det igen med en ny nyckel.
      { onConflict: 'direction,message_id', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) {
    if (inserted.error.code === '23514') return { kind: 'invalid' };
    throw new Error(`Meddelandet kunde inte sparas: ${inserted.error.message}`);
  }
  const created = (inserted.data ?? [])[0] as { id: string } | undefined;
  if (created) return { kind: 'created', id: created.id };

  const existing = await admin
    .from(TABLE)
    .select('id, quote_id, author_name, body, sent_at')
    .eq('direction', 'from_store')
    .eq('message_id', message.messageId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw new Error(`Meddelandet fanns redan men gick inte att läsa: ${existing.error?.message ?? 'saknas'}`);
  }
  const found = existing.data as { id: string; quote_id: string; author_name: string; body: string; sent_at: string };
  const same =
    found.quote_id === quoteId &&
    found.author_name === message.authorName &&
    found.body === message.body &&
    Date.parse(found.sent_at) === Date.parse(sentAt);
  return same ? { kind: 'existing', id: found.id } : { kind: 'conflict' };
}

// ------------------------------------------------------------------------------------------------------ notisen

export type NotifyPortalJobMessageDeps = {
  notify: (rows: NotificationInsert[]) => Promise<void>;
  now: () => Date;
};

export function notifyPortalJobMessageDeps(admin: SupabaseClient): NotifyPortalJobMessageDeps {
  return {
    notify: async (rows) => {
      const { error } = await deliverNotifications(admin, rows);
      if (error) throw new Error(error.message);
    },
    now: () => new Date(),
  };
}

export type NotifyPortalJobMessageOutcome = 'sent' | 'already_sent' | 'in_progress' | 'no_work_order' | 'no_recipient';

/** Hur länge ett lån på notisen gäller. Dör processen innan notisen gått iväg tar cron över när det gått ut. */
export const PORTAL_MESSAGE_NOTICE_LEASE_MS = 5 * 60_000;

type NoticeMessage = { quote_id: string; author_name: string; body: string };

/** Tar lånet: där inget finns, eller där det gått ut. Två villkorade skrivningar, var och en atomär. */
async function claimNotice(admin: SupabaseClient, id: string, at: Date): Promise<NoticeMessage | null> {
  const claim = (expired: boolean) => {
    const query = admin
      .from(TABLE)
      .update({ notify_claimed_at: at.toISOString() })
      .eq('id', id)
      .eq('direction', 'from_store')
      .is('notified_at', null);
    return (expired
      ? query.lt('notify_claimed_at', new Date(at.getTime() - PORTAL_MESSAGE_NOTICE_LEASE_MS).toISOString())
      : query.is('notify_claimed_at', null)
    ).select('quote_id, author_name, body');
  };
  for (const expired of [false, true]) {
    const { data, error } = await claim(expired);
    if (error) throw new Error(`Notisen kunde inte tas: ${error.message}`);
    const row = (data ?? [])[0] as NoticeMessage | undefined;
    if (row) return row;
  }
  return null;
}

/**
 * Notisen om butikens meddelande (William 2026-09-28): till arbetsorderns ansvarige nu, annars till reserven.
 *
 * Den som tar lånet (`notify_claimed_at`) skickar, och `notified_at` sätts först när notisen gått iväg. Faller
 * utskicket släpps lånet och felet kastas; dör processen mitt i går lånet ut efter fem minuter. I båda fallen gör cron
 * om den (sweepPortalJobMessages). Hellre en notis för mycket än en som tappas. En borttagen order, eller ingen alls
 * att meddela, bokförs som klar: det finns inget att försöka igen.
 */
export async function notifyPortalJobMessage(
  admin: SupabaseClient,
  messageRowId: string,
  deps: NotifyPortalJobMessageDeps = notifyPortalJobMessageDeps(admin),
): Promise<NotifyPortalJobMessageOutcome> {
  const at = deps.now();
  const message = await claimNotice(admin, messageRowId, at);
  if (!message) {
    // Inget lån: antingen klar (eller inget att notisera, som ett av våra svar), eller så har någon annan lånet nu.
    const current = await admin.from(TABLE).select('direction, notified_at').eq('id', messageRowId).maybeSingle();
    if (current.error) throw new Error(`Notisen gick inte att läsa: ${current.error.message}`);
    const row = current.data as { direction: string; notified_at: string | null } | null;
    return row?.direction === 'from_store' && !row.notified_at ? 'in_progress' : 'already_sent';
  }

  const done = async (outcome: NotifyPortalJobMessageOutcome) => {
    const marked = await admin
      .from(TABLE)
      .update({ notified_at: deps.now().toISOString() })
      .eq('id', messageRowId)
      .eq('notify_claimed_at', at.toISOString());
    if (marked.error) throw new Error(`Notisen skickades men kunde inte bokföras: ${marked.error.message}`);
    return outcome;
  };

  try {
    const job = await admin.from('crm_portal_jobs').select('store_name, work_order_id').eq('quote_id', message.quote_id).maybeSingle();
    if (job.error) throw new Error(`Jobbet gick inte att läsa: ${job.error.message}`);
    const jobRow = job.data as { store_name: string; work_order_id: string | null } | null;
    // Ordern togs bort efter att meddelandet kom: det finns ingen sida att länka till.
    if (!jobRow?.work_order_id) return await done('no_work_order');

    const workOrder = await admin.from('crm_work_orders').select('assigned_to').eq('id', jobRow.work_order_id).maybeSingle();
    if (workOrder.error) throw new Error(`Arbetsordern gick inte att läsa: ${workOrder.error.message}`);
    let recipient = (workOrder.data as { assigned_to: string | null } | null)?.assigned_to ?? null;
    if (!recipient) {
      const settings = await admin.from('crm_portal_settings').select('fallback_user_id').eq('id', true).maybeSingle();
      if (settings.error) throw new Error(`Reserven gick inte att läsa: ${settings.error.message}`);
      recipient = (settings.data as { fallback_user_id: string | null } | null)?.fallback_user_id ?? null;
    }
    if (!recipient) {
      console.warn('[portal-messages] ingen att meddela', { quoteId: message.quote_id });
      return await done('no_recipient');
    }
    const content = buildPortalJobMessageNotification({
      workOrderId: jobRow.work_order_id,
      storeName: jobRow.store_name,
      authorName: message.author_name,
      preview: portalJobMessagePreview(message.body),
    });
    await deps.notify(expandNotificationToRecipients(content, [recipient]));
  } catch (e) {
    const released = await admin
      .from(TABLE)
      .update({ notify_claimed_at: null })
      .eq('id', messageRowId)
      .eq('notify_claimed_at', at.toISOString());
    if (released.error) console.error('[portal-messages] lånet på notisen kunde inte släppas', { id: messageRowId });
    throw e;
  }
  return done('sent');
}

// ------------------------------------------------------------------------------------------ svaret till butiken

const REPLY_SELECT = 'id, quote_id, message_id, author_name, author_user_id, department, body, sent_at';

type ReplyDbRow = {
  id: string;
  quote_id: string;
  message_id: string;
  author_name: string;
  author_user_id: string | null;
  department: string;
  body: string;
  sent_at: string;
};

function replyDepartment(row: Pick<ReplyDbRow, 'id' | 'department'>): PortalJobMessageDepartment {
  // Tabellens check tillåter bara portalens avdelningar på ett svar.
  if (!isPortalJobMessageDepartment(row.department)) throw new Error(`Svaret ${row.id} har en okänd avdelning.`);
  return row.department;
}

/** Köar svarets job.message (idempotent på nyckeln) och bokför att det är köat. */
async function queuePortalJobReply(admin: SupabaseClient, row: ReplyDbRow, now: Date): Promise<void> {
  const event = buildPortalJobMessageEvent({
    quoteId: row.quote_id,
    messageId: row.message_id,
    authorName: row.author_name,
    department: replyDepartment(row),
    body: row.body,
    sentAt: row.sent_at,
  });
  await enqueuePortalEvent(admin, event);
  const marked = await admin.from(TABLE).update({ queued_at: now.toISOString() }).eq('id', row.id).is('queued_at', null);
  if (marked.error) throw new Error(`Svaret köades men kunde inte bokföras: ${marked.error.message}`);
}

/**
 * Köns status för svaren, med service-rollen: kön är bara service_role:s (och admins på portalsidan), och en läspolicy
 * för svaren hade gett varje läsare hela raden (portalens feltext, kroppen). Nycklarna kommer ur raderna som SESSIONEN
 * just kunde läsa, och bara `status` lämnar servern. I omgångar, så att adressen aldrig blir för lång.
 */
async function readReplyStatuses(admin: SupabaseClient, keys: string[]): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await admin
      .from('portal_outbound_events')
      .select('idempotency_key, status')
      .in('idempotency_key', keys.slice(i, i + 100));
    if (error) throw new Error(`Svarens status gick inte att läsa: ${error.message}`);
    for (const r of (data ?? []) as { idempotency_key: string; status: string }[]) statuses.set(r.idempotency_key, r.status);
  }
  return statuses;
}

function toView(
  row: Pick<ReplyDbRow, 'id' | 'author_name' | 'department' | 'body' | 'sent_at' | 'message_id'> & { direction: PortalJobMessageDirection },
  statuses: Map<string, string>,
): PortalJobMessageView {
  return {
    id: row.id,
    direction: row.direction,
    authorName: row.author_name,
    department: row.department,
    body: row.body,
    sentAt: new Date(row.sent_at).toISOString(),
    delivery: row.direction === 'to_store' ? portalReplyDelivery(statuses.get(portalJobMessageKey(row.message_id))) : null,
  };
}

export type SendPortalJobReplyInput = {
  workOrderId: string;
  /** Klientens id för utkastet (uuid). Samma id två gånger (dubbelklick, omförsök) ger samma svar, inte två. */
  messageId: string;
  body: string;
  department: PortalJobMessageDepartment;
  actor: { id: string; name: string | null };
};

/**
 *   sent        sparat och köat; routen skickar kön direkt efter svaret. `message.delivery` är köns läge nu
 *   not_found   ingen portalorder som sessionen ser
 *   forbidden   RLS nekade: varken ansvarig för ordern eller admin (eller saknar skrivnyckeln)
 *   conflict    samma id finns redan, med ett annat innehåll
 *   invalid     databasen nekade texten eller namnet (en check som zod inte ser)
 */
export type SendPortalJobReplyResult =
  | { kind: 'sent'; created: boolean; message: PortalJobMessageView }
  | { kind: 'not_found' | 'forbidden' | 'conflict' | 'invalid' };

/**
 * Sparar och köar svaret. Själva utskicket görs inte här: routen kör portalens varv direkt EFTER svaret (samma som
 * "Skicka väntande nu"), så att knappen aldrig väntar på portalen eller på andra jobbs händelser i kön.
 */
export async function sendPortalJobReply(
  session: SupabaseClient,
  admin: SupabaseClient,
  input: SendPortalJobReplyInput,
  now: () => Date = () => new Date(),
): Promise<SendPortalJobReplyResult> {
  const job = await session.from('crm_portal_jobs').select('quote_id').eq('work_order_id', input.workOrderId).maybeSingle();
  if (job.error) throw new Error(`Portalordern gick inte att läsa: ${job.error.message}`);
  const quoteId = (job.data as { quote_id: string } | null)?.quote_id;
  if (!quoteId) return { kind: 'not_found' };

  // Sessionen sparar, så att RLS avgör vem som får svara (svarspolicyn). sent_at sätter databasen.
  const inserted = await session
    .from(TABLE)
    .upsert(
      {
        quote_id: quoteId,
        direction: 'to_store',
        message_id: input.messageId,
        author_name: portalReplyAuthorName(input.actor.name),
        author_user_id: input.actor.id,
        department: input.department,
        body: input.body,
      },
      // ON CONFLICT DO NOTHING: sessionen har ingen update, och ett skickat svar ändras aldrig.
      { onConflict: 'direction,message_id', ignoreDuplicates: true },
    )
    .select(REPLY_SELECT);
  if (inserted.error) {
    if (inserted.error.code === '42501') return { kind: 'forbidden' };
    if (inserted.error.code === '23514') return { kind: 'invalid' };
    throw new Error(`Svaret kunde inte sparas: ${inserted.error.message}`);
  }
  let row = (inserted.data ?? [])[0] as ReplyDbRow | undefined;
  const created = Boolean(row);
  if (!row) {
    const existing = await session.from(TABLE).select(REPLY_SELECT).eq('direction', 'to_store').eq('message_id', input.messageId).maybeSingle();
    if (existing.error) throw new Error(`Svaret fanns redan men gick inte att läsa: ${existing.error.message}`);
    const found = existing.data as ReplyDbRow | null;
    const same =
      found &&
      found.quote_id === quoteId &&
      found.author_user_id === input.actor.id &&
      found.department === input.department &&
      found.body === input.body;
    if (!same) return { kind: 'conflict' };
    row = found;
  }

  // Går köandet fel ligger svaret sparat; cron köar det (sweepPortalJobMessages), och kortet visar "Skickas …".
  try {
    await queuePortalJobReply(admin, row, now());
  } catch (e) {
    console.error('[portal-messages] svaret kunde inte köas, cron tar det', { id: row.id, error: e instanceof Error ? e.message : e });
  }

  let statuses = new Map<string, string>();
  try {
    statuses = await readReplyStatuses(admin, [portalJobMessageKey(row.message_id)]);
  } catch (e) {
    console.error('[portal-messages] svarets status gick inte att läsa', { error: e instanceof Error ? e.message : e });
  }
  return { kind: 'sent', created, message: toView({ ...row, direction: 'to_store' }, statuses) };
}

// -------------------------------------------------------------------------------------------------------- kortet

/** Så många meddelanden visar kortet, de senaste. En tråd med fler finns inte i praktiken. */
export const PORTAL_JOB_MESSAGES_LIMIT = 500;

/**
 * Tråden på arbetsordern. Sessionen läser den (RLS: alla som ser ordern kontorsvägen, och den som har den) och frågar
 * svarsregeln (`crm_portal_job_message_can_reply`, samma som svarspolicyn) om svarsfältet ska visas; service-rollen
 * läser bara svarens status i kön. null = ingen portalorder som sessionen ser.
 *
 * Ordningen är den meddelandena kom fram i (`created_at`), inte avsändarens klocka: ett meddelande som portalen fick
 * skicka om en stund senare hamnar efter svaret som skrevs under tiden, med sin egen tid utskriven.
 */
export async function listPortalJobMessages(
  session: SupabaseClient,
  admin: SupabaseClient,
  workOrderId: string,
): Promise<PortalJobMessagesView | null> {
  const job = await session.from('crm_portal_jobs').select('quote_id, store_name').eq('work_order_id', workOrderId).maybeSingle();
  if (job.error) throw new Error(`Portalordern gick inte att läsa: ${job.error.message}`);
  const jobRow = job.data as { quote_id: string; store_name: string } | null;
  if (!jobRow) return null;

  const rule = await session.rpc('crm_portal_job_message_can_reply', { p_quote_id: jobRow.quote_id });
  if (rule.error) throw new Error(`Svarsregeln gick inte att fråga: ${rule.error.message}`);

  const { data, error } = await session
    .from(TABLE)
    .select('id, direction, message_id, author_name, department, body, sent_at, created_at')
    .eq('quote_id', jobRow.quote_id)
    // De senaste; id sist, så att ordningen alltid är densamma.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PORTAL_JOB_MESSAGES_LIMIT);
  if (error) throw new Error(`Meddelandena gick inte att läsa: ${error.message}`);
  const rows = ((data ?? []) as (Omit<ReplyDbRow, 'quote_id' | 'author_user_id'> & { direction: PortalJobMessageDirection })[]).reverse();

  const keys = rows.filter((r) => r.direction === 'to_store').map((r) => portalJobMessageKey(r.message_id));
  const statuses = keys.length > 0 ? await readReplyStatuses(admin, keys) : new Map<string, string>();
  return { storeName: jobRow.store_name, canReply: rule.data === true, messages: rows.map((r) => toView(r, statuses)) };
}

// ---------------------------------------------------------------------------------------------------------- cron

const MINUTE = 60_000;

export type PortalJobMessagesSweepSummary = { queued: number; notified: number; errors: number };

/**
 * Städar efter det som skulle ha hänt direkt (körs av runPortalCron före utskicket). De två halvorna är oberoende: ett
 * fel i den ena stoppar inte den andra.
 *   - Svar som sparats men inte köats, när processen dog mellan de två stegen (äldre än en minut, yngre än en vecka).
 *   - Butikens meddelanden utan notis, när arbetet efter svaret inte hann, notisen föll eller processen dog med lånet
 *     (äldre än två minuter, yngre än ett dygn: en notis om ett gammalt meddelande hjälper ingen). Ett lån som ännu
 *     gäller lämnas åt den som har det.
 */
export async function sweepPortalJobMessages(
  admin: SupabaseClient,
  options: { now: () => Date; notifyDeps?: NotifyPortalJobMessageDeps },
): Promise<PortalJobMessagesSweepSummary> {
  const now = options.now();
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const summary: PortalJobMessagesSweepSummary = { queued: 0, notified: 0, errors: 0 };
  const failed = (what: string, e: unknown, id?: string) => {
    summary.errors += 1;
    console.error(`[portal-messages] ${what}`, { id, error: e instanceof Error ? e.message : e });
  };

  try {
    const unqueued = await admin
      .from(TABLE)
      .select(REPLY_SELECT)
      .eq('direction', 'to_store')
      .is('queued_at', null)
      .lt('created_at', ago(MINUTE))
      .gt('created_at', ago(7 * 24 * 60 * MINUTE))
      .order('created_at', { ascending: true })
      .limit(50);
    if (unqueued.error) throw new Error(unqueued.error.message);
    for (const row of (unqueued.data ?? []) as ReplyDbRow[]) {
      try {
        await queuePortalJobReply(admin, row, now);
        summary.queued += 1;
      } catch (e) {
        failed('svaret kunde inte köas', e, row.id);
      }
    }
  } catch (e) {
    failed('svaren som inte köats gick inte att läsa', e);
  }

  try {
    const unnotified = await admin
      .from(TABLE)
      .select('id')
      .eq('direction', 'from_store')
      .is('notified_at', null)
      .lt('created_at', ago(2 * MINUTE))
      .gt('created_at', ago(24 * 60 * MINUTE))
      .order('created_at', { ascending: true })
      .limit(50);
    if (unnotified.error) throw new Error(unnotified.error.message);
    const deps = options.notifyDeps ?? notifyPortalJobMessageDeps(admin);
    for (const row of (unnotified.data ?? []) as { id: string }[]) {
      try {
        if ((await notifyPortalJobMessage(admin, row.id, deps)) === 'sent') summary.notified += 1;
      } catch (e) {
        failed('notisen kunde inte skickas', e, row.id);
      }
    }
  } catch (e) {
    failed('meddelandena utan notis gick inte att läsa', e);
  }
  return summary;
}
