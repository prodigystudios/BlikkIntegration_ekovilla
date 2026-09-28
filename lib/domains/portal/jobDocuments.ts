import { PORTAL_EVENTS_PATH, portalJobOrderingKey } from './jobState';

/**
 * Dokumenten till butiken på ett portaljobb (RESELLER_PORTAL_CRM_PLAN.md fas 7, kontraktets job.document). Ren: ingen
 * zod, ingen databas, ingen node:crypto. Kortet "Butiken" importerar den. Databasstegen står i ./jobDocumentsStore.ts,
 * och utskickets läsning av filen i ./outboundContent.ts.
 *
 * Besluten (William 2026-09-28):
 *   - Orderbekräftelsen, i vår egen design, skickas automatiskt EN gång när job.confirmed är levererad. Sedan skickar den
 *     som har ordern, eller en admin, en ny med knappen.
 *   - Egenkontrollen skickas med knappen, av samma personer, när en egenkontroll finns på ordern.
 *   - Ett avbrutet eller borttaget jobb får inga dokument.
 *   - Filnamnet: "Orderbekräftelse <Fortnox-nr> – <arbetsplats>.pdf", och "Egenkontroll …" på samma sätt.
 *
 * PDF:en fryses EN gång i bucketen och kön bär en referens med hashen (contentRef). Utskicket bygger kroppen ur filen
 * vid varje försök, så att samma nyckel alltid ger samma byte: portalen nekar samma nyckel med andra byte (422).
 */

export const PORTAL_JOB_DOCUMENT_KINDS = ['order_confirmation', 'self_inspection'] as const;
export type PortalJobDocumentKind = (typeof PORTAL_JOB_DOCUMENT_KINDS)[number];

export function isPortalJobDocumentKind(value: unknown): value is PortalJobDocumentKind {
  return typeof value === 'string' && (PORTAL_JOB_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const PORTAL_JOB_DOCUMENT_LABELS: Record<PortalJobDocumentKind, string> = {
  order_confirmation: 'Orderbekräftelse',
  self_inspection: 'Egenkontroll',
};

/**
 * Portalens gräns (MAX_JOB_DOCUMENT_BYTES): 3 300 000 byte före base64, decimalt. Vercel tar emot högst 4,5 MB per
 * anrop, och base64 gör filen en tredjedel större: högst 4 400 000 tecken. Samma gräns står på bucketen.
 */
export const PORTAL_JOB_DOCUMENT_MAX_BYTES = 3_300_000;

/** Bucketen där PDF:en fryses. Privat, bara service-rollen. */
export const PORTAL_JOB_DOCUMENTS_BUCKET = 'portal-job-documents';

/** Idempotency-Key för dokumentets job.document. Samma som databasen härleder i `outbound_key`. */
export function portalJobDocumentKey(documentId: string): string {
  return `job.document-${documentId}`;
}

/** En nyare version av samma sort ersätter en äldre som ännu väntar i kön: bara den senaste behöver fram. */
export function portalJobDocumentSupersedeKey(quoteId: string, kind: PortalJobDocumentKind): string {
  return `job.document:${quoteId}:${kind}`;
}

/** Den frysta filens plats i bucketen. Härledd ur raden, aldrig läst ur något annat. */
export function portalJobDocumentPath(quoteId: string, documentId: string): string {
  return `${quoteId}/${documentId}.pdf`;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Börjar byten som en PDF? Samma prov som portalens isPdf. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length > PDF_MAGIC.length && PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}

/** "4,1 MB", decimalt, som portalens "3,3 MB". */
export function formatDocumentSize(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${(Math.ceil(mb * 10) / 10).toFixed(1).replace('.', ',')} MB`;
}

const WORKPLACE_MAX_CHARS = 60;

/** Filnamnet butiken ser och laddar ner. Svenska tecken går bra: portalen skriver filename*. */
export function portalJobDocumentName(
  kind: PortalJobDocumentKind,
  orderNumber: string,
  workplace: string | null | undefined,
): string {
  const clean = (value: string) =>
    value
      // Styrtecken och tecken som inte får stå i ett filnamn.
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const base = [PORTAL_JOB_DOCUMENT_LABELS[kind], clean(orderNumber)].filter(Boolean).join(' ');
  const place = Array.from(clean(workplace ?? '')).slice(0, WORKPLACE_MAX_CHARS).join('').trim();
  return `${place ? `${base} – ${place}` : base}.pdf`;
}

/**
 * Samma rensning som egenkontrollens sida gör av ordernumret i filnamnet (app/egenkontroll/page.tsx, `sanitize`):
 * `Egenkontroll_<kund>_<ordernr>.pdf`.
 */
export function egenkontrollFilenamePart(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Hör egenkontrollen till den här ordern? Länken står i en kommentar, som är fritext: filnamnet måste sluta på orderns
 * Fortnox-nummer eller AO-nummer, som sidan skrev in det, med arkivets `-1`, `-2` när namnet redan fanns.
 */
export function egenkontrollBelongsToOrder(path: string, orderNumbers: readonly (string | null | undefined)[]): boolean {
  const fileName = (path.split('/').pop() ?? '').toLowerCase();
  // Varje nummer prövas mot slutet av namnet. Att läsa ut numret ur namnet hade varit tvetydigt: i
  // `…_AO-20260925-123456.pdf` hade `-123456` kunnat läsas som arkivets löpnummer.
  return orderNumbers.some((n) => {
    const part = egenkontrollFilenamePart(n ?? '').toLowerCase();
    if (!part) return false;
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^egenkontroll_.+_${escaped}(?:-\\d+)?\\.pdf$`).test(fileName);
  });
}

