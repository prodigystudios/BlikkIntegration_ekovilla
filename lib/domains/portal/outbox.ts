import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePortalTarget } from './config';
import { classifyPortalResult, sendToPortal, type PortalSendResult } from './client';

/**
 * Kön för allt CRM:et skickar till återförsäljarportalen (`portal_outbound_events`, RESELLER_PORTAL_CRM_PLAN.md
 * fas 1b). Den som ändrar något köar bara händelsen; utskicket (cron, och en puff efter vissa ändringar) skickar.
 * Då väntar ingen säljare på portalen, och ett avbrott i portalen tappar ingenting.
 *
 * Nås bara med service-rollen (`getSupabaseAdmin()`); tabellen och claim-funktionen saknar grants för sessionerna.
 */

/** Försök innan en händelse ges upp. Med fördröjningen nedan blir det drygt två dygn. */
export const PORTAL_OUTBOX_MAX_ATTEMPTS = 60;

const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 3600;

/** Hur länge till nästa försök efter `attempts` misslyckade: 30 s, 1 min, 2 min, … upp till en timme. */
export function retryDelaySeconds(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(RETRY_BASE_SECONDS * 2 ** Math.min(n - 1, 20), RETRY_MAX_SECONDS);
}

const PORTAL_PATH = /^\/api\/ekovilla\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

export type PortalEventInput = {
  /** Idempotency-Key mot portalen, i kontraktets form, t.ex. `job.scheduled-q-2026-015-2026-10-14T08:00:00Z`. */
  idempotencyKey: string;
  /** Portalens route, t.ex. `/api/ekovilla/events`. */
  path: string;
  payload: unknown;
  /** Händelser med samma nyckel skickas i köordning, t.ex. `job:q-2026-015`. */
  orderingKey: string;
  /** En ny händelse med samma nyckel ersätter äldre som ännu väntar, t.ex. `job.scheduled:q-2026-015`. */
  supersedeKey?: string | null;
};

/**
 * Köar en händelse. Samma `idempotencyKey` köas bara en gång (`created: false` andra gången), så en ändring som
 * körs om köar inte två. Med `supersedeKey` blir äldre väntande händelser med samma nyckel 'superseded': bara det
 * senaste planerade datumet behöver fram.
 */
