import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverNotifications } from '@/lib/domains/notifications/delivery';
import { expandNotificationToRecipients } from '@/lib/domains/notifications/mutations';
import { buildStoreOrderNotification } from '@/lib/domains/notifications/payload';
import { portalAssignmentDeps, resolvePortalAssignee, type PortalAssignment } from './assignment';
import { canonicalJson } from './canonicalJson';
import { readResellerLink, resolveStoreCustomer, upsertPortalReseller } from './jobIntakeStore';
import {
  decideStoreOrderChange,
  decideStoreOrderWithdraw,
  type PortalStoreOrder,
  type PortalStoreOrderChange,
  type StoreOrderDecisionRow,
} from './storeOrderIntake';
import { decideStoreOrderNotice, storeOrderSummary, type StoreOrderBody, type StoreOrderStatus } from './storeOrders';

/**
 * Butiksbeställningarnas intag mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 8, kontraktets "Flöde 3"): ny, ändrad och
 * tillbakadragen, och notisen till den ansvarige.
 *
 * SERVICE-ROLLEN: anropen från portalen har ingen användare bakom sig (se "Reviewed elevations" i
 * SUPABASE_CONVENTIONS.md). Grinden är signaturen och svarscachen i routerna.
 *
 * Idempotent på affärsnyckeln, orderId, utöver svarscachen:
 *   - En ny beställning sparas en gång (unik order_id). Samma orderId igen ger den befintliga om den första kroppen är
 *     densamma, annars en konflikt.
 *   - En ändring sparas med villkoren i UPDATE:en: mottagen, och samma version som lästes. En samtidig ändring eller en
 *     bekräftelse som hann före gör att den läses om och prövas igen. Vakten i databasen (crm_store_orders_guard) nekar
 *     dessutom varje ändring av innehållet efter bekräftelsen, hur koden än ser ut.
 *   - Notisen skickas med ett lån (notify_claimed_at, fem minuter) och bokförs (notified_key) först när den gått iväg.
 *     Faller utskicket släpps lånet, och dör processen går det ut. Cron gör om den i båda fallen.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

export type StoreOrderIntakeDeps = {
  assign: (input: { resellerId: string; customerId: string | null }) => Promise<PortalAssignment>;
  profileName: (userId: string) => Promise<string | null>;
  now: () => Date;
};

/** Den ansvariges namn när beställningen kom: profiles är bara självläsbar, så sidan kan inte slå upp det. */
async function readProfileName(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Den ansvariges namn gick inte att läsa: ${error.message}`);
  const name = (data as { full_name?: string | null } | null)?.full_name?.trim();
  return name ? name : null;
}

export function storeOrderIntakeDeps(admin: SupabaseClient): StoreOrderIntakeDeps {
  return {
    // Som jobben, utan länet: leveransen går till butiken (kontraktet). Steget svarar alltid null, så Nominatim anropas
    // aldrig och länets regel läses aldrig.
    assign: ({ resellerId, customerId }) =>
      resolvePortalAssignee({
        ...portalAssignmentDeps(admin, { resellerId, customerId, workplace: { postalCode: '', city: '' } }),
        county: async () => null,
      }),
    profileName: (userId) => readProfileName(admin, userId),
    now: () => new Date(),
  };
}

type IntakeRow = { id: string; intake_payload: unknown };

async function readIntakeRow(admin: SupabaseClient, orderId: string): Promise<IntakeRow | null> {
  const { data, error } = await admin.from('crm_store_orders').select('id, intake_payload').eq('order_id', orderId).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as IntakeRow | null) ?? null;
}

async function customerIdByNumber(admin: SupabaseClient, customerNumber: string | null): Promise<string | null> {
  if (!customerNumber) return null;
  const { data, error } = await admin.from('crm_customers').select('id').eq('fortnox_customer_id', customerNumber).maybeSingle();
  if (error) throw new Error(`Butikens kundkort gick inte att läsa: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

export type ReceiveStoreOrderResult =
  | { kind: 'created'; id: string }
  /** Beställningen fanns redan, med samma första kropp. */
  | { kind: 'existing'; id: string }
  /** Beställningen fanns redan, med en annan första kropp. */
  | { kind: 'conflict' }
  /** Ingen i fördelningen kan ta beställningen. Den tas inte emot än, som ett jobb (William 2026-09-28). */
  | { kind: 'no_assignee'; assignment: Extract<PortalAssignment, { kind: 'none' }> };

const sameIntake = (row: IntakeRow, payload: unknown) => canonicalJson(row.intake_payload) === canonicalJson(payload);

export async function receiveStoreOrder(
  admin: SupabaseClient,
  order: PortalStoreOrder,
  payload: unknown,
  deps: StoreOrderIntakeDeps = storeOrderIntakeDeps(admin),
): Promise<ReceiveStoreOrderResult> {
  const existing = await readIntakeRow(admin, order.orderId);
  if (existing) return sameIntake(existing, payload) ? { kind: 'existing', id: existing.id } : { kind: 'conflict' };

  const [byNumber, reseller] = await Promise.all([
    customerIdByNumber(admin, order.store.ekovillaCustomerNumber),
    readResellerLink(admin, order.store.resellerId),
  ]);
  const storeCustomer = resolveStoreCustomer(byNumber, reseller);
  // Butiken uppdateras bara av en NY beställning, som av ett nytt jobb: en upprepning eller ett sent omförsök hade
  // annars skrivit tillbaka ett inaktuellt namn eller kundnummer. Före fördelningen, som läser butikens säljare.
  await upsertPortalReseller(admin, order.store, storeCustomer, deps.now());
  const assignment = await deps.assign({ resellerId: order.store.resellerId, customerId: storeCustomer.customerId });
  if (assignment.kind === 'none') return { kind: 'no_assignee', assignment };
  if (assignment.source === 'county') throw new Error('Fördelningen gav länet, som beställningarna inte har.');

  const inserted = await admin
    .from('crm_store_orders')
    .upsert(
      {
        order_id: order.orderId,
        order_number: order.orderNumber,
        reseller_id: order.store.resellerId,
        store_name: order.store.name,
        customer_id: storeCustomer.customerId,
        assigned_to: assignment.userId,
        assigned_to_name: await deps.profileName(assignment.userId),
        assignment_source: assignment.source,
        // Den första kroppen som den kom, för jämförelsen med en upprepning; den tolkade (trimmad, tom sträng som null)
        // är den som visas och blir Fortnox-ordern.
        intake_payload: payload,
        payload: order,
        received_at: deps.now().toISOString(),
      },
      { onConflict: 'order_id', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) throw new Error(`Beställningen kunde inte sparas: ${inserted.error.message}`);
  const created = (inserted.data ?? [])[0] as { id: string } | undefined;
  if (created) return { kind: 'created', id: created.id };

  // Tom = ett samtidigt anrop för samma beställning hann först. Då gäller dess rad.
  const again = await readIntakeRow(admin, order.orderId);
  if (!again) throw new Error('Beställningen sparades men gick inte att läsa tillbaka.');
  return sameIntake(again, payload) ? { kind: 'existing', id: again.id } : { kind: 'conflict' };
}

// ------------------------------------------------------------------------------------------ ändrad och tillbakadragen

type DecisionRow = StoreOrderDecisionRow & { id: string; store_version: number };

const DECISION_SELECT = 'id, status, reseller_id, order_number, portal_updated_at, store_version';

async function readDecisionRow(admin: SupabaseClient, orderId: string): Promise<DecisionRow | null> {
  const { data, error } = await admin.from('crm_store_orders').select(DECISION_SELECT).eq('order_id', orderId).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as DecisionRow | null) ?? null;
}

/** Hur många gånger en ändring läses om när en samtidig skrivning hann före. */
const MAX_ATTEMPTS = 3;

export type ChangeStoreOrderResult =
  | { kind: 'updated'; id: string }
  | { kind: 'ignored'; id: string }
  | { kind: 'confirmed'; id: string }
  | { kind: 'mismatch'; field: string }
  | { kind: 'unknown_order' };

export async function changeStoreOrder(
  admin: SupabaseClient,
  change: PortalStoreOrderChange,
  now: () => Date = () => new Date(),
): Promise<ChangeStoreOrderResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await readDecisionRow(admin, change.orderId);
    if (!row) return { kind: 'unknown_order' };
    const decision = decideStoreOrderChange(row, {
      resellerId: change.store.resellerId,
      orderNumber: change.orderNumber,
      updatedAt: change.updatedAt,
    });
    if (decision.kind === 'mismatch') return { kind: 'mismatch', field: decision.field };
    if (decision.kind !== 'apply') return { kind: decision.kind, id: row.id };

    // Bara om den fortfarande är mottagen och har versionen vi prövade mot: annars hann en ändring eller en
    // bekräftelse före, och beslutet tas om på det som står nu.
    const saved = await admin
      .from('crm_store_orders')
      .update({
        payload: change,
        store_version: row.store_version + 1,
        portal_updated_at: change.updatedAt,
        changed_at: now().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'received')
      .eq('store_version', row.store_version)
      .select('id');
    if (saved.error) throw new Error(`Ändringen kunde inte sparas: ${saved.error.message}`);
    if ((saved.data ?? []).length > 0) return { kind: 'updated', id: row.id };
  }
  throw new Error('Beställningen ändrades samtidigt av andra flera gånger. Försök igen.');
}

