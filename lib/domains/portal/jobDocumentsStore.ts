import type { SupabaseClient } from '@supabase/supabase-js';
import { findLatestEgenkontrollArchive } from '@/lib/domains/crm/egenkontrollLink';
import { listCrmWorkOrderComments } from '@/lib/domains/crm/work-orders';
import { enqueuePortalEvent } from './outbox';
import { hasNewerFrozenDocument, supersedeOlderDocuments } from './jobDocumentsDecision';
import { isMissingObject, sha256Hex } from './outboundContent';
import { parsePortalJobSyncState } from './jobState';
import { portalFortnoxRetryDelayMs } from './jobFortnoxRetry';
import {
  PORTAL_JOB_DOCUMENTS_BUCKET,
  PORTAL_JOB_DOCUMENT_KINDS,
  PORTAL_JOB_DOCUMENT_MAX_BYTES,
  buildPortalJobDocumentEvent,
  egenkontrollBelongsToOrder,
  formatDocumentSize,
  isPdfBytes,
  portalJobDocumentDelivery,
  portalJobDocumentKey,
  portalJobDocumentName,
  portalJobDocumentPath,
  type PortalJobDocumentKind,
  type PortalJobDocumentStatus,
  type PortalJobDocumentView,
  type PortalJobDocumentsBlocked,
  type PortalJobDocumentsView,
} from './jobDocuments';

/**
 * Dokumenten till butiken mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 7). Den rena delen står i ./jobDocuments.ts.
 * Tabellen är `crm_portal_job_documents`, bucketen `portal-job-documents`.
 *
 * Ett dokument i tre lägen:
 *   building   beslutat. Sessionen lägger till beslutet när någon trycker (RLS: svarsregeln), service-rollen när
 *              orderbekräftelsen skickas automatiskt (ett unikt index: en per jobb).
 *   ready      PDF:en är FRYST i bucketen under <quoteId>/<id>.pdf, med storlek och sha256. Sedan köas den. Kön bär en
 *              referens, och utskicket bygger base64-kroppen ur filen vid varje försök (outboundContent.ts).
 *   failed     gick inte, med skälet (för stor, ingen egenkontroll, jobbet avbröts, Fortnox svarade inte i ett dygn).
 *
 * SERVICE-ROLLEN läser Fortnox, arkivet och bucketen och skriver filen, hashen och kön: sessionen har ingen läsrätt till
 * någon av bucketarna. Den används först EFTER att sessionen fått lägga till beslutet, och bara för just det jobbet
 * (se "Reviewed elevations" i SUPABASE_CONVENTIONS.md). Klienten skickar aldrig en sökväg till en fil som läses: bara
 * arbetsorderns id och sorten, och för egenkontrollen sökvägen den visade, som bara jämförs med den servern själv hittar.
 *
 *   knappen      sendPortalJobDocument
 *   kortet       listPortalJobDocuments, och openPortalJobDocument ("Öppna" den skickade kopian)
 *   cron         sweepPortalJobDocuments: den automatiska orderbekräftelsen, omförsöken, och det som inte hann köas
 */

const TABLE = 'crm_portal_job_documents';

/** Hur länge den automatiska orderbekräftelsen försöker när Fortnox inte svarar. Samma dygn som Fortnox-omförsöken. */
export const PORTAL_DOCUMENT_RETRY_WINDOW_MS = 24 * 3600_000;
/** Lånet på ett automatiskt försök: dör processen tar nästa varv det efter så här lång tid. */
export const PORTAL_DOCUMENT_LEASE_MS = 10 * 60_000;
/** En knapptryckning som inte blivit en fil på så här lång tid dog med processen. */
export const PORTAL_DOCUMENT_ABANDONED_MS = 10 * 60_000;
/** Hur länge efter den levererade bekräftelsen den automatiska orderbekräftelsen skapas. */
export const PORTAL_DOCUMENT_AUTO_WINDOW_MS = 7 * 24 * 3600_000;
/** Så många PDF:er byggs per varv: varje orderbekräftelse är tre Fortnox-anrop. */
export const PORTAL_DOCUMENT_BUILDS_PER_RUN = 3;

// ------------------------------------------------------------------------------------------------ källorna

/** Utfallet av en källa. `permanent`: blir inte rätt av ett nytt försök. */
export type PortalDocumentSourceResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; permanent: boolean; error: string };

export type PortalDocumentSources = {
  /** Orderbekräftelsen i vår egen design (getFortnoxOrderPdf, ORDER_PDF_MODE). */
  renderOrderConfirmation: (workOrderId: string) => Promise<PortalDocumentSourceResult>;
  /** En fil i arkivet (egenkontrollerna), med service-rollen. */
  readArchive: (path: string) => Promise<PortalDocumentSourceResult>;
};

export function portalDocumentSources(admin: SupabaseClient, env: Record<string, string | undefined>): PortalDocumentSources {
  return {
    async renderOrderConfirmation(workOrderId) {
      const { getFortnoxOrderPdf, OrderPdfRotRefusedError } = await import('@/lib/domains/fortnox/orders');
      const { FortnoxApiError, friendlyFortnoxMessage } = await import('@/lib/domains/fortnox/client');
      try {
        // Portalens ordrar har ingen ROT (planen: "ingen rabatt och ingen ROT"). Med ROT skriver orderbekräftelsen ut
        // sökandens personnummer, och det ska inte till butiken: renderingen vägrar, på samma läsning som den ritar ur.
        const { bytes } = await getFortnoxOrderPdf(workOrderId, { refuseRot: true });
        return { ok: true, bytes };
      } catch (e) {
        if (e instanceof OrderPdfRotRefusedError) {
          return { ok: false, permanent: true, error: 'Ordern har ROT påslagen. Orderbekräftelsen skickas inte till butiken.' };
        }
        // 409 = ordern finns inte i Fortnox; det rättar inget omförsök. Allt annat (Fortnox nere, anslutningen ute, ett
        // fel i renderingen) kan gå nästa gång.
        const permanent = e instanceof FortnoxApiError && e.status === 409;
        return { ok: false, permanent, error: `Orderbekräftelsen kunde inte skapas: ${friendlyFortnoxMessage(e)}` };
      }
    },
    async readArchive(path) {
      // Samma bucket som arkivets routes (app/api/storage).
      const bucket = env.SUPABASE_BUCKET || 'pdfs';
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) {
        return isMissingObject((error ?? {}) as { message?: string; status?: number; statusCode?: string })
          ? { ok: false, permanent: true, error: 'Egenkontrollen finns inte i arkivet.' }
          : { ok: false, permanent: false, error: 'Egenkontrollen kunde inte hämtas ur arkivet. Försök igen.' };
      }
      return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
    },
  };
}

