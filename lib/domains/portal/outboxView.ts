import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxEventStatus } from './outbox';
import { PORTAL_JOB_QUEUE_PREFIX } from './jobState';
import { RESELLER_INVITE_QUEUE_PREFIX } from './partners';
import { STORE_ORDER_QUEUE_PREFIX } from './storeOrderState';

/**
 * Fliken "Utskick" på portalsidan (fas 4b, William 2026-09-28): det som väntar i kön och det som gavs upp, med felet.
 * Sessionsklienten: kön och jobbens kolumner här är läsbara för crm.portal.manage (policyn på portal_outbound_events;
 * quote_id, quote_number och store_name på crm_portal_jobs), butiksbeställningarnas för crm.access (fas 8b3; id,
 * order_id, order_number och store_name på crm_store_orders). Inget skrivs härifrån; "Skicka om" går genom
 * requeueDeadPortalEvent med service-rollen.
 */

export type PortalOutboxEventKind =
  | 'pricelist'
  | 'job.confirmed'
  | 'job.scheduled'
  | 'job.completed'
  | 'job.invoiced'
  | 'job.cancelled'
  | 'job.message'
  | 'job.document'
  | 'store_order.confirmed'
  | 'store_order.delivered'
  | 'store_order.invoiced'
  | 'store_order.cancelled'
  | 'reseller.invite'
  | 'other';

export type PortalOutboxItem = {
  id: string;
  kind: PortalOutboxEventKind;
  /** Det butiken ser, i korthet: "Planerad 12–14 okt." hör hemma i sidan; här datumen som de skickas. */
  detail: string | null;
  status: OutboxEventStatus;
  attempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string | null;
  job: { quoteId: string; quoteNumber: string | null; storeName: string | null; workOrderId: string | null } | null;
  /** Butiksbeställningen (fas 8b3). id = CRM:ets, null när raden inte kunde läsas. */
  storeOrder: { orderId: string; id: string | null; orderNumber: string | null; storeName: string | null } | null;
  /** Uppgiven och den senaste för sin nyckel: kan skickas om (se requeueDeadPortalEvent). */
  canRetry: boolean;
};

const SELECT =
  'id, seq, idempotency_key, payload, ordering_key, status, attempts, last_http_status, last_error, created_at, next_attempt_at';

type EventRow = {
  id: string;
  seq: number;
  idempotency_key: string;
  payload: unknown;
  ordering_key: string;
  status: OutboxEventStatus;
  attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string;
};

const EVENT_TYPES = new Set([
  'job.confirmed',
  'job.scheduled',
  'job.completed',
  'job.invoiced',
  'job.cancelled',
  'job.message',
  'job.document',
  'store_order.confirmed',
  'store_order.delivered',
  'store_order.invoiced',
  'store_order.cancelled',
]);

const JOB_QUEUE = PORTAL_JOB_QUEUE_PREFIX;
const STORE_ORDER_QUEUE = STORE_ORDER_QUEUE_PREFIX;

/**
 * Skälet till en makulering kan vara 2000 tecken; raden visar början. Räknat i grafem (det läsaren ser som ett tecken),
 * så att varken ett emoji, en flagga eller en sammansatt emoji (👨‍👩‍👧) delas.
 */
const REASON_PREVIEW = 80;
const graphemes = new Intl.Segmenter('sv', { granularity: 'grapheme' });

export function portalOutboxEventKind(orderingKey: string, payload: unknown): PortalOutboxEventKind {
  // En butiks egen lista har butikens ordning, `pricelist:<id>` (10b2).
  if (orderingKey === 'pricelist' || orderingKey.startsWith('pricelist:')) return 'pricelist';
  // Inbjudan har ingen typ i kroppen: kroppen är hela företaget (flöde 5).
  if (orderingKey.startsWith(RESELLER_INVITE_QUEUE_PREFIX)) return 'reseller.invite';
  const type = (payload as { type?: unknown } | null)?.type;
  return typeof type === 'string' && EVENT_TYPES.has(type) ? (type as PortalOutboxEventKind) : 'other';
}

/** Det viktigaste ur kroppen, som text. Ren. */
export function portalOutboxEventDetail(kind: PortalOutboxEventKind, payload: unknown): string | null {
  const body = (payload ?? {}) as { data?: Record<string, unknown>; validFrom?: unknown; articles?: unknown; resellerId?: unknown };
  const data = body.data ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  switch (kind) {
    case 'job.confirmed':
    case 'store_order.confirmed':
      return str(data.ekovillaOrderNumber) ? `Order ${data.ekovillaOrderNumber}` : null;
    case 'store_order.delivered':
      return str(data.deliveredAt);
    case 'store_order.invoiced':
      return str(data.invoicedAt);
    case 'store_order.cancelled': {
      const reason = str(data.reason);
      if (!reason) return null;
      const chars = Array.from(graphemes.segment(reason), (g) => g.segment);
      return chars.length > REASON_PREVIEW ? `${chars.slice(0, REASON_PREVIEW - 1).join('')}…` : reason;
    }
    case 'job.scheduled': {
      const from = str(data.scheduledFor);
      const until = str(data.scheduledUntil);
      if (!from) return 'Inte längre planerad';
      return until && until !== from ? `${from} – ${until}` : from;
    }
    case 'job.completed':
      return str(data.completedAt);
    case 'job.invoiced':
      return str(data.invoicedAt);
    case 'job.message':
      return str(data.authorName);
    case 'job.document':
      // Kroppen i kön bär filnamnet och en referens till filen, aldrig innehållet (jobDocuments.ts).
      return str(data.name);
    case 'pricelist': {
      const from = str(body.validFrom) ? `Giltig från ${body.validFrom}` : null;
      return str(body.resellerId) ? [from, 'butikens egen lista'].filter(Boolean).join(', ') : from;
    }
    case 'reseller.invite': {
      const invite = (payload ?? {}) as { name?: unknown; admin?: { email?: unknown } };
      return [str(invite.name), str(invite.admin?.email)].filter(Boolean).join(' · ') || null;
    }
    default:
      return null;
  }
}