export type WithdrawStoreOrderResult =
  | { kind: 'withdrawn'; id: string }
  | { kind: 'ignored'; id: string }
  | { kind: 'confirmed'; id: string }
  | { kind: 'unknown_order' };

export async function withdrawStoreOrder(
  admin: SupabaseClient,
  orderId: string,
  now: () => Date = () => new Date(),
): Promise<WithdrawStoreOrderResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await readDecisionRow(admin, orderId);
    if (!row) return { kind: 'unknown_order' };
    const decision = decideStoreOrderWithdraw(row);
    if (decision.kind !== 'apply') return { kind: decision.kind, id: row.id };

    const saved = await admin
      .from('crm_store_orders')
      .update({ status: 'withdrawn', withdrawn_at: now().toISOString() })
      .eq('id', row.id)
      .eq('status', 'received')
      .select('id');
    if (saved.error) throw new Error(`Tillbakadragningen kunde inte sparas: ${saved.error.message}`);
    if ((saved.data ?? []).length > 0) return { kind: 'withdrawn', id: row.id };
  }
  throw new Error('Beställningen ändrades samtidigt av andra flera gånger. Försök igen.');
}

// ------------------------------------------------------------------------------------------------------------ notisen

/** Hur länge ett utskick av notisen håller beställningen innan nästa försök får ta den. */
export const STORE_ORDER_NOTICE_LEASE_MS = 5 * 60_000;

