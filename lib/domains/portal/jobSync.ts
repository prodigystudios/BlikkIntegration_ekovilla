import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueuePortalEvent } from './outbox';
import {
  PORTAL_EVENTS_PATH,
  derivePortalJobEvents,
  parsePortalJobSyncState,
  portalJobOrderingKey,
  type ConfirmedDelivery,
  type PortalJobEvent,
  type PortalJobWorkOrder,
} from './jobState';

/**
 * Statusen tillbaka till portalen, mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 4b). Databasen markerar jobbet
 * (crm_work_orders_mark_portal_job sätter sync_requested_at); här räknas de markerade jobben om och skillnaden köas.
 * Utskicket (outbox.ts) skickar kön.
 *
 * SERVICE-ROLLEN: crm_portal_jobs och kön är service-rollens (se "Reviewed elevations" i SUPABASE_CONVENTIONS.md).
 * Körs av cron-routen och av "Skicka väntande nu" på portalsidan.
 *
 * Ett jobb i tre steg, så att en krasch mitt i varken tappar eller dubblerar en händelse:
 *   1. Händelser som beslutats förra gången men kanske inte köats (sync_pending_events) köas. Kön är idempotent på
 *      nyckeln, så en som redan köats blir inte dubbel.
 *   2. Läget härleds (jobState.ts). Nya händelser sparas TILLSAMMANS med det nya läget, i en skrivning, och köas sedan.
 *   3. Markeringen nollas, bara om ingen ny ändring kommit under tiden och inget väntar (se `revisit` i jobState.ts).
 * sync_version är krockkontrollen: två körningar kan överlappa (en tar upp mot ~70 s), och den som kommer sist gör
 * ingenting.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om" läser tillbaka raderna.
 */

const JOB_SELECT = 'quote_id, work_order_id, work_order_created_at, sync_requested_at, sync_state, sync_pending_events, sync_version';
const WORK_ORDER_SELECT = 'status, fortnox_order_number, fortnox_order_synced_at, planned_start_day, planned_end_day, fortnox_invoiced_at';

type SyncJobRow = {
  quote_id: string;
  work_order_id: string | null;
  work_order_created_at: string | null;
  sync_requested_at: string | null;
  sync_state: unknown;
  sync_pending_events: unknown;
  sync_version: number;
};

export type PortalJobSyncSummary = { jobs: number; queued: number; unchanged: number; conflicts: number; errors: number };

type JobOutcome = 'queued' | 'unchanged' | 'conflict';

/** Läser sync_pending_events. En trasig post är ett programmeringsfel, och får inte tyst försvinna. */
export function parsePendingPortalEvents(raw: unknown): PortalJobEvent[] {
  if (!Array.isArray(raw)) throw new Error('sync_pending_events är inte en lista.');
  return raw.map((item, i) => {
    const e = item as Partial<PortalJobEvent> | null;
    if (
      !e ||
      typeof e.idempotencyKey !== 'string' ||
      !e.payload ||
      typeof e.payload !== 'object' ||
      typeof e.payload.type !== 'string' ||
      (e.supersedeKey !== null && typeof e.supersedeKey !== 'string')
    ) {
      throw new Error(`sync_pending_events[${i}] har fel form.`);
    }
    return e as PortalJobEvent;
  });
}

async function enqueueAll(admin: SupabaseClient, quoteId: string, events: PortalJobEvent[]) {
  // I ordning: kön skickar ett jobbs händelser i den ordning de köades.
  for (const e of events) {
    await enqueuePortalEvent(admin, {
      idempotencyKey: e.idempotencyKey,
      path: PORTAL_EVENTS_PATH,
      payload: e.payload,
      orderingKey: portalJobOrderingKey(quoteId),
      supersedeKey: e.supersedeKey,
    });
  }
}