// ------------------------------------------------------------------------------------------------- jobbet

const WORK_ORDER_SELECT = 'id, status, order_number, fortnox_order_number, project_name, work_address';

type WorkOrderRow = {
  id: string;
  status: string;
  order_number: string | null;
  fortnox_order_number: string | number | null;
  project_name: string | null;
  work_address: { street_address?: string | null; city?: string | null } | null;
};

type JobGate = {
  quoteId: string;
  workOrder: WorkOrderRow | null;
  /** null = dokument kan skickas. */
  blocked: PortalJobDocumentsBlocked | null;
};

/**
 * Får jobbet dokument nu? Med service-rollen: kön och jobbets läge är bara service_role:s.
 *   cancelled       avbrutet eller borttaget (William 2026-09-28: inga dokument)
 *   not_confirmed   job.confirmed är inte levererad (kontraktspunkt 22: inget efter bekräftelsen förrän den är mottagen)
 */
async function readJobGate(admin: SupabaseClient, quoteId: string): Promise<JobGate | null> {
  const job = await admin
    .from('crm_portal_jobs')
    .select('quote_id, work_order_id, work_order_created_at, sync_state')
    .eq('quote_id', quoteId)
    .maybeSingle();
  if (job.error) throw new Error(`Jobbet gick inte att läsa: ${job.error.message}`);
  const row = job.data as { quote_id: string; work_order_id: string | null; work_order_created_at: string | null; sync_state: unknown } | null;
  if (!row) return null;

  const state = parsePortalJobSyncState(row.sync_state);
  let workOrder: WorkOrderRow | null = null;
  if (row.work_order_id) {
    const wo = await admin.from('crm_work_orders').select(WORK_ORDER_SELECT).eq('id', row.work_order_id).maybeSingle();
    if (wo.error) throw new Error(`Arbetsordern gick inte att läsa: ${wo.error.message}`);
    workOrder = wo.data as WorkOrderRow | null;
  }

  const removed = !workOrder && row.work_order_created_at !== null;
  if (state.cancelled || removed || workOrder?.status === 'cancelled') return { quoteId, workOrder, blocked: 'cancelled' };
  // Ingen nyckel = bekräftelsen är inte ens köad; då finns inget i kön att fråga om.
  if (!workOrder || !state.confirmedKey) return { quoteId, workOrder, blocked: 'not_confirmed' };

  const confirmed = await admin.from('portal_outbound_events').select('status').eq('idempotency_key', state.confirmedKey).maybeSingle();
  if (confirmed.error) throw new Error(`Bekräftelsens status gick inte att läsa: ${confirmed.error.message}`);
  const delivered = (confirmed.data as { status: string } | null)?.status === 'sent';
  return { quoteId, workOrder, blocked: delivered ? null : 'not_confirmed' };
}

/** Sorten i bestämd form, för meningar: "Egenkontrollen är 4,1 MB." */
const DEFINITE: Record<PortalJobDocumentKind, string> = {
  order_confirmation: 'Orderbekräftelsen',
  self_inspection: 'Egenkontrollen',
};

const REPLACED_TEXT = 'Ersattes av en nyare innan den hann skickas.';

const BLOCKED_TEXT: Record<PortalJobDocumentsBlocked, string> = {
  cancelled: 'Jobbet är avbrutet. Butiken får inga fler dokument.',
  not_confirmed: 'Butiken har inte fått bekräftelsen på jobbet än. Dokumenten skickas efter den.',
};

function orderNumberOf(workOrder: WorkOrderRow): string {
  const fortnox = workOrder.fortnox_order_number;
  return fortnox !== null && fortnox !== undefined && String(fortnox).trim() ? String(fortnox).trim() : (workOrder.order_number ?? '');
}

function workplaceOf(workOrder: WorkOrderRow): string {
  const street = workOrder.work_address?.street_address?.trim() ?? '';
  const city = workOrder.work_address?.city?.trim() ?? '';
  return [street, city].filter(Boolean).join(', ') || (workOrder.project_name ?? '').trim();
}

// -------------------------------------------------------------------------------------------- att frysa filen

type DocumentRow = {
  id: string;
  quote_id: string;
  kind: PortalJobDocumentKind;
  status: PortalJobDocumentStatus;
  name: string | null;
  byte_size: number | null;
  sha256: string | null;
  source_ref: string | null;
  error: string | null;
  attempts: number;
  next_attempt_at: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  ready_at: string | null;
  queued_at: string | null;
};

const ROW_SELECT =
  'id, quote_id, kind, status, name, byte_size, sha256, source_ref, error, attempts, next_attempt_at, created_by, created_by_name, created_at, ready_at, queued_at';

type BuildOutcome =
  | { kind: 'ready'; row: DocumentRow }
  | { kind: 'failed'; error: string }
  /** Går att göra om (Fortnox eller arkivet svarade inte). */
  | { kind: 'retry'; error: string };