/** Ett dokument som det sparats, när filen är fryst: allt som job.document bär. */
export type PortalJobDocumentReadyRow = {
  id: string;
  quoteId: string;
  kind: PortalJobDocumentKind;
  name: string;
  sha256: string;
  byteSize: number;
  /** När filen frystes (ready_at), i vilken form den än skrivs. Händelsens occurredAt. */
  readyAt: string;
};

/** Referensen i köns kropp. Utskicket byter den mot filens innehåll (outboundContent.ts). */
export type PortalJobDocumentContentRef = { documentId: string; sha256: string; bytes: number };

/**
 * Köns händelse för ett fryst dokument. Byggs bara ur raden, så att samma dokument alltid ger samma kropp: köar cron ett
 * dokument som aldrig hann köas blir det samma händelse, och kön nekar en annan kropp med samma nyckel.
 */
export function buildPortalJobDocumentEvent(row: PortalJobDocumentReadyRow) {
  return {
    idempotencyKey: portalJobDocumentKey(row.id),
    path: PORTAL_EVENTS_PATH,
    orderingKey: portalJobOrderingKey(row.quoteId),
    supersedeKey: portalJobDocumentSupersedeKey(row.quoteId, row.kind),
    payload: {
      type: 'job.document' as const,
      occurredAt: new Date(row.readyAt).toISOString(),
      data: { quoteId: row.quoteId, kind: row.kind, name: row.name },
      contentRef: { documentId: row.id, sha256: row.sha256, bytes: row.byteSize } satisfies PortalJobDocumentContentRef,
    },
  };
}

// ---------------------------------------------------------------------------------------------------- kortet

export type PortalJobDocumentStatus = 'building' | 'ready' | 'failed';

/** Hur det gått med ett fryst dokument hos butiken. */
export type PortalJobDocumentDelivery = 'sending' | 'sent' | 'failed' | 'replaced';

/**
 * Läget ur köns status. Ingen rad (inte köad än), väntande och på väg är alla "skickas": kön gör om den tills portalen
 * svarat. Uppgiven = kom inte fram. Ersatt = en nyare version hann köas innan den här gick iväg.
 */
export function portalJobDocumentDelivery(queueStatus: string | null | undefined): PortalJobDocumentDelivery {
  if (queueStatus === 'sent') return 'sent';
  if (queueStatus === 'dead') return 'failed';
  if (queueStatus === 'superseded') return 'replaced';
  return 'sending';
}

export type PortalJobDocumentView = {
  id: string;
  kind: PortalJobDocumentKind;
  status: PortalJobDocumentStatus;
  name: string | null;
  sizeBytes: number | null;
  /** Varför det inte gick (status failed). */
  error: string | null;
  /** Den som skickade, eller null för den automatiska orderbekräftelsen. */
  createdByName: string | null;
  createdAt: string;
  /** Bara för en fryst fil. */
  delivery: PortalJobDocumentDelivery | null;
};

/** Varför inget kan skickas nu, oavsett vem som tittar. */
export type PortalJobDocumentsBlocked = 'not_confirmed' | 'cancelled';

export type PortalJobDocumentsView = {
  /** Den som tittar får skicka: har ordern, eller är admin, och har skrivnyckeln (svarsregeln). Servern avgör. */
  canSend: boolean;
  blocked: PortalJobDocumentsBlocked | null;
  /** Den senaste versionen per sort, eller null. */
  latest: Record<PortalJobDocumentKind, PortalJobDocumentView | null>;
  /**
   * Den senaste egenkontrollen på ordern, bara för den som får skicka. `belongsToOrder`: filnamnet slutar på orderns
   * nummer. Annars gäller länken i kommentaren en annan order, och den skickas inte.
   */
  selfInspection: { path: string; fileName: string; commentedAt: string | null; belongsToOrder: boolean } | null;
};
