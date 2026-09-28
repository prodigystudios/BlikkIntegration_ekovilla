import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasNewerFrozenDocument } from './jobDocumentsDecision';
import {
  PORTAL_JOB_DOCUMENTS_BUCKET,
  PORTAL_JOB_DOCUMENT_MAX_BYTES,
  isPdfBytes,
  isPortalJobDocumentKind,
  portalJobDocumentPath,
} from './jobDocuments';

/**
 * Köns kropp som den skickas (RESELLER_PORTAL_CRM_PLAN.md fas 7). De flesta händelser skickas som de köades. Ett
 * dokument (job.document) köas med en referens till den frysta PDF:en (`contentRef`), och här byts referensen mot
 * filens innehåll i base64, vid varje försök:
 *   - först: är det fortfarande det senast BESLUTADE dokumentet av sin sort på jobbet (jobDocumentsDecision.ts)? Annars
 *     skickas det aldrig ('skip', kön markerar det ersatt). Provet görs här, precis före sändningen: kön SKICKAR ett
 *     jobbs händelser en i taget, så ett senare beslut som köas under tiden hamnar efter det här och kommer fram sist
 *     (butiken behåller det senast mottagna). Köns supersedeKey används inte för dokument: den ersätter i den ordning
 *     händelserna KOM, och en äldre som köades sent hade då ersatt en nyare;
 *   - filen hämtas ur bucketen med service-rollen;
 *   - storleken, `%PDF-` och sha256 kontrolleras mot referensen, så att samma Idempotency-Key aldrig ger andra byte
 *     (portalen svarar 422 på det);
 *   - kroppen byggs i en fast ordning: { type, occurredAt, data: { quoteId, kind, name, contentBase64 } }.
 * Kön behåller bara referensen: claim-funktionen lämnar ut hela raden, och portalsidan läser kroppen.
 */

/** Ett dokument är upp till 4,4 MB att ladda upp, och portalen sparar det i sin lagring innan den svarar. */
export const PORTAL_DOCUMENT_REQUEST_TIMEOUT_MS = 30_000;