/** Filen ur sin källa, kontrollerad (PDF, storleken). Rör inte databasen; källorna läser det de behöver. */
async function readSource(
  row: Pick<DocumentRow, 'kind'>,
  gate: JobGate & { workOrder: WorkOrderRow },
  sources: PortalDocumentSources,
  selfInspectionPath: string | null,
): Promise<{ ok: true; bytes: Uint8Array; sourceRef: string } | { ok: false; permanent: boolean; error: string }> {
  const { workOrder } = gate;
  let result: PortalDocumentSourceResult;
  let sourceRef: string;
  if (row.kind === 'order_confirmation') {
    if (workOrder.fortnox_order_number === null || workOrder.fortnox_order_number === undefined) {
      return { ok: false, permanent: true, error: 'Ordern finns inte i Fortnox.' };
    }
    sourceRef = String(workOrder.fortnox_order_number);
    result = await sources.renderOrderConfirmation(workOrder.id);
  } else {
    // Sökvägen kommer bara från sendPortalJobDocument, som tagit den ur just den här orderns kommentarer, jämfört den
    // med den som kortet visade och prövat orderns nummer i filnamnet. Cron bygger aldrig en egenkontroll.
    if (!selfInspectionPath) return { ok: false, permanent: true, error: 'Ingen egenkontroll att skicka.' };
    sourceRef = selfInspectionPath;
    result = await sources.readArchive(selfInspectionPath);
  }
  if (!result.ok) return result;

  const label = DEFINITE[row.kind];
  if (!isPdfBytes(result.bytes)) return { ok: false, permanent: true, error: `${label} är ingen PDF.` };
  if (result.bytes.length > PORTAL_JOB_DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      permanent: true,
      error: `${label} är ${formatDocumentSize(result.bytes.length)}. Butiken kan ta emot högst ${formatDocumentSize(PORTAL_JOB_DOCUMENT_MAX_BYTES)}.`,
    };
  }
  return { ok: true, bytes: result.bytes, sourceRef };
}

const isExistsError = (error: { message?: string; status?: number; statusCode?: string }) =>
  Number(error.status ?? error.statusCode) === 409 || /already exists|duplicate/i.test(error.message ?? '');

/**
 * Fryser filen: laddar upp den (skrivs aldrig över) och gör raden ready med storlek och hash. Finns filen redan, efter
 * en process som dog mellan uppladdningen och raden eller ett varv som hann före, används DEN: filen på en sökväg hör
 * alltid till just det id:t, och hashen räknas på det som faktiskt ligger där.
 */
