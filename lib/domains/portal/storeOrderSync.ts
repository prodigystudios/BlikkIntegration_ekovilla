import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueuePortalEvent } from './outbox';
import { PORTAL_EVENTS_PATH } from './jobState';
import { readConfirmedDelivery } from './jobSync';
import { deriveStoreOrderEvents, parseStoreOrderSyncState, storeOrderOrderingKey } from './storeOrderState';
import type { StoreOrderStatus } from './storeOrders';

/**
 * Statusen tillbaka för butiksbeställningarna, mot databasen (RESELLER_PORTAL_CRM_PLAN.md fas 8b3). Vakten
 * (crm_store_orders_guard) markerar raden, sync_requested_at, när statusen, Fortnox-numret, leverans- eller fakturadagen
 * eller makuleringen ändras; här räknas de markerade om och skillnaden köas. Utskicket (outbox.ts) skickar kön.
 *
 * SERVICE-ROLLEN: sync_state, sync_requested_at och kön är service-rollens (se "Reviewed elevations" i
 * SUPABASE_CONVENTIONS.md). Körs av cron-routen och av knapparna på portalsidan.
 *
 * En beställning i två steg. Samma rad ger alltid samma händelser (storeOrderState.ts), så jobbens
 * sync_pending_events och sync_version behövs inte:
 *   1. Händelserna köas, i ordning. Kön känner igen en nyckel den redan har.
 *   2. Läget sparas, och markeringen nollas eller flyttas sist (något väntar på att bekräftelsen levereras), i EN
 *      UPDATE, bara om markeringen står kvar som den lästes. Vakten sätter en ny tid vid varje ändring, så en ändring
 *      under tiden, eller ett annat varv som hann före, ger noll rader: läget sparas inte, och nästa varv räknar om från
 *      det gamla läget. Samma händelser köas då igen, och kön känner igen dem.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Därför läses raderna tillbaka.
 */

const SELECT =
  'id, order_id, status, fortnox_order_number, confirmed_at, delivered_on, delivered_at, invoiced_on, invoiced_at, cancelled_at, cancel_reason, sync_requested_at, sync_state';

type SyncStoreOrderRow = {
  id: string;
  order_id: string;
  status: StoreOrderStatus;
  fortnox_order_number: string | null;
  confirmed_at: string | null;
  delivered_on: string | null;
  delivered_at: string | null;
  invoiced_on: string | null;
  invoiced_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  sync_requested_at: string;
  sync_state: unknown;
};

/**
 * `queued`: beställningar som köade något, också när läget sedan inte hann sparas (händelserna ligger i kön och ska
 * skickas; cron gör ett utskick till för dem). `conflicts`: läget sparades inte. En beställning kan alltså räknas i båda,
 * till skillnad från jobbens sammanfattning, där läget sparas före kön.
 */
export type StoreOrderSyncSummary = { orders: number; queued: number; unchanged: number; conflicts: number; errors: number };

async function syncOne(admin: SupabaseClient, row: SyncStoreOrderRow, now: Date): Promise<{ queued: boolean; saved: boolean }> {
  const state = parseStoreOrderSyncState(row.sync_state);
  const result = deriveStoreOrderEvents({
    orderId: row.order_id,
    order: {
      status: row.status,
      fortnoxOrderNumber: row.fortnox_order_number,
      confirmedAt: row.confirmed_at,
      deliveredOn: row.delivered_on,
      deliveredAt: row.delivered_at,
      invoicedOn: row.invoiced_on,
      invoicedAt: row.invoiced_at,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason,
    },
    state,
    confirmedDelivery: await readConfirmedDelivery(admin, state.confirmedKey),
    now,
  });

  // 1. I ordning: kön skickar en beställnings händelser i den ordning de köades.
  for (const e of result.events) {
    await enqueuePortalEvent(admin, {
      idempotencyKey: e.idempotencyKey,
      path: PORTAL_EVENTS_PATH,
      payload: e.payload,
      orderingKey: storeOrderOrderingKey(row.order_id),
    });
  }

  // 2. Läget och markeringen, bara om markeringen står kvar. En beställning som väntar på att "bekräftad" levereras får
  // en ny markering (nu), så att den hamnar sist: annars hade beställningar som väntar på en portal som ligger nere tagit
  // varje varv, och nya ändringar aldrig kommit fram.
  const saved = await admin
    .from('crm_store_orders')
    .update({ sync_state: result.state, sync_requested_at: result.revisit ? now.toISOString() : null })
    .eq('id', row.id)
    .eq('sync_requested_at', row.sync_requested_at)
    .select('id');
  if (saved.error) throw new Error(`Beställningens läge kunde inte sparas: ${saved.error.message}`);
  return { queued: result.events.length > 0, saved: (saved.data ?? []).length > 0 };
}

/** Räknar om de markerade beställningarna, äldsta markeringen först. En som faller hindrar inte de andra. */
export async function syncStoreOrders(
  admin: SupabaseClient,
  options: { now?: () => Date; limit?: number } = {},
): Promise<StoreOrderSyncSummary> {
  const now = options.now ?? (() => new Date());
  const { data, error } = await admin
    .from('crm_store_orders')
    .select(SELECT)
    .not('sync_requested_at', 'is', null)
    .order('sync_requested_at', { ascending: true })
    .limit(options.limit ?? 100);
  if (error) throw new Error(`De markerade butiksbeställningarna gick inte att läsa: ${error.message}`);
  const rows = (data ?? []) as SyncStoreOrderRow[];

  const summary: StoreOrderSyncSummary = { orders: rows.length, queued: 0, unchanged: 0, conflicts: 0, errors: 0 };
  for (const row of rows) {
    try {
      const outcome = await syncOne(admin, row, now());
      // Köat räknas också när läget inte hann sparas: händelserna ligger i kön och ska skickas.
      if (outcome.queued) summary.queued += 1;
      if (!outcome.saved) summary.conflicts += 1;
      else if (!outcome.queued) summary.unchanged += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[portal-sync] butiksbeställningen kunde inte räknas om', {
        orderId: row.order_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}

/**
 * Markerar en beställning för omräkning, t.ex. när dess uppgivna bekräftelse skickats om och resten kan följa. Svarar
 * false när ingen rad har portalens orderId (en UPDATE på noll rader ger inget fel i PostgREST).
 */
export async function markStoreOrderForSync(admin: SupabaseClient, orderId: string, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from('crm_store_orders')
    .update({ sync_requested_at: now.toISOString() })
    .eq('order_id', orderId)
    .select('id');
  if (error) throw new Error(`Butiksbeställningen kunde inte markeras: ${error.message}`);
  return (data ?? []).length > 0;
}