export async function enqueuePortalEvent(
  admin: SupabaseClient,
  event: PortalEventInput,
): Promise<{ id: string; created: boolean }> {
  if (!PORTAL_PATH.test(event.path)) throw new Error(`Ingen portalroute: ${event.path}`);

  const inserted = await admin
    .from('portal_outbound_events')
    .upsert(
      {
        idempotency_key: event.idempotencyKey,
        path: event.path,
        payload: event.payload,
        ordering_key: event.orderingKey,
        supersede_key: event.supersedeKey ?? null,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select('id, created_at');
  if (inserted.error) throw new Error(`Händelsen kunde inte köas: ${inserted.error.message}`);

  const row = (inserted.data ?? [])[0] as { id: string; created_at: string } | undefined;
  if (!row) {
    const existing = await admin
      .from('portal_outbound_events')
      .select('id')
      .eq('idempotency_key', event.idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw new Error(`Händelsen fanns redan men gick inte att läsa: ${existing.error?.message ?? 'saknas'}`);
    }
    return { id: (existing.data as { id: string }).id, created: false };
  }

  if (event.supersedeKey) {
    const superseded = await admin
      .from('portal_outbound_events')
      .update({ status: 'superseded' })
      .eq('supersede_key', event.supersedeKey)
      .eq('status', 'pending')
      .neq('id', row.id)
      .lte('created_at', row.created_at);
    if (superseded.error) throw new Error(`Äldre händelser kunde inte ersättas: ${superseded.error.message}`);
  }
  return { id: row.id, created: true };
}

type ClaimedEvent = {
  id: string;
  idempotency_key: string;
  path: string;
  payload: unknown;
  attempts: number;
  claimed_at: string;
};

export type OutboxDispatchSummary =
  | { ran: false; reason: string }
  | { ran: true; claimed: number; sent: number; retried: number; dead: number; bookkeepingErrors: number };

/** Vad som skrivs på raden efter ett försök. Ren, så att regeln kan testas. */
export function outcomeUpdate(
  event: Pick<ClaimedEvent, 'attempts'>,
  result: PortalSendResult,
  now: Date,
): Record<string, unknown> {
  const httpStatus = result.kind === 'response' ? result.status : null;
  const error =
    result.kind === 'response'
      ? result.status >= 200 && result.status <= 299
        ? null
        : `HTTP ${result.status}: ${result.bodyExcerpt}`
      : result.kind === 'timeout'
        ? 'timeout'
        : `nätfel: ${result.message}`;

  let outcome = classifyPortalResult(result);
  if (outcome === 'retry' && event.attempts >= PORTAL_OUTBOX_MAX_ATTEMPTS) outcome = 'dead';

  if (outcome === 'sent') {
    return { status: 'sent', sent_at: now.toISOString(), last_http_status: httpStatus, last_error: null };
  }
  if (outcome === 'dead') {
    return { status: 'dead', last_http_status: httpStatus, last_error: error };
  }
  return {
    status: 'pending',
    next_attempt_at: new Date(now.getTime() + retryDelaySeconds(event.attempts) * 1000).toISOString(),
    last_http_status: httpStatus,
    last_error: error,
  };
}

/**
 * Skickar det som är dags. Gör ingenting — och tar inget ur kön — när integrationen inte är påslagen i den här
 * miljön (ingen hemlighet, ingen adress, eller en adress som miljön inte får skicka till). Så ligger händelserna kvar
 * och går iväg när den slås på.
 */
export async function dispatchPortalOutbox(
  admin: SupabaseClient,
  options: {
    env: Record<string, string | undefined>;
    limit?: number;
    now?: () => Date;
    fetchImpl?: typeof fetch;
  },
): Promise<OutboxDispatchSummary> {
  const target = resolvePortalTarget(options.env);
  if (!target.ok) return { ran: false, reason: target.message };
  const now = options.now ?? (() => new Date());

  const claimed = await admin.rpc('claim_portal_outbound_events', { p_limit: options.limit ?? 20 });
  if (claimed.error) throw new Error(`Kön kunde inte läsas: ${claimed.error.message}`);
  const events = (claimed.data ?? []) as ClaimedEvent[];

  const summary = { ran: true as const, claimed: events.length, sent: 0, retried: 0, dead: 0, bookkeepingErrors: 0 };
  for (const event of events) {
    const result = await sendToPortal({
      baseUrl: target.baseUrl,
      secret: target.secret,
      path: event.path,
      idempotencyKey: event.idempotency_key,
      payload: event.payload,
      nowSeconds: now().getTime() / 1000,
      fetchImpl: options.fetchImpl,
    });
    const update = outcomeUpdate(event, result, now());
    if (update.status === 'sent') summary.sent += 1;
    else if (update.status === 'dead') summary.dead += 1;
    else summary.retried += 1;

    // Bara om claimen fortfarande är vår: ett utskick som tog för lång tid kan ha fått sin händelse tagen igen.
    const { error } = await admin
      .from('portal_outbound_events')
      .update(update)
      .eq('id', event.id)
      .eq('status', 'sending')
      .eq('claimed_at', event.claimed_at);
    if (error) {
      summary.bookkeepingErrors += 1;
      console.error('[portal-outbox] resultatet kunde inte sparas', { id: event.id, key: event.idempotency_key, error: error.message });
    }
    if (update.status === 'dead') {
      console.warn('[portal-outbox] händelsen gavs upp', { key: event.idempotency_key, error: update.last_error });
    }
  }
  return summary;
}
