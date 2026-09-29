import type { SupabaseClient } from '@supabase/supabase-js';
import { PORTAL_JOB_QUEUE_PREFIX } from './jobState';
import { markPortalJobForSync } from './jobSync';
import { STORE_ORDER_QUEUE_PREFIX } from './storeOrderState';
import { markStoreOrderForSync } from './storeOrderSync';

/**
 * Markerar det en kö i portal_outbound_events gäller för omräkning: jobbet (`job:<quoteId>`, fas 4b) eller
 * butiksbeställningen (`store_order:<orderId>`, fas 8b3). Prislistan och andra köer har inget att räkna om.
 *
 * Används av "Skicka om" på portalsidan: en bekräftelse som skickas om ska få det som väntat bakom den att följa, och
 * omräkningen tar bara markerade rader. Service-rollen.
 */
export async function markPortalQueueForSync(admin: SupabaseClient, orderingKey: string, now: Date): Promise<void> {
  if (orderingKey.startsWith(PORTAL_JOB_QUEUE_PREFIX)) {
    await markPortalJobForSync(admin, orderingKey.slice(PORTAL_JOB_QUEUE_PREFIX.length), now);
    return;
  }
  if (orderingKey.startsWith(STORE_ORDER_QUEUE_PREFIX)) {
    const orderId = orderingKey.slice(STORE_ORDER_QUEUE_PREFIX.length);
    if (!(await markStoreOrderForSync(admin, orderId, now))) {
      console.warn('[portal-requeue] ingen butiksbeställning att markera', { orderId });
    }
  }
}