async function readWorkOrder(admin: SupabaseClient, id: string | null): Promise<PortalJobWorkOrder | null> {
  if (!id) return null;
  const { data, error } = await admin.from('crm_work_orders').select(WORK_ORDER_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Arbetsordern gick inte att läsa: ${error.message}`);
  const row = data as {
    status: string;
    fortnox_order_number: string | null;
    fortnox_order_synced_at: string | null;
    planned_start_day: string | null;
    planned_end_day: string | null;
    fortnox_invoiced_at: string | null;
  } | null;
  if (!row) return null;
  return {
    status: row.status,
    fortnoxOrderNumber: row.fortnox_order_number,
    fortnoxOrderSyncedAt: row.fortnox_order_synced_at,
    plannedStartDay: row.planned_start_day,
    plannedEndDay: row.planned_end_day,
    fortnoxInvoicedAt: row.fortnox_invoiced_at,
  };
}

async function readConfirmedDelivery(admin: SupabaseClient, key: string | undefined): Promise<ConfirmedDelivery> {
  if (!key) return 'missing';
  const { data, error } = await admin.from('portal_outbound_events').select('status').eq('idempotency_key', key).maybeSingle();
  if (error) throw new Error(`Bekräftelsens status gick inte att läsa: ${error.message}`);
  const status = (data as { status: string } | null)?.status;
  if (status === 'sent') return 'sent';
  if (status === 'pending' || status === 'sending') return 'pending';
  return status ? 'dead' : 'missing';
}

async function syncOne(admin: SupabaseClient, row: SyncJobRow, now: Date): Promise<JobOutcome> {
  const quoteId = row.quote_id;
  let version = row.sync_version;

  // 1. Det som beslutades förra gången.
  const leftover = parsePendingPortalEvents(row.sync_pending_events);
  if (leftover.length > 0) {
    await enqueueAll(admin, quoteId, leftover);
    const cleared = await admin
      .from('crm_portal_jobs')
      .update({ sync_pending_events: [] })
      .eq('quote_id', quoteId)
      .eq('sync_version', version)
      .select('quote_id');
    if (cleared.error) throw new Error(`Jobbets köade händelser kunde inte bokföras: ${cleared.error.message}`);
    if ((cleared.data ?? []).length === 0) return 'conflict';
  }

  // 2. Läget nu.
  const state = parsePortalJobSyncState(row.sync_state);
  const [workOrder, confirmedDelivery] = await Promise.all([
    readWorkOrder(admin, row.work_order_id),
    readConfirmedDelivery(admin, state.confirmedKey),
  ]);
  const result = derivePortalJobEvents({
    quoteId,
    workOrderCreated: row.work_order_created_at !== null,
    workOrder,
    state,
    confirmedDelivery,
    now,
  });

  if (result.events.length > 0) {
    const saved = await admin
      .from('crm_portal_jobs')
      .update({
        sync_state: result.state,
        sync_pending_events: result.events,
        sync_version: version + 1,
        synced_at: now.toISOString(),
      })
      .eq('quote_id', quoteId)
      .eq('sync_version', version)
      .select('quote_id');
    if (saved.error) throw new Error(`Jobbets läge kunde inte sparas: ${saved.error.message}`);
    if ((saved.data ?? []).length === 0) return 'conflict';
    version += 1;

    await enqueueAll(admin, quoteId, result.events);
    const cleared = await admin
      .from('crm_portal_jobs')
      .update({ sync_pending_events: [] })
      .eq('quote_id', quoteId)
      .eq('sync_version', version)
      .select('quote_id');
    // Står de kvar köas de igen nästa gång, vilket inte gör något: kön känner igen nycklarna.
    if (cleared.error) throw new Error(`Jobbets köade händelser kunde inte bokföras: ${cleared.error.message}`);
  }

  // 3. Markeringen, bara om den står kvar som vi läste den. En ny ändring under tiden ger ett varv till.
  if (!result.revisit && row.sync_requested_at !== null) {
    const done = await admin
      .from('crm_portal_jobs')
      .update({ sync_requested_at: null, synced_at: now.toISOString() })
      .eq('quote_id', quoteId)
      .eq('sync_version', version)
      .eq('sync_requested_at', row.sync_requested_at)
      .select('quote_id');
    if (done.error) throw new Error(`Jobbets markering kunde inte nollas: ${done.error.message}`);
  }
  return result.events.length > 0 ? 'queued' : 'unchanged';
}

/** Räknar om de markerade jobben, äldsta markeringen först. Ett jobb som faller hindrar inte de andra. */
export async function syncPortalJobs(
  admin: SupabaseClient,
  options: { now?: () => Date; limit?: number } = {},
): Promise<PortalJobSyncSummary> {
  const now = options.now ?? (() => new Date());
  const { data, error } = await admin
    .from('crm_portal_jobs')
    .select(JOB_SELECT)
    .not('sync_requested_at', 'is', null)
    .order('sync_requested_at', { ascending: true })
    .limit(options.limit ?? 50);
  if (error) throw new Error(`De markerade jobben gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as SyncJobRow[];

  const summary: PortalJobSyncSummary = { jobs: rows.length, queued: 0, unchanged: 0, conflicts: 0, errors: 0 };
  for (const row of rows) {
    try {
      const outcome = await syncOne(admin, row, now());
      if (outcome === 'queued') summary.queued += 1;
      else if (outcome === 'conflict') summary.conflicts += 1;
      else summary.unchanged += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-sync] jobbet kunde inte räknas om', { quoteId: row.quote_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}

/** Markerar ett jobb för omräkning, t.ex. när dess uppgivna bekräftelse skickats om och resten kan följa. */
export async function markPortalJobForSync(admin: SupabaseClient, quoteId: string, now: Date): Promise<void> {
  const { error } = await admin.from('crm_portal_jobs').update({ sync_requested_at: now.toISOString() }).eq('quote_id', quoteId);
  if (error) throw new Error(`Jobbet kunde inte markeras: ${error.message}`);
}
