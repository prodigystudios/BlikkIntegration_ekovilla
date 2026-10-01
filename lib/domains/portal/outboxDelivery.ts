import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxEventStatus } from './outbox';

/**
 * Hur det gick för en händelse i kön, läst på dess Idempotency-Key. Används av publiceringen av prislistan (fas 2b) och
 * inbjudan till portalen (10a), som båda köar en händelse och visar hur den gick. Klienten är den som får läsa kön:
 * sessionen med crm.portal.manage (policyn på portal_outbound_events) eller service-rollen.
 */

export type OutboxDelivery = {
  /** `not_queued`: raden finns men händelsen gick inte att köa. Ett nytt försök köar den. */
  status: OutboxEventStatus | 'not_queued';
  attempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  sentAt: string | null;
  /** När en väntande händelse tidigast görs om; "Skicka väntande nu" tar den inte före det. */
  nextAttemptAt: string | null;
};

const DELIVERY_SELECT = 'idempotency_key, status, attempts, last_http_status, last_error, sent_at, next_attempt_at';

type DeliveryRow = {
  idempotency_key: string;
  status: OutboxEventStatus;
  attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  sent_at: string | null;
  next_attempt_at: string | null;
};

export const NOT_QUEUED: OutboxDelivery = {
  status: 'not_queued',
  attempts: 0,
  lastHttpStatus: null,
  lastError: null,
  sentAt: null,
  nextAttemptAt: null,
};

function toDelivery(row: DeliveryRow | undefined): OutboxDelivery {
  if (!row) return NOT_QUEUED;
  return {
    status: row.status,
    attempts: row.attempts,
    lastHttpStatus: row.last_http_status,
    lastError: row.last_error,
    sentAt: row.sent_at,
    nextAttemptAt: row.status === 'pending' ? row.next_attempt_at : null,
  };
}

/** Händelserna med de här nycklarna. En nyckel som inte finns i kön saknas i svaret; anroparen väljer `NOT_QUEUED`. */
export async function readOutboxDeliveries(client: SupabaseClient, keys: string[]): Promise<Map<string, OutboxDelivery>> {
  if (keys.length === 0) return new Map();
  const { data, error } = await client.from('portal_outbound_events').select(DELIVERY_SELECT).in('idempotency_key', keys);
  if (error) throw new Error(`Utskickens status gick inte att läsa: ${error.message}`);
  return new Map(((data ?? []) as DeliveryRow[]).map((row) => [row.idempotency_key, toDelivery(row)]));
}