export type PreparedPortalPayload =
  | { kind: 'ready'; payload: unknown; timeoutMs?: number }
  /** Går att göra om: lagringen svarade inte. Räknas som ett försök. */
  | { kind: 'retry'; error: string }
  /** Blir aldrig rätt: ingen fil, eller en fil som inte stämmer med kön. Ges upp. */
  | { kind: 'dead'; error: string }
  /** Ska inte skickas: ett senare beslut av samma sort finns. Kön markerar händelsen ersatt. */
  | { kind: 'skip'; error: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

type QueuedDocument = {
  type: 'job.document';
  occurredAt: string;
  data: { quoteId: string; kind: string; name: string };
  contentRef: { documentId: string; sha256: string; bytes: number };
};

function asQueuedDocument(payload: unknown): QueuedDocument | null {
  const p = payload as Partial<QueuedDocument> | null;
  const data = p?.data as Partial<QueuedDocument['data']> | undefined;
  const ref = p?.contentRef as Partial<QueuedDocument['contentRef']> | undefined;
  if (
    p?.type !== 'job.document' ||
    typeof p.occurredAt !== 'string' ||
    typeof data?.quoteId !== 'string' ||
    !isPortalJobDocumentKind(data.kind) ||
    typeof data.name !== 'string' ||
    typeof ref?.documentId !== 'string' ||
    !UUID.test(ref.documentId) ||
    typeof ref.sha256 !== 'string' ||
    !SHA256.test(ref.sha256) ||
    typeof ref.bytes !== 'number' ||
    !Number.isInteger(ref.bytes)
  ) {
    return null;
  }
  return p as QueuedDocument;
}

/** Ett fel från lagringen som betyder att filen inte finns (då hjälper inga omförsök). Delas med arkivets läsning. */
export function isMissingObject(error: { message?: string; status?: number; statusCode?: string | number }): boolean {
  const status = Number(error.status ?? error.statusCode);
  return status === 404 || /not[\s_-]?found/i.test(error.message ?? '');
}

export async function preparePortalPayload(admin: SupabaseClient, payload: unknown): Promise<PreparedPortalPayload> {
  const hasRef = Boolean(payload && typeof payload === 'object' && 'contentRef' in payload);
  if (!hasRef) return { kind: 'ready', payload };

  const doc = asQueuedDocument(payload);
  if (!doc) return { kind: 'dead', error: 'dokumentet: referensen i kön har fel form' };
  const { data, contentRef: ref } = doc;
  if (ref.bytes > PORTAL_JOB_DOCUMENT_MAX_BYTES) {
    return { kind: 'dead', error: `dokumentet: ${ref.bytes} byte, portalen tar emot högst ${PORTAL_JOB_DOCUMENT_MAX_BYTES}` };
  }

  // Det senast beslutade dokumentet av sin sort vinner (kortet visar det; butiken behåller det senast mottagna).
  const decided = await admin
    .from('crm_portal_job_documents')
    .select('quote_id, kind, status, created_at')
    .eq('id', ref.documentId)
    .maybeSingle();
  if (decided.error) return { kind: 'retry', error: `dokumentet: raden kunde inte läsas: ${decided.error.message}` };
  const own = decided.data as { quote_id: string; kind: string; status: string; created_at: string } | null;
  if (!own || own.quote_id !== data.quoteId || own.kind !== data.kind) {
    return { kind: 'dead', error: 'dokumentet: raden stämmer inte med kön' };
  }
  // Markerad misslyckad (ersatt eller jobbet avbröts) innan den skickades: med flit, inget att skicka om. Ett annat läge
  // kan inte finnas för en köad rad; hittas det ges händelsen upp och syns på portalsidan.
  if (own.status === 'failed') return { kind: 'skip', error: 'dokumentet: skickas inte (markerat på arbetsordern)' };
  if (own.status !== 'ready') return { kind: 'dead', error: `dokumentet: raden har läget ${own.status}` };
  // Kastar frågan gör utskicket om (dispatchPortalOutbox fångar det som 'retry').
  if (await hasNewerFrozenDocument(admin, { quoteId: own.quote_id, kind: own.kind, createdAt: own.created_at })) {
    return { kind: 'skip', error: 'dokumentet: ersatt av ett senare' };
  }

  const downloaded = await admin.storage
    .from(PORTAL_JOB_DOCUMENTS_BUCKET)
    .download(portalJobDocumentPath(data.quoteId, ref.documentId));
  if (downloaded.error || !downloaded.data) {
    const error = (downloaded.error ?? { message: 'tomt svar' }) as { message?: string; status?: number; statusCode?: string };
    if (isMissingObject(error)) return { kind: 'dead', error: 'dokumentet: den frysta filen finns inte' };
    return { kind: 'retry', error: `dokumentet: filen kunde inte hämtas: ${error.message ?? 'okänt fel'}` };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  // Aldrig andra byte under samma nyckel: portalen hade svarat 422, och butiken fått något annat än det som frystes.
  // Hashen täcker också storleken; referensens storlek prövades mot gränsen före hämtningen.
  if (!isPdfBytes(bytes) || sha256Hex(bytes) !== ref.sha256) {
    return { kind: 'dead', error: 'dokumentet: filen stämmer inte med kön (storlek, PDF eller hash)' };
  }

  return {
    kind: 'ready',
    timeoutMs: PORTAL_DOCUMENT_REQUEST_TIMEOUT_MS,
    payload: {
      type: 'job.document',
      occurredAt: doc.occurredAt,
      data: { quoteId: data.quoteId, kind: data.kind, name: data.name, contentBase64: Buffer.from(bytes).toString('base64') },
    },
  };
}
