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

export async function listPortalOutboxAttention(session: SupabaseClient, limit = 100): Promise<PortalOutboxItem[]> {
  const { data, error } = await session
    .from('portal_outbound_events')
    .select(SELECT)
    .in('status', ['dead', 'pending', 'sending'])
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Kön gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as EventRow[];
  if (rows.length === 0) return [];

  const keys = [...new Set(rows.map((r) => r.ordering_key))];
  const quoteIds = keys.filter((k) => k.startsWith('job:')).map((k) => k.slice(4));
  const [jobsRead, laterRead] = await Promise.all([
    quoteIds.length > 0
      ? session.from('crm_portal_jobs').select('quote_id, quote_number, store_name, work_order_id').in('quote_id', quoteIds)
      : Promise.resolve({ data: [], error: null }),
    // Det senaste som gått iväg eller väntar, per nyckel: en uppgiven före den kan inte skickas om.
    session
      .from('portal_outbound_events')
      .select('ordering_key, seq')
      .in('ordering_key', keys)
      .in('status', ['pending', 'sending', 'sent'])
      .order('seq', { ascending: false }),
  ]);
  if (jobsRead.error) throw new Error(`Jobben gick inte att läsa: ${jobsRead.error.message}`);
  if (laterRead.error) throw new Error(`Kön gick inte att läsa: ${laterRead.error.message}`);

  const jobs = new Map(
    ((jobsRead.data ?? []) as { quote_id: string; quote_number: string; store_name: string; work_order_id: string | null }[]).map(
      (j) => [j.quote_id, j],
    ),
  );
  const latestLive = new Map<string, number>();
  for (const r of (laterRead.data ?? []) as { ordering_key: string; seq: number }[]) {
    if (!latestLive.has(r.ordering_key)) latestLive.set(r.ordering_key, Number(r.seq));
  }

  return rows.map((r) => {
    const kind = portalOutboxEventKind(r.ordering_key, r.payload);
    const quoteId = r.ordering_key.startsWith('job:') ? r.ordering_key.slice(4) : null;
    const job = quoteId ? jobs.get(quoteId) : undefined;
    const live = latestLive.get(r.ordering_key);
    return {
      id: r.id,
      kind,
      detail: portalOutboxEventDetail(kind, r.payload),
      status: r.status,
      attempts: r.attempts,
      lastHttpStatus: r.last_http_status,
      lastError: r.last_error,
      createdAt: r.created_at,
      nextAttemptAt: r.status === 'pending' ? r.next_attempt_at : null,
      job: quoteId
        ? { quoteId, quoteNumber: job?.quote_number ?? null, storeName: job?.store_name ?? null, workOrderId: job?.work_order_id ?? null }
        : null,
      canRetry: r.status === 'dead' && (live === undefined || live < Number(r.seq)),
    };
  });
}