/**
 * Uppgivna och väntande, var för sig och nyast först: en lång kö av väntande (integrationen av, portalen nere) får aldrig
 * trycka ut en uppgiven, eftersom det är den som kräver en människa.
 */
export async function listPortalOutboxAttention(session: SupabaseClient, limit = 100): Promise<PortalOutboxItem[]> {
  const read = (statuses: OutboxEventStatus[]) =>
    session.from('portal_outbound_events').select(SELECT).in('status', statuses).order('seq', { ascending: false }).limit(limit);
  const [deadRead, waitingRead] = await Promise.all([read(['dead']), read(['pending', 'sending'])]);
  if (deadRead.error) throw new Error(`Kön gick inte att läsa: ${deadRead.error.message}`);
  if (waitingRead.error) throw new Error(`Kön gick inte att läsa: ${waitingRead.error.message}`);
  const rows = [...((deadRead.data ?? []) as EventRow[]), ...((waitingRead.data ?? []) as EventRow[])];
  if (rows.length === 0) return [];

  const idsIn = (prefix: string) =>
    [...new Set(rows.map((r) => r.ordering_key).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)))];
  const quoteIds = idsIn(JOB_QUEUE);
  const orderIds = idsIn(STORE_ORDER_QUEUE);
  const [jobsRead, storeOrdersRead] = await Promise.all([
    quoteIds.length > 0
      ? session.from('crm_portal_jobs').select('quote_id, quote_number, store_name, work_order_id').in('quote_id', quoteIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length > 0
      ? session.from('crm_store_orders').select('id, order_id, order_number, store_name').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (jobsRead.error) throw new Error(`Jobben gick inte att läsa: ${jobsRead.error.message}`);
  if (storeOrdersRead.error) throw new Error(`Butiksbeställningarna gick inte att läsa: ${storeOrdersRead.error.message}`);
  const jobs = new Map(
    ((jobsRead.data ?? []) as { quote_id: string; quote_number: string; store_name: string; work_order_id: string | null }[]).map(
      (j) => [j.quote_id, j],
    ),
  );
  const storeOrders = new Map(
    ((storeOrdersRead.data ?? []) as { id: string; order_id: string; order_number: string; store_name: string }[]).map((o) => [
      o.order_id,
      o,
    ]),
  );

  // Kan den skickas om? Samma regel som requeueDeadPortalEvent: inget senare för nyckeln, utom en ersatt planerad dag.
  // En fråga per uppgiven (få), inte en lista över allt senare, som hade kunnat kapas vid PostgRESTs tak.
  const retryable = new Map<string, boolean>();
  await Promise.all(
    rows
      .filter((r) => r.status === 'dead')
      .map(async (r) => {
        const later = await session
          .from('portal_outbound_events')
          .select('id')
          .eq('ordering_key', r.ordering_key)
          .in('status', ['pending', 'sending', 'sent', 'dead'])
          .gt('seq', r.seq)
          .limit(1);
        if (later.error) throw new Error(`Kön gick inte att läsa: ${later.error.message}`);
        retryable.set(r.id, (later.data ?? []).length === 0);
      }),
  );

  return rows.map((r) => {
    const kind = portalOutboxEventKind(r.ordering_key, r.payload);
    const quoteId = r.ordering_key.startsWith(JOB_QUEUE) ? r.ordering_key.slice(JOB_QUEUE.length) : null;
    const job = quoteId ? jobs.get(quoteId) : undefined;
    const orderId = r.ordering_key.startsWith(STORE_ORDER_QUEUE) ? r.ordering_key.slice(STORE_ORDER_QUEUE.length) : null;
    const storeOrder = orderId ? storeOrders.get(orderId) : undefined;
    return {
      id: r.id,
      kind,
      detail: portalOutboxEventDetail(kind, r.payload),
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      lastHttpStatus: r.last_http_status,
      createdAt: r.created_at,
      nextAttemptAt: r.status === 'pending' ? r.next_attempt_at : null,
      job: quoteId
        ? { quoteId, quoteNumber: job?.quote_number ?? null, storeName: job?.store_name ?? null, workOrderId: job?.work_order_id ?? null }
        : null,
      storeOrder: orderId
        ? { orderId, id: storeOrder?.id ?? null, orderNumber: storeOrder?.order_number ?? null, storeName: storeOrder?.store_name ?? null }
        : null,
      canRetry: retryable.get(r.id) ?? false,
    };
  });
}