export type StoreOrderNoticeDeps = {
  notify: (rows: ReturnType<typeof expandNotificationToRecipients>) => Promise<void>;
  now: () => Date;
};

export function storeOrderNoticeDeps(admin: SupabaseClient): StoreOrderNoticeDeps {
  return {
    notify: async (rows) => {
      const { error } = await deliverNotifications(admin, rows);
      if (error) throw new Error(error.message);
    },
    now: () => new Date(),
  };
}

type NoticeRow = {
  id: string;
  order_number: string;
  store_name: string;
  status: StoreOrderStatus;
  store_version: number;
  notified_key: string | null;
  notify_claimed_at: string | null;
  assigned_to: string | null;
  payload: StoreOrderBody;
};

const NOTICE_SELECT = 'id, order_number, store_name, status, store_version, notified_key, notify_claimed_at, assigned_to, payload';

async function readNoticeRow(admin: SupabaseClient, id: string): Promise<NoticeRow | null> {
  const { data, error } = await admin.from('crm_store_orders').select(NOTICE_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Beställningen gick inte att läsa: ${error.message}`);
  return (data as NoticeRow | null) ?? null;
}

/**
 * Tar lånet: där inget finns, eller där det gått ut. Två villkorade UPDATE:ar, eftersom PostgREST inte tar ett or() på
 * en ändring (samma skäl som claimFortnoxPush). Var och en är atomär: av två samtidiga tar bara en raden.
 */
async function claimNotice(admin: SupabaseClient, id: string, now: Date): Promise<string | null> {
  const stamp = now.toISOString();
  const free = await admin.from('crm_store_orders').update({ notify_claimed_at: stamp }).eq('id', id).is('notify_claimed_at', null).select('id');
  if (free.error) throw new Error(`Notisen kunde inte tas: ${free.error.message}`);
  if ((free.data ?? []).length > 0) return stamp;
  const expired = await admin
    .from('crm_store_orders')
    .update({ notify_claimed_at: stamp })
    .eq('id', id)
    .lt('notify_claimed_at', new Date(now.getTime() - STORE_ORDER_NOTICE_LEASE_MS).toISOString())
    .select('id');
  if (expired.error) throw new Error(`Notisen kunde inte tas: ${expired.error.message}`);
  return (expired.data ?? []).length > 0 ? stamp : null;
}

/** Lämnar lånet, och bokför notisen när en sådan ges. Bara vårt eget lån. */
async function finishNotice(admin: SupabaseClient, id: string, stamp: string, notifiedKey?: string): Promise<boolean> {
  const values: Record<string, unknown> = { notify_claimed_at: null };
  if (notifiedKey !== undefined) values.notified_key = notifiedKey;
  const { data, error } = await admin
    .from('crm_store_orders')
    .update(values)
    .eq('id', id)
    .eq('notify_claimed_at', stamp)
    .select('id');
  if (error) throw new Error(`Notisen kunde inte bokföras: ${error.message}`);
  return (data ?? []).length > 0;
}

async function readFallbackUser(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from('crm_portal_settings').select('fallback_user_id').eq('id', true).maybeSingle();
  if (error) throw new Error(`Reserven gick inte att läsa: ${error.message}`);
  return (data as { fallback_user_id?: string | null } | null)?.fallback_user_id ?? null;
}

export type StoreOrderNoticeOutcome = 'sent' | 'marked' | 'none' | 'busy' | 'no_recipient' | 'failed';

/**
 * Notisen den ansvarige ska ha för beställningen som den står nu (`decideStoreOrderNotice`): ny, ändrad eller
 * tillbakadragen, till den ansvarige och annars reserven. Beslutet tas om efter lånet, på raden som den står då: en
 * ändring som kom under tiden får sin notis nu, inte en gammal. Kastar bara när databasen inte svarar.
 */
export async function notifyStoreOrder(
  admin: SupabaseClient,
  id: string,
  deps: StoreOrderNoticeDeps = storeOrderNoticeDeps(admin),
): Promise<StoreOrderNoticeOutcome> {
  const before = await readNoticeRow(admin, id);
  if (!before || !decideStoreOrderNotice(before)) return 'none';

  const stamp = await claimNotice(admin, id, deps.now());
  if (!stamp) return 'busy';

  const row = await readNoticeRow(admin, id);
  const decision = row ? decideStoreOrderNotice(row) : null;
  if (!row || !decision) {
    await finishNotice(admin, id, stamp);
    return 'none';
  }
  if (decision.kind === null) {
    await finishNotice(admin, id, stamp, decision.key);
    return 'marked';
  }

  const recipient = row.assigned_to ?? (await readFallbackUser(admin));
  if (!recipient) {
    console.error('[portal-store-orders] ingen att meddela: varken ansvarig eller reserv', { id });
    await finishNotice(admin, id, stamp);
    return 'no_recipient';
  }

  try {
    await deps.notify(
      expandNotificationToRecipients(
        buildStoreOrderNotification({
          storeOrderId: row.id,
          kind: decision.kind,
          storeName: row.store_name,
          orderNumber: row.order_number,
          summary: storeOrderSummary(row.payload),
        }),
        [recipient],
      ),
    );
  } catch (e) {
    console.error('[portal-store-orders] notisen kunde inte skickas', { id, error: e instanceof Error ? e.message : String(e) });
    await finishNotice(admin, id, stamp).catch((err) =>
      console.error('[portal-store-orders] lånet kunde inte släppas', { id, error: err instanceof Error ? err.message : String(err) }),
    );
    return 'failed';
  }
  // Tog någon över lånet (fem minuter gick) har den kanske skickat samma notis: en dubblett, hellre än en som tappas.
  if (!(await finishNotice(admin, id, stamp, decision.key))) {
    console.warn('[portal-store-orders] notisen skickades, men lånet var inte längre vårt', { id });
  }
  return 'sent';
}

// ------------------------------------------------------------------------------------------------------------- cron

/** En notis görs om av cron först när den legat så här länge: den direkt efter svaret ska hinna först. */
export const STORE_ORDER_NOTICE_SWEEP_AFTER_MS = 2 * 60_000;
/** Så långt bakåt cron letar efter en tillbakadragning som inte meddelats. */
export const STORE_ORDER_NOTICE_WINDOW_MS = 14 * 24 * 3600_000;
/** Notiser per varv. */
export const STORE_ORDER_NOTICES_PER_ROUND = 20;

type SweepRow = NoticeRow & { received_at: string; changed_at: string | null; withdrawn_at: string | null };

export type StoreOrderNoticeSweepSummary = { candidates: number; sent: number; marked: number; failed: number; errors: number };

/**
 * Notiserna som inte gick iväg: en mottagen beställning vars senaste version ingen fått veta om, eller en
 * tillbakadragning de senaste två veckorna. Ett lån som ännu gäller tar ingen plats i omgången. Ett fel för en
 * beställning stoppar inte nästa.
 */
export async function sweepStoreOrderNotices(
  admin: SupabaseClient,
  options: { now?: () => Date; deps?: StoreOrderNoticeDeps } = {},
): Promise<StoreOrderNoticeSweepSummary> {
  const now = options.now ?? (() => new Date());
  const deps = options.deps ?? { ...storeOrderNoticeDeps(admin), now };
  const at = now().getTime();
  const select = `${NOTICE_SELECT}, received_at, changed_at, withdrawn_at`;

  const [received, withdrawn] = await Promise.all([
    admin.from('crm_store_orders').select(select).eq('status', 'received').order('received_at', { ascending: true }).limit(500),
    admin
      .from('crm_store_orders')
      .select(select)
      .eq('status', 'withdrawn')
      .gt('withdrawn_at', new Date(at - STORE_ORDER_NOTICE_WINDOW_MS).toISOString())
      .order('withdrawn_at', { ascending: true })
      .limit(500),
  ]);
  if (received.error) throw new Error(`Beställningarna gick inte att läsa: ${received.error.message}`);
  if (withdrawn.error) throw new Error(`Beställningarna gick inte att läsa: ${withdrawn.error.message}`);

  const due = ([...(received.data ?? []), ...(withdrawn.data ?? [])] as SweepRow[]).filter((row) => {
    if (!decideStoreOrderNotice(row)) return false;
    const touched = Date.parse(row.withdrawn_at ?? row.changed_at ?? row.received_at);
    if (at - touched < STORE_ORDER_NOTICE_SWEEP_AFTER_MS) return false;
    return !row.notify_claimed_at || at - Date.parse(row.notify_claimed_at) >= STORE_ORDER_NOTICE_LEASE_MS;
  });

  const summary: StoreOrderNoticeSweepSummary = { candidates: due.length, sent: 0, marked: 0, failed: 0, errors: 0 };
  for (const row of due.slice(0, STORE_ORDER_NOTICES_PER_ROUND)) {
    try {
      const outcome = await notifyStoreOrder(admin, row.id, deps);
      if (outcome === 'sent') summary.sent += 1;
      else if (outcome === 'marked') summary.marked += 1;
      else if (outcome === 'failed' || outcome === 'no_recipient') summary.failed += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-store-orders] notisen kunde inte göras om', { id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
