import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxEventStatus } from './outbox';

/**
 * Fliken "Utskick" på portalsidan (fas 4b, William 2026-09-28): det som väntar i kön och det som gavs upp, med felet.
 * Sessionsklienten: kön och jobbens kolumner här är läsbara för crm.portal.manage (policyn på portal_outbound_events;
 * quote_id, quote_number och store_name på crm_portal_jobs). Inget skrivs härifrån; "Skicka om" går genom
 * requeueDeadPortalEvent med service-rollen.
 */

export type PortalOutboxEventKind =
  | 'pricelist'
  | 'job.confirmed'
  | 'job.scheduled'
  | 'job.completed'
  | 'job.invoiced'
  | 'job.cancelled'
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

const JOB_TYPES = new Set(['job.confirmed', 'job.scheduled', 'job.completed', 'job.invoiced', 'job.cancelled']);

export function portalOutboxEventKind(orderingKey: string, payload: unknown): PortalOutboxEventKind {
  if (orderingKey === 'pricelist') return 'pricelist';
  const type = (payload as { type?: unknown } | null)?.type;
  return typeof type === 'string' && JOB_TYPES.has(type) ? (type as PortalOutboxEventKind) : 'other';
}

/** Det viktigaste ur kroppen, som text. Ren. */
export function portalOutboxEventDetail(kind: PortalOutboxEventKind, payload: unknown): string | null {
  const body = (payload ?? {}) as { data?: Record<string, unknown>; validFrom?: unknown; articles?: unknown };
  const data = body.data ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  switch (kind) {
    case 'job.confirmed':
      return str(data.ekovillaOrderNumber) ? `Order ${data.ekovillaOrderNumber}` : null;
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
    case 'pricelist':
      return str(body.validFrom) ? `Giltig från ${body.validFrom}` : null;
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

  const quoteIds = [...new Set(rows.map((r) => r.ordering_key).filter((k) => k.startsWith('job:')).map((k) => k.slice(4)))];
  const jobsRead =
    quoteIds.length > 0
      ? await session.from('crm_portal_jobs').select('quote_id, quote_number, store_name, work_order_id').in('quote_id', quoteIds)
      : { data: [], error: null };
  if (jobsRead.error) throw new Error(`Jobben gick inte att läsa: ${jobsRead.error.message}`);
  const jobs = new Map(
    ((jobsRead.data ?? []) as { quote_id: string; quote_number: string; store_name: string; work_order_id: string | null }[]).map(
      (j) => [j.quote_id, j],
    ),
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
    const quoteId = r.ordering_key.startsWith('job:') ? r.ordering_key.slice(4) : null;
    const job = quoteId ? jobs.get(quoteId) : undefined;
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
      canRetry: retryable.get(r.id) ?? false,
    };
  });
}
