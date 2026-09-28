import type { SupabaseClient } from '@supabase/supabase-js';
import { buildWorkOrderNumber, fetchReadinessCustomer } from '@/lib/domains/crm/work-orders';
import { evaluateWorkOrderReadiness, type ReadinessQuoteSource } from '@/lib/domains/crm/workOrderReadiness';
import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';
import { FortnoxNotConnectedError, FortnoxPushInProgressError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { pushWorkOrderToFortnox, type PushOrderResult } from '@/lib/domains/fortnox/orders';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import {
  buildPortalJobFortnoxIssueNotification,
  buildPortalJobReceivedNotification,
} from '@/lib/domains/notifications/payload';
import type { NotificationContent } from '@/lib/domains/notifications/types';
import { portalAssignmentDeps, resolvePortalAssignee, type PortalAssignment } from './assignment';
import { canonicalJson } from './canonicalJson';
import {
  JOB_CUSTOMER_SELECT,
  buildPortalWorkOrderInsert,
  portalFortnoxBlockerReasons,
  workOrderLinesNeedDensity,
  type JobCustomerCard,
  type PortalJob,
  type RegisterArticleForJob,
} from './jobIntake';

/**
 * Jobbets intag mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 3b). Två steg, med flit åtskilda:
 *
 *   receivePortalJob    i anropet. Butiken, jobbets rad och arbetsordern. Portalen får 201 när arbetsordern finns.
 *   followUpPortalJob   efter svaret (waitUntil). Notisen "Nytt jobb", kontrollerna och Fortnox-ordern. Ett
 *                       Fortnox-avbrott kan alltså aldrig ge butiken ett fel eller få den att skicka ordern igen.
 *
 * SERVICE-ROLLEN: anropet från portalen har ingen användare bakom sig (se "Reviewed elevations" i
 * SUPABASE_CONVENTIONS.md). Grinden är signaturen och svarscachen i routen.
 *
 * Idempotent på affärsnyckeln, quoteId, utöver svarscachen:
 *   - Jobbets rad tas först, med arbetsorderns id valt i förväg. Arbetsordern skapas med det id:t, och ordernumret
 *     räknas ur det. Ett omförsök efter ett avbrott fortsätter där det förra föll och skapar aldrig en andra order.
 *   - Samma quoteId igen (en ny Idempotency-Key) ger den befintliga arbetsordern, om innehållet är detsamma. Ett annat
 *     innehåll nekas (409): en ändring ska inte försvinna utan att någon märker det.
 *   - Notiserna skickas en gång var: den som sätter tiden på raden skickar.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

export type JobIntakeDeps = {
  assign: (input: { resellerId: string; customerId: string | null; workplace: { postalCode: string; city: string } }) => Promise<PortalAssignment>;
  registerArticles: (articleNumbers: string[]) => Promise<RegisterArticleForJob[]>;
  newId: () => string;
  now: () => Date;
};

export function jobIntakeDeps(admin: SupabaseClient): JobIntakeDeps {
  return {
    assign: (input) => resolvePortalAssignee(portalAssignmentDeps(admin, input)),
    // Hela registret för de här numren, också inaktiva: namnet och enheten gäller ändå raden.
    registerArticles: (articleNumbers) => listCachedFortnoxArticles({ activeOnly: false, numbers: articleNumbers }),
    newId: () => globalThis.crypto.randomUUID(),
    now: () => new Date(),
  };
}

type JobRow = {
  quote_id: string;
  payload: unknown;
  received_at: string;
  customer_id: string | null;
  assigned_to: string | null;
  reserved_work_order_id: string;
  work_order_id: string | null;
  work_order_created_at: string | null;
};

const JOB_SELECT = 'quote_id, payload, received_at, customer_id, assigned_to, reserved_work_order_id, work_order_id, work_order_created_at';

export type ReceivePortalJobResult =
  /** Arbetsordern skapades i det här anropet. */
  | { kind: 'created'; workOrderId: string }
  /** Jobbet fanns redan, med samma innehåll. */
  | { kind: 'existing'; workOrderId: string }
  /** Jobbet fanns redan, med ett annat innehåll. */
  | { kind: 'conflict' }
  /** Arbetsordern skapades men har tagits bort hos Ekovilla. Den skapas inte igen. */
  | { kind: 'work_order_removed' }
  /** Ingen i fördelningen kan ta jobbet. Det tas inte emot än (William 2026-09-28). */
  | { kind: 'no_assignee'; assignment: Extract<PortalAssignment, { kind: 'none' }> };

async function readJob(admin: SupabaseClient, quoteId: string): Promise<JobRow | null> {
  const { data, error } = await admin.from('crm_portal_jobs').select(JOB_SELECT).eq('quote_id', quoteId).maybeSingle();
  if (error) throw new Error(`Jobbet gick inte att läsa: ${error.message}`);
  return (data as JobRow | null) ?? null;
}

async function readCustomer(admin: SupabaseClient, column: 'id' | 'fortnox_customer_id', value: string | null): Promise<JobCustomerCard | null> {
  if (!value) return null;
  const { data, error } = await admin.from('crm_customers').select(JOB_CUSTOMER_SELECT).eq(column, value).maybeSingle();
  if (error) throw new Error(`Butikens kundkort gick inte att läsa: ${error.message}`);
  return (data as JobCustomerCard | null) ?? null;
}

type ResellerLinkRow = { customer_id: string | null; customer_linked_at: string | null };

async function readResellerLink(admin: SupabaseClient, resellerId: string): Promise<ResellerLinkRow | null> {
  const { data, error } = await admin
    .from('crm_portal_resellers')
    .select('customer_id, customer_linked_at')
    .eq('reseller_id', resellerId)
    .maybeSingle();
  if (error) throw new Error(`Butiken gick inte att läsa: ${error.message}`);
  return (data as ResellerLinkRow | null) ?? null;
}

/** Kortet som kopplats för hand på butiken (fas 3c), eller null. Båda kolumnerna krävs: tas kortet bort nollas bara id:t. */
export function manualCustomerLink(row: ResellerLinkRow | null): string | null {
  return row?.customer_linked_at && row.customer_id ? row.customer_id : null;
}

/**
 * Vilket kundkort som gäller för butiken, och vad butikens rad ska få (William 2026-09-28):
 *   ett nummer som finns i CRM:et  det kortet, alltid; en koppling för hand ersätts
 *   inget nummer, eller ett okänt  kortet som kopplats för hand på butiken, om något; annars inget kort
 */
export type StoreCustomer =
  | { source: 'number'; customerId: string }
  | { source: 'manual'; customerId: string }
  | { source: 'none'; customerId: null };

export function resolveStoreCustomer(byNumberId: string | null, reseller: ResellerLinkRow | null): StoreCustomer {
  if (byNumberId) return { source: 'number', customerId: byNumberId };
  const manual = manualCustomerLink(reseller);
  return manual ? { source: 'manual', customerId: manual } : { source: 'none', customerId: null };
}

/**
 * Butiken dyker upp när den hör av sig (William 2026-09-28): namn, adress och kundnummer som portalen skickar, och
 * kundkortet som gäller. Säljaren (`seller_user_id`) rörs aldrig; den sätts på portalsidan. En koppling för hand rörs
 * inte när portalens nummer saknas eller är okänt, och ersätts av ett nummer som finns i CRM:et.
 */
async function upsertReseller(admin: SupabaseClient, job: PortalJob, storeCustomer: StoreCustomer, now: Date) {
  const { store } = job;
  const link =
    storeCustomer.source === 'manual'
      ? {}
      : { customer_id: storeCustomer.customerId, customer_linked_by: null, customer_linked_at: null };
  const { error } = await admin.from('crm_portal_resellers').upsert(
    {
      reseller_id: store.resellerId,
      name: store.name,
      street: store.address.street,
      postal_code: store.address.postalCode,
      city: store.address.city,
      customer_number: store.ekovillaCustomerNumber,
      ...link,
      last_seen_at: now.toISOString(),
    },
    { onConflict: 'reseller_id' },
  );
  if (error) throw new Error(`Butiken kunde inte sparas: ${error.message}`);
}

async function assign(job: PortalJob, customerId: string | null, deps: JobIntakeDeps) {
  return deps.assign({
    resellerId: job.store.resellerId,
    customerId,
    workplace: { postalCode: job.workplace.address.postalCode, city: job.workplace.address.city },
  });
}

export async function receivePortalJob(
  admin: SupabaseClient,
  job: PortalJob,
  payload: unknown,
  deps: JobIntakeDeps = jobIntakeDeps(admin),
): Promise<ReceivePortalJobResult> {
  const [existingRow, byNumber, reseller] = await Promise.all([
    readJob(admin, job.quoteId),
    readCustomer(admin, 'fortnox_customer_id', job.store.ekovillaCustomerNumber),
    readResellerLink(admin, job.store.resellerId),
  ]);
  const storeCustomer = resolveStoreCustomer(byNumber?.id ?? null, reseller);
  const customer = storeCustomer.source === 'manual' ? await readCustomer(admin, 'id', storeCustomer.customerId) : byNumber;
  let row = existingRow;
  if (!row) {
    // Butiken uppdateras bara av ett NYTT jobb. En upprepning, ett nekat jobb eller ett sent omförsök av ett gammalt
    // hade annars skrivit tillbaka ett inaktuellt namn eller kundnummer, och kopplat loss butikens kundkort.
    // Före fördelningen (butikens säljare läses därifrån) och före jobbets rad (den pekar på butiken).
    await upsertReseller(admin, job, storeCustomer, deps.now());
    const assignment = await assign(job, customer?.id ?? null, deps);
    if (assignment.kind === 'none') return { kind: 'no_assignee', assignment };

    const inserted = await admin
      .from('crm_portal_jobs')
      .upsert(
        {
          quote_id: job.quoteId,
          quote_number: job.quoteNumber,
          reseller_id: job.store.resellerId,
          store_name: job.store.name,
          customer_id: customer?.id ?? null,
          assigned_to: assignment.userId,
          assignment_source: assignment.source,
          reserved_work_order_id: deps.newId(),
          payload,
          received_at: deps.now().toISOString(),
        },
        { onConflict: 'quote_id', ignoreDuplicates: true },
      )
      .select(JOB_SELECT);
    if (inserted.error) throw new Error(`Jobbet kunde inte sparas: ${inserted.error.message}`);
    // Tom = ett samtidigt anrop för samma jobb hann först. Då gäller dess rad.
    row = ((inserted.data ?? [])[0] as JobRow | undefined) ?? (await readJob(admin, job.quoteId));
    if (!row) throw new Error('Jobbet sparades men gick inte att läsa tillbaka.');
  }

  if (canonicalJson(row.payload) !== canonicalJson(payload)) return { kind: 'conflict' };
  if (row.work_order_id) return { kind: 'existing', workOrderId: row.work_order_id };
  if (row.work_order_created_at) return { kind: 'work_order_removed' };

  // Arbetsordern saknas: ny, eller ett tidigare försök föll innan den fanns. Kunden och den ansvariga är jobbets,
  // så att ett omförsök skapar samma order som det första hade gjort.
  let assigneeId = row.assigned_to;
  if (!assigneeId) {
    // Den som fick jobbet har tagits bort innan ordern hann skapas: fördela om, annars står jobbet still för alltid.
    const assignment = await assign(job, row.customer_id, deps);
    if (assignment.kind === 'none') return { kind: 'no_assignee', assignment };
    const reassigned = await admin
      .from('crm_portal_jobs')
      .update({ assigned_to: assignment.userId, assignment_source: assignment.source })
      .eq('quote_id', job.quoteId)
      .is('assigned_to', null)
      .select('assigned_to');
    if (reassigned.error) throw new Error(`Jobbet kunde inte fördelas om: ${reassigned.error.message}`);
    // Ett samtidigt omförsök hann först: dess val gäller, så att ordern och jobbet säger samma sak.
    assigneeId = ((reassigned.data ?? [])[0] as { assigned_to: string } | undefined)?.assigned_to
      ?? (await readJob(admin, job.quoteId))?.assigned_to
      ?? null;
    if (!assigneeId) throw new Error('Jobbet kunde inte fördelas om.');
  }
  const jobCustomer = customer?.id === row.customer_id ? customer : await readCustomer(admin, 'id', row.customer_id);
  await createWorkOrder(admin, job, row, jobCustomer, assigneeId, deps);
  return { kind: 'created', workOrderId: row.reserved_work_order_id };
}

async function createWorkOrder(
  admin: SupabaseClient,
  job: PortalJob,
  row: JobRow,
  customer: JobCustomerCard | null,
  assigneeId: string,
  deps: JobIntakeDeps,
) {
  const workOrderId = row.reserved_work_order_id;
  const numbers = [...new Set(job.lines.map((line) => line.articleNumber))];
  const register = new Map((await deps.registerArticles(numbers)).map((a) => [a.article_number, a]));
  const insert = buildPortalWorkOrderInsert({
    job,
    customer,
    register,
    workOrderId,
    // Ur det reserverade id:t och dagen jobbet kom, inte dagen ordern skapas: ett omförsök efter midnatt får samma nummer.
    orderNumber: buildWorkOrderNumber(workOrderId, new Date(row.received_at)),
    assigneeId,
    newId: deps.newId,
  });

  const created = await admin.from('crm_work_orders').insert(insert).select('id');
  if (created.error) {
    if (created.error.code !== '23505') throw new Error(`Arbetsordern kunde inte skapas: ${created.error.message}`);
    // Finns den redan, från ett försök som föll efter insert:en? Annars är det något annat som krockar.
    const existing = await admin.from('crm_work_orders').select('id').eq('id', workOrderId).maybeSingle();
    if (existing.error) throw new Error(`Arbetsordern gick inte att läsa: ${existing.error.message}`);
    if (!existing.data) throw new Error(`Arbetsordern kunde inte skapas: ${created.error.message}`);
  }

  const linked = await admin
    .from('crm_portal_jobs')
    .update({ work_order_id: workOrderId, work_order_created_at: deps.now().toISOString() })
    .eq('quote_id', job.quoteId)
    .is('work_order_id', null)
    .select('quote_id');
  if (linked.error) throw new Error(`Arbetsordern kunde inte kopplas till jobbet: ${linked.error.message}`);
  if ((linked.data ?? []).length === 0) {
    // Ett samtidigt anrop hann koppla den. Samma id (tabellens check), så det räcker att den är kopplad.
    const again = await readJob(admin, job.quoteId);
    if (again?.work_order_id !== workOrderId) throw new Error('Arbetsordern skapades men kunde inte kopplas till jobbet.');
  }
}

// ------------------------------------------------------------------------------------------------ efter svaret

export type FollowUpDeps = {
  push: (workOrderId: string) => Promise<PushOrderResult>;
  notify: (rows: ReturnType<typeof expandNotificationToRecipients>) => Promise<void>;
  now: () => Date;
};

export function followUpDeps(admin: SupabaseClient): FollowUpDeps {
  return {
    push: pushWorkOrderToFortnox,
    notify: async (rows) => {
      const { error } = await deliverNotifications(admin, rows);
      if (error) throw new Error(error.message);
    },
    now: () => new Date(),
  };
}

export type FollowUpOutcome = {
  received: 'sent' | 'already_sent' | 'failed' | 'skipped';
  fortnox: 'exists' | 'created' | 'blocked' | 'failed' | 'in_progress' | 'skipped';
  reasons: string[];
};

type FollowUpWorkOrder = ReadinessQuoteSource & {
  id: string;
  assigned_to: string;
  project_name: string;
  fortnox_order_number: string | null;
};

type FollowUpJob = {
  quote_id: string;
  store_name: string;
  payload: unknown;
  work_order_id: string | null;
};

type NotifiedColumn = 'received_notified_at' | 'fortnox_issue_notified_at';

/** Tar notisen: sätter tiden där den var null. Bara den som satte den skickar. */
async function claimNotification(admin: SupabaseClient, quoteId: string, column: NotifiedColumn, at: string): Promise<boolean> {
  const { data, error } = await admin
    .from('crm_portal_jobs')
    .update({ [column]: at })
    .eq('quote_id', quoteId)
    .is(column, null)
    .select('quote_id');
  if (error) throw new Error(`Notisen kunde inte tas: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Släpper notisen efter ett misslyckat utskick, så att nästa försök skickar den. Bara vår egen tid. */
async function releaseNotification(admin: SupabaseClient, quoteId: string, column: NotifiedColumn, at: string) {
  const { error } = await admin.from('crm_portal_jobs').update({ [column]: null }).eq('quote_id', quoteId).eq(column, at);
  if (error) console.error('[portal-jobs] notisen kunde inte släppas', { quoteId, column, error: error.message });
}

async function sendOnce(
  admin: SupabaseClient,
  deps: FollowUpDeps,
  quoteId: string,
  column: NotifiedColumn,
  recipient: string,
  content: NotificationContent,
): Promise<'sent' | 'already_sent' | 'failed'> {
  const at = deps.now().toISOString();
  if (!(await claimNotification(admin, quoteId, column, at))) return 'already_sent';
  try {
    await deps.notify(expandNotificationToRecipients(content, [recipient]));
    return 'sent';
  } catch (e) {
    console.error('[portal-jobs] notisen kunde inte skickas', { quoteId, column, error: e instanceof Error ? e.message : String(e) });
    await releaseNotification(admin, quoteId, column, at);
    return 'failed';
  }
}

/**
 * Notisen "Nytt jobb" till den som har arbetsordern, sedan Fortnox-ordern. Stoppar kontrollerna, eller svarar Fortnox
 * fel, får samma person en andra notis med orsaken (William 2026-09-28). Ett försök; omförsöken kommer i fas 4b.
 *
 * Kastar bara när databasen inte svarar. Allt annat blir ett utfall, som anroparen loggar.
 */
export async function followUpPortalJob(
  admin: SupabaseClient,
  quoteId: string,
  deps: FollowUpDeps = followUpDeps(admin),
): Promise<FollowUpOutcome> {
  const jobRead = await admin
    .from('crm_portal_jobs')
    .select('quote_id, store_name, payload, work_order_id')
    .eq('quote_id', quoteId)
    .maybeSingle();
  if (jobRead.error) throw new Error(`Jobbet gick inte att läsa: ${jobRead.error.message}`);
  const job = jobRead.data as FollowUpJob | null;
  if (!job?.work_order_id) return { received: 'skipped', fortnox: 'skipped', reasons: [] };

  const woRead = await admin
    .from('crm_work_orders')
    .select('id, assigned_to, project_name, customer_id, quote_type, customer_snapshot, rot_details, line_items, internal_handoff, fortnox_order_number')
    .eq('id', job.work_order_id)
    .maybeSingle();
  if (woRead.error) throw new Error(`Arbetsordern gick inte att läsa: ${woRead.error.message}`);
  const workOrder = woRead.data as FollowUpWorkOrder | null;
  if (!workOrder) return { received: 'skipped', fortnox: 'skipped', reasons: [] };

  // Kroppen prövades när den togs emot. Här behövs bara perioden och kundnumret, till notisernas text.
  const body = (job.payload ?? {}) as { workplace?: { desiredPeriod?: unknown }; store?: { ekovillaCustomerNumber?: unknown } };
  const desiredPeriod = typeof body.workplace?.desiredPeriod === 'string' ? body.workplace.desiredPeriod : '';
  const customerNumber = typeof body.store?.ekovillaCustomerNumber === 'string' ? body.store.ekovillaCustomerNumber : null;

  const received = await sendOnce(
    admin,
    deps,
    quoteId,
    'received_notified_at',
    workOrder.assigned_to,
    buildPortalJobReceivedNotification({
      workOrderId: workOrder.id,
      storeName: job.store_name,
      // Titeln är arbetsplatsens adress (jobIntake.ts), samma sträng som i listorna.
      place: workOrder.project_name,
      desiredPeriod,
      needsDensity: workOrderLinesNeedDensity(workOrder.line_items),
    }),
  );

  if (workOrder.fortnox_order_number) return { received, fortnox: 'exists', reasons: [] };

  // Samma kontroll som våra egna ordrar, mot kundkortet som det ser ut nu.
  const { customer, error: customerError } = await fetchReadinessCustomer(admin, workOrder.customer_id ?? null);
  if (customerError) throw new Error(`Kundkortet gick inte att läsa: ${customerError.message}`);
  const readiness = evaluateWorkOrderReadiness(workOrder, customer);

  let fortnox: FollowUpOutcome['fortnox'];
  let reasons: string[] = [];
  if (!readiness.ready) {
    fortnox = 'blocked';
    reasons = portalFortnoxBlockerReasons(readiness.blockers, customerNumber);
  } else {
    try {
      const pushed = await deps.push(workOrder.id);
      fortnox = 'created';
      if (pushed.mirrorFailed) reasons = ['Fortnox-ordern skapades, men en ändring som sparades under tiden kom inte med.'];
    } catch (e) {
      // En annan push pågår redan: den får sitt eget utfall.
      if (e instanceof FortnoxPushInProgressError) return { received, fortnox: 'in_progress', reasons: [] };
      fortnox = 'failed';
      reasons = [e instanceof FortnoxNotConnectedError ? 'Fortnox är inte anslutet.' : `Fortnox svarade: ${friendlyFortnoxMessage(e)}`];
      console.error('[portal-jobs] Fortnox-ordern kunde inte skapas', { quoteId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (reasons.length > 0) {
    await sendOnce(
      admin,
      deps,
      quoteId,
      'fortnox_issue_notified_at',
      workOrder.assigned_to,
      buildPortalJobFortnoxIssueNotification({
        workOrderId: workOrder.id,
        storeName: job.store_name,
        reasons,
        created: fortnox === 'created',
      }),
    );
  }
  return { received, fortnox, reasons };
}
