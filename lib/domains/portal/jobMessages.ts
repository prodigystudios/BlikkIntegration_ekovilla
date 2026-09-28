import { PORTAL_EVENTS_PATH, portalJobOrderingKey } from './jobState';

/**
 * Meddelandena mellan butiken och Ekovilla på ett portaljobb (RESELLER_PORTAL_CRM_PLAN.md fas 6, kontraktets
 * "Meddelanden från butiken" och job.message). Ren: ingen zod, ingen databas. Kortet "Butiken" på arbetsordern
 * importerar den, och zod hade följt med till webbläsaren. Schemat för portalens kropp och databasstegen står i
 * ./jobMessagesStore.ts.
 *
 * Besluten (William 2026-09-28):
 *   - Svaret får en av portalens avdelningar, vald vid svaret, förvalt Försäljning ("Anna Berg · Planering" hos
 *     butiken). Ingen roll motsvarar Planering, så den kan inte härledas.
 *   - Ett skickat svar är slutgiltigt: portalen sparar det en gång per messageId.
 *   - Meddelandena ligger i en egen tabell och ett eget kort, aldrig bland de interna kommentarerna.
 */

export const PORTAL_JOB_MESSAGE_DEPARTMENTS = ['Försäljning', 'Planering', 'Ekonomi'] as const;
export type PortalJobMessageDepartment = (typeof PORTAL_JOB_MESSAGE_DEPARTMENTS)[number];
export const DEFAULT_PORTAL_JOB_MESSAGE_DEPARTMENT: PortalJobMessageDepartment = 'Försäljning';

export function isPortalJobMessageDepartment(value: unknown): value is PortalJobMessageDepartment {
  return typeof value === 'string' && (PORTAL_JOB_MESSAGE_DEPARTMENTS as readonly string[]).includes(value);
}

/** Portalens gräns för ett meddelande, och för ett namn. */
export const PORTAL_JOB_MESSAGE_MAX_CHARS = 5000;
export const PORTAL_JOB_MESSAGE_AUTHOR_MAX_CHARS = 200;

/** Namnet när svararen saknar ett i sin profil. Portalen kräver ett namn. */
export const PORTAL_JOB_MESSAGE_FALLBACK_AUTHOR = 'Ekovilla';

/**
 * Antal tecken som Postgres räknar dem (kodpunkter). JavaScripts `length` räknar ett emoji som två, och då hade ett
 * meddelande som portalen och databasen tar emot nekats här.
 */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/** De första `max` tecknen (kodpunkter), så att ett emoji aldrig delas mitt i. */
export function sliceChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

export type PortalJobMessageDirection = 'from_store' | 'to_store';

/** Idempotency-Key för svarets job.message. Samma som databasen härleder i `outbound_key`. */
export function portalJobMessageKey(messageId: string): string {
  return `job.message-${messageId}`;
}

/** Ett svar som det sparats: allt som job.message bär. */
export type PortalJobReplyRow = {
  quoteId: string;
  messageId: string;
  authorName: string;
  department: PortalJobMessageDepartment;
  body: string;
  /** Databasens tid (sent_at), i vilken form den än skrivs. */
  sentAt: string;
};

/**
 * Köns händelse för ett svar. Byggs bara ur den sparade raden, så att samma svar alltid ger samma kropp: köar cron ett
 * svar som aldrig hann köas (processen dog emellan) blir det samma händelse, och kön nekar en annan kropp med samma
 * nyckel. Tiden skrivs som …Z med millisekunder, som de andra händelserna (kontraktspunkt 23).
 */
export function buildPortalJobMessageEvent(reply: PortalJobReplyRow) {
  const sentAt = new Date(reply.sentAt).toISOString();
  return {
    idempotencyKey: portalJobMessageKey(reply.messageId),
    path: PORTAL_EVENTS_PATH,
    orderingKey: portalJobOrderingKey(reply.quoteId),
    payload: {
      type: 'job.message' as const,
      occurredAt: sentAt,
      data: {
        quoteId: reply.quoteId,
        messageId: reply.messageId,
        authorName: reply.authorName,
        department: reply.department,
        body: reply.body,
        sentAt,
      },
    },
  };
}

/** Svararens namn som butiken ser det: profilens namn, annars "Ekovilla", högst 200 tecken. */
export function portalReplyAuthorName(profileName: string | null | undefined): string {
  const name = (profileName ?? '').replace(/\s+/g, ' ').trim();
  return name ? sliceChars(name, PORTAL_JOB_MESSAGE_AUTHOR_MAX_CHARS).trim() : PORTAL_JOB_MESSAGE_FALLBACK_AUTHOR;
}

/** Början av meddelandet på en rad, för notisen. */
export function portalJobMessagePreview(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return countChars(flat) > max ? `${sliceChars(flat, max - 1).trimEnd()}…` : flat;
}

// ---------------------------------------------------------------------------------------------------- kortet

/** Hur det gått med ett svar. Butikens meddelanden har ingen. */
export type PortalReplyDelivery = 'sending' | 'sent' | 'failed';

/**
 * Svarets läge ur köns status. Ingen rad i kön (inte köad än) och en som väntar eller skickas är båda "skickas": kön
 * gör om den tills portalen svarat. Uppgiven = kom inte fram; en admin kan skicka om den på portalsidan.
 */
export function portalReplyDelivery(queueStatus: string | null | undefined): PortalReplyDelivery {
  if (queueStatus === 'sent') return 'sent';
  if (queueStatus === 'dead') return 'failed';
  return 'sending';
}

export type PortalJobMessageView = {
  id: string;
  direction: PortalJobMessageDirection;
  authorName: string;
  /** Tom för butikens meddelanden. */
  department: string;
  body: string;
  sentAt: string;
  /** Bara för Ekovillas svar. */
  delivery: PortalReplyDelivery | null;
};

export type PortalJobMessagesView = {
  storeName: string;
  /** Den som tittar får svara: har ordern, eller är admin, och har skrivnyckeln. Servern avgör. */
  canReply: boolean;
  messages: PortalJobMessageView[];
};

/** Raden under butikens namn eller svararens: "Anna Berg · Planering". */
export function portalJobMessageByline(message: Pick<PortalJobMessageView, 'authorName' | 'department'>): string {
  return message.department ? `${message.authorName} · ${message.department}` : message.authorName;
}