async function freeze(
  admin: SupabaseClient,
  row: DocumentRow,
  gate: JobGate & { workOrder: WorkOrderRow },
  sources: PortalDocumentSources,
  selfInspectionPath: string | null,
  now: Date,
): Promise<BuildOutcome> {
  const source = await readSource(row, gate, sources, selfInspectionPath);
  if (!source.ok) return source.permanent ? { kind: 'failed', error: source.error } : { kind: 'retry', error: source.error };

  const bucket = admin.storage.from(PORTAL_JOB_DOCUMENTS_BUCKET);
  const path = portalJobDocumentPath(row.quote_id, row.id);
  let bytes = source.bytes;
  const uploaded = await bucket.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (uploaded.error) {
    if (!isExistsError(uploaded.error as { message?: string })) {
      return { kind: 'retry', error: `Filen kunde inte sparas: ${uploaded.error.message}` };
    }
    const existing = await bucket.download(path);
    if (existing.error || !existing.data) return { kind: 'retry', error: 'Den sparade filen kunde inte läsas.' };
    bytes = new Uint8Array(await existing.data.arrayBuffer());
    if (!isPdfBytes(bytes) || bytes.length > PORTAL_JOB_DOCUMENT_MAX_BYTES) {
      return { kind: 'failed', error: 'Den sparade filen är ingen giltig PDF.' };
    }
  }

  const ready = await admin
    .from(TABLE)
    .update({
      status: 'ready',
      name: portalJobDocumentName(row.kind, orderNumberOf(gate.workOrder), workplaceOf(gate.workOrder)),
      byte_size: bytes.length,
      sha256: sha256Hex(bytes),
      source_ref: source.sourceRef,
      ready_at: now.toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'building')
    .select(ROW_SELECT);
  if (ready.error) throw new Error(`Dokumentet kunde inte bokföras: ${ready.error.message}`);
  const saved = (ready.data ?? [])[0] as DocumentRow | undefined;
  if (saved) return { kind: 'ready', row: saved };

  // Någon annan hann: läs raden som den står.
  const current = await readRow(admin, row.id);
  if (current?.status === 'ready') return { kind: 'ready', row: current };
  return { kind: 'failed', error: current?.error ?? 'Dokumentet ändrades under tiden.' };
}

async function readRow(admin: SupabaseClient, id: string): Promise<DocumentRow | null> {
  const { data, error } = await admin.from(TABLE).select(ROW_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Dokumentet gick inte att läsa: ${error.message}`);
  return data as DocumentRow | null;
}

/**
 * Bara om den fortfarande byggs (eller är fryst men inte köad): ett köat eller redan misslyckat dokument ändras inte.
 * Svarar om raden ändrades.
 */
async function markFailed(admin: SupabaseClient, id: string, error: string, from: 'building' | 'ready' = 'building'): Promise<boolean> {
  const query = admin.from(TABLE).update({ status: 'failed', error: error.slice(0, 2000) }).eq('id', id).eq('status', from);
  const { data, error: dbError } = await (from === 'ready' ? query.is('queued_at', null) : query).select('id');
  if (dbError) throw new Error(`Dokumentet kunde inte markeras: ${dbError.message}`);
  return (data ?? []).length > 0;
}


/**
 * Köar ett fryst dokument och bokför det. Jobbet prövas en gång till först: avbröts det medan filen frystes skickas
 * inget (William 2026-09-28), och dokumentet står som misslyckat. Idempotent: kön känner igen nyckeln.
 *
 * Den senast BESLUTADE av samma sort vinner, som kortet visar den (jobDocumentsDecision.ts). Här sållas en äldre som
 * frystes sent bort (en process som dog före köandet, eller den automatiska efter ett dygns Fortnox-omförsök), så att
 * kortet säger "ersatt"; och när den här köats ersätts äldre beslut som ännu väntar. Det avgörande provet görs ändå av
 * utskicket, precis före sändningen (outboundContent.ts): mellan provet här och köandet kan en nyare hinna köas.
 *   queued    köad nu, eller redan i kön men inte bokförd (en process som dog): bokförd här
 *   already   någon annan hann markera raden
 */
async function queueReady(
  admin: SupabaseClient,
  row: DocumentRow,
  now: Date,
): Promise<'queued' | 'cancelled' | 'replaced' | 'already'> {
  // Redan i kön (köandet gick men processen dog före bokföringen): gör klart det som återstod, ersättningen av äldre och
  // bokföringen. Ett dokument på väg till butiken markeras aldrig misslyckat.
  const queued = await admin.from('portal_outbound_events').select('status').eq('idempotency_key', portalJobDocumentKey(row.id)).maybeSingle();
  if (queued.error) throw new Error(`Köns status gick inte att läsa: ${queued.error.message}`);
  if (queued.data) {
    await supersedeOlder(admin, row);
    await markQueued(admin, row.id, now);
    return 'queued';
  }
  const gate = await readJobGate(admin, row.quote_id);
  if (!gate || gate.blocked === 'cancelled') {
    return (await markFailed(admin, row.id, BLOCKED_TEXT.cancelled, 'ready')) ? 'cancelled' : 'already';
  }
  if (await hasNewerFrozenDocument(admin, { quoteId: row.quote_id, kind: row.kind, createdAt: row.created_at })) {
    return (await markFailed(admin, row.id, REPLACED_TEXT, 'ready')) ? 'replaced' : 'already';
  }
  // Varje anropare har en fryst rad (databasens check: ready har namn, hash, storlek och tid). Provet är för typerna.
  if (!row.name || !row.sha256 || row.byte_size === null || !row.ready_at) {
    throw new Error(`Dokumentet ${row.id} är inte fryst.`);
  }
  await enqueuePortalEvent(
    admin,
    buildPortalJobDocumentEvent({
      id: row.id,
      quoteId: row.quote_id,
      kind: row.kind,
      name: row.name,
      sha256: row.sha256,
      byteSize: row.byte_size,
      readyAt: row.ready_at,
    }),
  );
  await supersedeOlder(admin, row);
  await markQueued(admin, row.id, now);
  return 'queued';
}

/** Äldre beslut som ännu väntar behöver aldrig fram. Går det inte hoppar utskicket över dem ändå. */
async function supersedeOlder(admin: SupabaseClient, row: DocumentRow): Promise<void> {
  try {
    await supersedeOlderDocuments(admin, { id: row.id, quoteId: row.quote_id, kind: row.kind, createdAt: row.created_at });
  } catch (e) {
    console.error('[portal-documents] äldre dokument kunde inte ersättas, utskicket hoppar över dem', {
      id: row.id,
      error: e instanceof Error ? e.message : e,
    });
  }
}

async function markQueued(admin: SupabaseClient, id: string, now: Date): Promise<void> {
  const marked = await admin.from(TABLE).update({ queued_at: now.toISOString() }).eq('id', id).is('queued_at', null);
  if (marked.error) throw new Error(`Dokumentet köades men kunde inte bokföras: ${marked.error.message}`);
}

// ------------------------------------------------------------------------------------------------- knappen

export type SendPortalJobDocumentInput = {
  workOrderId: string;
  /** Klientens id (uuid). Samma id två gånger (dubbelklick, omförsök) blir samma dokument, inte två. */
  documentId: string;
  kind: PortalJobDocumentKind;
  /** Egenkontrollen som kortet visade. Servern jämför den med den senaste den själv hittar. */
  sourcePath: string | null;
  actor: { id: string; name: string | null };
};

/**
 *   sent            fryst och köat, eller redan skickat med samma id; routen skickar kön direkt efter svaret
 *   failed          gick inte (för stor, Fortnox, fel order): dokumentet står som misslyckat, med skälet
 *   not_found       ingen portalorder som sessionen ser
 *   blocked         jobbet är avbrutet, eller bekräftelsen är inte levererad
 *   forbidden       RLS nekade: varken ansvarig för ordern eller admin (eller saknar skrivnyckeln)
 *   no_source       ingen egenkontroll på ordern
 *   source_changed  en annan egenkontroll än den kortet visade är den senaste nu
 *   wrong_order     egenkontrollen i kommentarerna gäller en annan order
 *   conflict        samma id är redan använt för ett annat dokument
 */
export type SendPortalJobDocumentResult =
  | { kind: 'sent'; created: boolean; document: PortalJobDocumentView }
  | { kind: 'failed'; document: PortalJobDocumentView }
  | { kind: 'blocked'; reason: PortalJobDocumentsBlocked; message: string }
  | { kind: 'not_found' | 'forbidden' | 'no_source' | 'source_changed' | 'wrong_order' | 'conflict' };

/** Den senaste egenkontrollen på ordern, ur kommentarerna som sessionen ser dem. */
async function latestSelfInspection(session: SupabaseClient, workOrderId: string) {
  const { data, error } = await listCrmWorkOrderComments(session, workOrderId);
  if (error) throw new Error(`Kommentarerna gick inte att läsa: ${error.message}`);
  return findLatestEgenkontrollArchive((data ?? []) as { body?: string | null; created_at?: string | null }[]);
}

export async function sendPortalJobDocument(
  session: SupabaseClient,
  admin: SupabaseClient,
  sources: PortalDocumentSources,
  input: SendPortalJobDocumentInput,
  now: () => Date = () => new Date(),
): Promise<SendPortalJobDocumentResult> {
  const job = await session.from('crm_portal_jobs').select('quote_id').eq('work_order_id', input.workOrderId).maybeSingle();
  if (job.error) throw new Error(`Portalordern gick inte att läsa: ${job.error.message}`);
  const quoteId = (job.data as { quote_id: string } | null)?.quote_id;
  if (!quoteId) return { kind: 'not_found' };

  // Samma id igen (dubbelklick, ett omförsök efter ett avbrott): svara med det som finns, gör inget nytt.
  const earlier = await session.from(TABLE).select(VIEW_SELECT).eq('id', input.documentId).maybeSingle();
  if (earlier.error) throw new Error(`Dokumentet gick inte att läsa: ${earlier.error.message}`);
  if (earlier.data) return answerExisting(admin, earlier.data as ViewRow, quoteId, input.kind);

  const gate = await readJobGate(admin, quoteId);
  if (!gate) return { kind: 'not_found' };
  if (gate.blocked) return { kind: 'blocked', reason: gate.blocked, message: BLOCKED_TEXT[gate.blocked] };
  const workOrder = gate.workOrder!;

  let selfInspectionPath: string | null = null;
  if (input.kind === 'self_inspection') {
    const latest = await latestSelfInspection(session, input.workOrderId);
    if (!latest) return { kind: 'no_source' };
    if (latest.path !== input.sourcePath) return { kind: 'source_changed' };
    if (!egenkontrollBelongsToOrder(latest.path, [String(workOrder.fortnox_order_number ?? ''), workOrder.order_number])) {
      return { kind: 'wrong_order' };
    }
    selfInspectionPath = latest.path;
  }

  // Sessionen lägger till beslutet, så att RLS avgör vem som får skicka (svarsregeln, samma som för svaren).
  const inserted = await session
    .from(TABLE)
    .upsert(
      {
        id: input.documentId,
        quote_id: quoteId,
        kind: input.kind,
        created_by: input.actor.id,
        created_by_name: portalDocumentSenderName(input.actor.name),
      },
      // ON CONFLICT DO NOTHING: sessionen har ingen update. Två tryck med samma id i samma stund blir ett.
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select(VIEW_SELECT);
  if (inserted.error) {
    if (inserted.error.code === '42501') return { kind: 'forbidden' };
    throw new Error(`Dokumentet kunde inte sparas: ${inserted.error.message}`);
  }
  if ((inserted.data ?? []).length === 0) {
    const again = await session.from(TABLE).select(VIEW_SELECT).eq('id', input.documentId).maybeSingle();
    if (again.error || !again.data) throw new Error(`Dokumentet fanns redan men gick inte att läsa: ${again.error?.message ?? 'saknas'}`);
    return answerExisting(admin, again.data as ViewRow, quoteId, input.kind);
  }

  const row = await readRow(admin, input.documentId);
  if (!row) throw new Error('Dokumentet sparades men gick inte att läsa.');
  // En knapptryckning gör inte om: går det inte nu säger kortet varför, och man trycker igen.
  let outcome: BuildOutcome;
  try {
    outcome = await freeze(admin, row, { ...gate, workOrder }, sources, selfInspectionPath, now());
  } catch (e) {
    outcome = { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
  }
  if (outcome.kind !== 'ready') {
    await markFailed(admin, row.id, outcome.error);
    const failed = await readRow(admin, row.id);
    return { kind: 'failed', document: toView(failed ?? { ...row, status: 'failed', error: outcome.error }, new Map()) };
  }

  // Går köandet fel ligger filen fryst; cron köar den (sweepPortalJobDocuments), och kortet visar "Skickas …".
  try {
    await queueReady(admin, outcome.row, now());
  } catch (e) {
    console.error('[portal-documents] dokumentet kunde inte köas, cron tar det', { id: row.id, error: e instanceof Error ? e.message : e });
  }
  const statuses = await readStatusesSafe(admin, [portalJobDocumentKey(row.id)]);
  const current = (await readRow(admin, row.id)) ?? outcome.row;
  if (current.status === 'failed') return { kind: 'failed', document: toView(current, statuses) };
  return { kind: 'sent', created: true, document: toView(current, statuses) };
}

async function answerExisting(
  admin: SupabaseClient,
  existing: ViewRow,
  quoteId: string,
  kind: PortalJobDocumentKind,
): Promise<SendPortalJobDocumentResult> {
  if (existing.quote_id !== quoteId || existing.kind !== kind) return { kind: 'conflict' };
  const statuses = await readStatusesSafe(admin, [portalJobDocumentKey(existing.id)]);
  const document = toView(existing, statuses);
  return existing.status === 'failed' ? { kind: 'failed', document } : { kind: 'sent', created: false, document };
}

/** Namnet när den som skickar saknar ett i sin profil. */
function portalDocumentSenderName(name: string | null): string {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim();
  return clean ? Array.from(clean).slice(0, 200).join('').trim() : 'Ekovilla';
}

// -------------------------------------------------------------------------------------------------- kortet

/** Kolumnerna sessionen får läsa (kolumngrant). */
const VIEW_SELECT = 'id, quote_id, kind, status, name, byte_size, error, created_by, created_by_name, created_at, ready_at';

type ViewRow = Pick<
  DocumentRow,
  'id' | 'quote_id' | 'kind' | 'status' | 'name' | 'byte_size' | 'error' | 'created_by' | 'created_by_name' | 'created_at' | 'ready_at'
>;

/**
 * Köns status för dokumenten, med service-rollen, som för svaren (fas 6): kön är bara service_role:s, och bara `status`
 * lämnar servern. Nycklarna kommer ur raderna som SESSIONEN just kunde läsa.
 */
async function readStatuses(admin: SupabaseClient, keys: string[]): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await admin
      .from('portal_outbound_events')
      .select('idempotency_key, status')
      .in('idempotency_key', keys.slice(i, i + 100));
    if (error) throw new Error(`Dokumentens status gick inte att läsa: ${error.message}`);
    for (const r of (data ?? []) as { idempotency_key: string; status: string }[]) statuses.set(r.idempotency_key, r.status);
  }
  return statuses;
}

async function readStatusesSafe(admin: SupabaseClient, keys: string[]): Promise<Map<string, string>> {
  try {
    return await readStatuses(admin, keys);
  } catch (e) {
    console.error('[portal-documents] statusen gick inte att läsa', { error: e instanceof Error ? e.message : e });
    return new Map();
  }
}

function toView(row: ViewRow, statuses: Map<string, string>): PortalJobDocumentView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    name: row.name,
    sizeBytes: row.byte_size,
    error: row.error,
    createdByName: row.created_by ? row.created_by_name : null,
    createdAt: new Date(row.created_at).toISOString(),
    delivery: row.status === 'ready' ? portalJobDocumentDelivery(statuses.get(portalJobDocumentKey(row.id))) : null,
  };
}

/**
 * Dokumenten på arbetsordern: den senaste versionen per sort, om den som tittar får skicka, och den senaste
 * egenkontrollen (bara för den som får skicka). Sessionen läser raderna och kommentarerna (RLS) och frågar svarsregeln;
 * service-rollen läser köns status och jobbets läge. null = ingen portalorder som sessionen ser.
 */
export async function listPortalJobDocuments(
  session: SupabaseClient,
  admin: SupabaseClient,
  workOrderId: string,
): Promise<PortalJobDocumentsView | null> {
  const job = await session.from('crm_portal_jobs').select('quote_id').eq('work_order_id', workOrderId).maybeSingle();
  if (job.error) throw new Error(`Portalordern gick inte att läsa: ${job.error.message}`);
  const quoteId = (job.data as { quote_id: string } | null)?.quote_id;
  if (!quoteId) return null;

  // Regeln styr bara om knapparna visas. Databasen nekar ett beslut från den som inte får, vad kortet än visar.
  const [rule, list, gate] = await Promise.all([
    session.rpc('crm_portal_job_message_can_reply', { p_quote_id: quoteId }),
    session
      .from(TABLE)
      .select(VIEW_SELECT)
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50),
    readJobGate(admin, quoteId),
  ]);
  if (rule.error) console.error('[portal-documents] svarsregeln svarade inte', { error: rule.error.message });
  const canSend = rule.data === true;
  if (list.error) throw new Error(`Dokumenten gick inte att läsa: ${list.error.message}`);
  const rows = (list.data ?? []) as ViewRow[];
  const latestRows = PORTAL_JOB_DOCUMENT_KINDS.map((kind) => rows.find((r) => r.kind === kind) ?? null);
  const readyKeys = latestRows.filter((r): r is ViewRow => r?.status === 'ready').map((r) => portalJobDocumentKey(r.id));
  // Svarar inte kön visas dokumenten ändå, som "skickas".
  const statuses = readyKeys.length > 0 ? await readStatusesSafe(admin, readyKeys) : new Map<string, string>();
  const blocked = gate ? gate.blocked : 'cancelled';

  let selfInspection: PortalJobDocumentsView['selfInspection'] = null;
  if (canSend && !blocked && gate?.workOrder) {
    const latest = await latestSelfInspection(session, workOrderId);
    if (latest) {
      selfInspection = {
        path: latest.path,
        fileName: latest.path.split('/').pop() ?? latest.path,
        commentedAt: latest.commentedAt,
        belongsToOrder: egenkontrollBelongsToOrder(latest.path, [
          String(gate.workOrder.fortnox_order_number ?? ''),
          gate.workOrder.order_number,
        ]),
      };
    }
  }

  const latest = Object.fromEntries(
    PORTAL_JOB_DOCUMENT_KINDS.map((kind, i) => [kind, latestRows[i] ? toView(latestRows[i]!, statuses) : null]),
  ) as PortalJobDocumentsView['latest'];
  return { canSend, blocked, latest, selfInspection };
}

/**
 * "Öppna": exakt den PDF som frystes och skickades. Sessionen måste kunna läsa dokumentet (RLS) på just den här
 * arbetsordern; filen läses sedan med service-rollen. null = inget sådant dokument, eller ingen fryst fil.
 */
export async function openPortalJobDocument(
  session: SupabaseClient,
  admin: SupabaseClient,
  workOrderId: string,
  documentId: string,
): Promise<{ bytes: Uint8Array; name: string } | null> {
  const job = await session.from('crm_portal_jobs').select('quote_id').eq('work_order_id', workOrderId).maybeSingle();
  if (job.error) throw new Error(`Portalordern gick inte att läsa: ${job.error.message}`);
  const quoteId = (job.data as { quote_id: string } | null)?.quote_id;
  if (!quoteId) return null;

  const doc = await session.from(TABLE).select('id, quote_id, status, name').eq('id', documentId).eq('quote_id', quoteId).maybeSingle();
  if (doc.error) throw new Error(`Dokumentet gick inte att läsa: ${doc.error.message}`);
  const row = doc.data as { id: string; quote_id: string; status: string; name: string | null } | null;
  if (!row || row.status !== 'ready' || !row.name) return null;

  const file = await admin.storage.from(PORTAL_JOB_DOCUMENTS_BUCKET).download(portalJobDocumentPath(row.quote_id, row.id));
  if (file.error || !file.data) throw new Error(`Filen gick inte att hämta: ${file.error?.message ?? 'tom'}`);
  return { bytes: new Uint8Array(await file.data.arrayBuffer()), name: row.name };
}

// ---------------------------------------------------------------------------------------------------- cron

export type PortalJobDocumentsSweepSummary = {
  /** Nya automatiska orderbekräftelser (beslut). */
  created: number;
  /** Frysta och köade. */
  queued: number;
  /** Misslyckade för gott (för stor, ett dygn utan Fortnox, en knapptryckning som dog). */
  failed: number;
  /** Försöker igen senare. */
  retried: number;
  errors: number;
};

/**
 * Körs av runPortalCron. Fyra oberoende halvor; ett fel i en stoppar inte de andra.
 *   1. Den automatiska orderbekräftelsen: jobb vars job.confirmed levererats senaste veckan och som saknar en. Ett
 *      beslut per jobb (unikt index), så överlappande varv skapar aldrig två.
 *   2. Automatiska beslut som ska göras nu (nya, eller efter ett Fortnox-fel): frys och köa, högst tre per varv (ett
 *      från knapparna på portalsidan). Ett lån på tio minuter, så att två varv inte bygger samma. Fortnox nere: 5 min,
 *      15 min, sedan varje timme, i ett dygn. Har någon skickat en med knappen under tiden görs inget.
 *   3. En knapptryckning som inte blivit en fil på tio minuter dog med processen: misslyckad, tryck igen.
 *   4. Frysta dokument som inte hann köas (processen dog emellan): köas.
 */
export async function sweepPortalJobDocuments(
  admin: SupabaseClient,
  options: {
    now: () => Date;
    sources: PortalDocumentSources;
    /** Så många PDF:er byggs i varvet (standard tre). Knapparna på portalsidan bygger en. */
    builds?: number;
  },
): Promise<PortalJobDocumentsSweepSummary> {
  const now = options.now();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const summary: PortalJobDocumentsSweepSummary = { created: 0, queued: 0, failed: 0, retried: 0, errors: 0 };
  const failed = (what: string, e: unknown, id?: string) => {
    summary.errors += 1;
    console.error(`[portal-documents] ${what}`, { id, error: e instanceof Error ? e.message : e });
  };

  // 1. Nya automatiska beslut.
  try {
    const quoteIds = await confirmedInWindow(admin, iso(-PORTAL_DOCUMENT_AUTO_WINDOW_MS));
    // Ingen automatisk när jobbet redan har en orderbekräftelse: den automatiska (i vilket läge som helst, en per jobb),
    // eller en som någon skickat med knappen och som inte misslyckats. Annars hade en säljare som tryckte före cron gett
    // butiken två. Avbrutna jobb sållas bort här, så att de inte prövas en gång i minuten hela veckan. I omgångar om 20
    // jobb: en säljare som skickat om många gånger får inte trycka ut raderna förbi PostgREST:s 1000.
    const has = new Set<string>();
    const cancelled = new Set<string>();
    for (let i = 0; i < quoteIds.length; i += 20) {
      const chunk = quoteIds.slice(i, i + 20);
      const [automatic, inFlight, jobs] = await Promise.all([
        // En automatisk är alltid en orderbekräftelse (tabellens check).
        admin.from(TABLE).select('quote_id').is('created_by', null).in('quote_id', chunk),
        // Varje orderbekräftelse som byggs eller är fryst, oavsett vem som tryckte (en som byggs håller bara ett varv: blir
        // den fryst räknas den, och faller den skapas den automatiska nästa varv).
        admin.from(TABLE).select('quote_id').eq('kind', 'order_confirmation').in('status', ['building', 'ready']).in('quote_id', chunk),
        admin.from('crm_portal_jobs').select('quote_id, sync_state').in('quote_id', chunk),
      ]);
      const failure = automatic.error ?? inFlight.error ?? jobs.error;
      if (failure) throw new Error(failure.message);
      for (const r of [...(automatic.data ?? []), ...(inFlight.data ?? [])] as { quote_id: string }[]) has.add(r.quote_id);
      for (const j of (jobs.data ?? []) as { quote_id: string; sync_state: unknown }[]) {
        if (parsePortalJobSyncState(j.sync_state).cancelled) cancelled.add(j.quote_id);
      }
    }
    for (const quoteId of quoteIds.filter((q) => !has.has(q) && !cancelled.has(q))) {
      try {
        const gate = await readJobGate(admin, quoteId);
        // Avbrutet: inget beslut. Inte bekräftad (kan inte hända här, men läget kan ha ändrats): nästa varv.
        if (!gate || gate.blocked) continue;
        // Varvets tid, inte databasens: databasens now() ligger efter varvets start, och då hade steg 2 lämnat beslutet
        // till nästa varv.
        const inserted = await admin
          .from(TABLE)
          .insert({ quote_id: quoteId, kind: 'order_confirmation', next_attempt_at: now.toISOString() })
          .select('id');
        if (inserted.error) {
          if (inserted.error.code === '23505') continue; // ett annat varv hann
          throw new Error(inserted.error.message);
        }
        summary.created += 1;
      } catch (e) {
        failed('den automatiska orderbekräftelsen kunde inte beslutas', e, quoteId);
      }
    }
  } catch (e) {
    failed('de levererade bekräftelserna gick inte att läsa', e);
  }

  // 2. Automatiska beslut som ska göras nu.
  try {
    const due = await admin
      .from(TABLE)
      .select(ROW_SELECT)
      .eq('status', 'building')
      .is('created_by', null)
      .lte('next_attempt_at', now.toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(options.builds ?? PORTAL_DOCUMENT_BUILDS_PER_RUN);
    if (due.error) throw new Error(due.error.message);
    for (const row of (due.data ?? []) as DocumentRow[]) {
      try {
        await buildAutomatic(admin, row, options.sources, now, summary);
      } catch (e) {
        failed('den automatiska orderbekräftelsen kunde inte byggas', e, row.id);
      }
    }
  } catch (e) {
    failed('besluten gick inte att läsa', e);
  }

  // 3. Knapptryckningar som dog.
  try {
    const abandoned = await admin
      .from(TABLE)
      .select('id')
      .eq('status', 'building')
      .not('created_by', 'is', null)
      .lt('created_at', iso(-PORTAL_DOCUMENT_ABANDONED_MS))
      .limit(50);
    if (abandoned.error) throw new Error(abandoned.error.message);
    for (const row of (abandoned.data ?? []) as { id: string }[]) {
      try {
        if (await markFailed(admin, row.id, 'Avbröts innan filen hann sparas. Skicka igen.')) summary.failed += 1;
      } catch (e) {
        failed('en avbruten knapptryckning kunde inte markeras', e, row.id);
      }
    }
  } catch (e) {
    failed('de avbrutna knapptryckningarna gick inte att läsa', e);
  }

  // 4. Frysta men inte köade.
  try {
    const unqueued = await admin
      .from(TABLE)
      .select(ROW_SELECT)
      .eq('status', 'ready')
      .is('queued_at', null)
      .lt('ready_at', iso(-60_000))
      .gt('ready_at', iso(-PORTAL_DOCUMENT_AUTO_WINDOW_MS))
      .order('ready_at', { ascending: true })
      .limit(50);
    if (unqueued.error) throw new Error(unqueued.error.message);
    for (const row of (unqueued.data ?? []) as DocumentRow[]) {
      try {
        countQueued(summary, await queueReady(admin, row, now));
      } catch (e) {
        failed('dokumentet kunde inte köas', e, row.id);
      }
    }
  } catch (e) {
    failed('dokumenten som inte köats gick inte att läsa', e);
  }
  return summary;
}

async function buildAutomatic(
  admin: SupabaseClient,
  row: DocumentRow,
  sources: PortalDocumentSources,
  now: Date,
  summary: PortalJobDocumentsSweepSummary,
): Promise<void> {
  // Lånet: bara den som flyttar just den tiden får bygga.
  const leased = await admin
    .from(TABLE)
    .update({ next_attempt_at: new Date(now.getTime() + PORTAL_DOCUMENT_LEASE_MS).toISOString(), attempts: row.attempts + 1 })
    .eq('id', row.id)
    .eq('status', 'building')
    .eq('next_attempt_at', row.next_attempt_at)
    .select('id');
  if (leased.error) throw new Error(`Lånet kunde inte tas: ${leased.error.message}`);
  if ((leased.data ?? []).length === 0) return;
  const attempts = row.attempts + 1;

  const gate = await readJobGate(admin, row.quote_id);
  if (!gate || gate.blocked === 'cancelled') {
    if (await markFailed(admin, row.id, BLOCKED_TEXT.cancelled)) summary.failed += 1;
    return;
  }
  if (gate.blocked || !gate.workOrder) {
    // Ska inte hända (beslutet togs efter bekräftelsen); försök om en stund.
    await retryLater(admin, row, attempts, 'Bekräftelsen är inte levererad.', now);
    summary.retried += 1;
    return;
  }
  // Har någon skickat en med knappen under tiden (medan Fortnox var nere), fryst, är den automatiska överflödig: inga
  // Fortnox-anrop och ingen fil för något som ändå aldrig skickas. En som bara byggs räknas inte: faller den hade butiken
  // inte fått någon.
  if (await hasNewerFrozenDocument(admin, { quoteId: row.quote_id, kind: row.kind, createdAt: row.created_at })) {
    if (await markFailed(admin, row.id, REPLACED_TEXT)) summary.failed += 1;
    return;
  }

  let outcome: BuildOutcome;
  try {
    outcome = await freeze(admin, row, { ...gate, workOrder: gate.workOrder }, sources, null, now);
  } catch (e) {
    outcome = { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
  }
  if (outcome.kind === 'ready') {
    countQueued(summary, await queueReady(admin, outcome.row, now));
    return;
  }
  const expired = now.getTime() - new Date(row.created_at).getTime() >= PORTAL_DOCUMENT_RETRY_WINDOW_MS;
  if (outcome.kind === 'failed' || expired) {
    if (await markFailed(admin, row.id, outcome.error)) summary.failed += 1;
    return;
  }
  await retryLater(admin, row, attempts, outcome.error, now);
  summary.retried += 1;
}

/** Avbrutet eller ersatt räknas som misslyckat (det gick aldrig till butiken); det någon annan redan gjort räknas inte. */
function countQueued(summary: PortalJobDocumentsSweepSummary, outcome: Awaited<ReturnType<typeof queueReady>>) {
  if (outcome === 'queued') summary.queued += 1;
  else if (outcome !== 'already') summary.failed += 1;
}

/**
 * De jobb vars job.confirmed levererats sedan `since`, senaste först. sent_at sätts bara när portalen tagit emot
 * händelsen (outcomeUpdate), så fönstret tar bara levererade; grinden prövar ändå varje jobb innan ett beslut läggs.
 * HELA fönstret läses, i sidor: med bara de senaste hade ett jobb vars beslut föll på ett tillfälligt fel aldrig kommit
 * tillbaka. Den sista ordningen är unik (idempotency_key), annars kan .range() hoppa över eller upprepa rader.
 */
async function confirmedInWindow(admin: SupabaseClient, since: string): Promise<string[]> {
  const PAGE = 500;
  const ids = new Set<string>();
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    // Bara köns nyckel (job:<quoteId>), inte kroppen: fönstret läses varje minut.
    const { data, error } = await admin
      .from('portal_outbound_events')
      .select('ordering_key')
      .like('idempotency_key', 'job.confirmed-%')
      .gt('sent_at', since)
      .order('sent_at', { ascending: false })
      .order('idempotency_key', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { ordering_key: string | null }[];
    for (const r of rows) {
      const q = r.ordering_key?.startsWith('job:') ? r.ordering_key.slice('job:'.length) : '';
      if (q) ids.add(q);
    }
    if (rows.length < PAGE) break;
  }
  return [...ids];
}

async function retryLater(admin: SupabaseClient, row: DocumentRow, attempts: number, error: string, now: Date): Promise<void> {
  const { error: dbError } = await admin
    .from(TABLE)
    .update({ next_attempt_at: new Date(now.getTime() + portalFortnoxRetryDelayMs(attempts)).toISOString() })
    .eq('id', row.id)
    .eq('status', 'building');
  if (dbError) throw new Error(`Nästa försök kunde inte bokföras: ${dbError.message}`);
  console.warn('[portal-documents] försöker igen senare', { id: row.id, attempts, error });
}

