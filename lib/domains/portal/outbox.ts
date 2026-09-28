import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePortalTarget } from './config';
import { classifyPortalResult, sendToPortal, type PortalSendResult } from './client';
import { isValidIdempotencyKey } from './idempotency';
import { canonicalJson } from './canonicalJson';

/**
 * Kön för allt CRM:et skickar till återförsäljarportalen (`portal_outbound_events`, RESELLER_PORTAL_CRM_PLAN.md
 * fas 1b). Den som ändrar något köar bara händelsen; utskicket (cron, och en puff efter vissa ändringar) skickar.
 * Då väntar ingen säljare på portalen, och ett avbrott i portalen tappar ingenting.
 *
 * Nås bara med service-rollen (`getSupabaseAdmin()`); tabellen och claim-funktionen saknar grants för sessionerna.
 *
 * 🧨 En UPDATE som inte träffar någon rad svarar utan fel i PostgREST. Varje "bara om den fortfarande är vår" läser
 * därför tillbaka raderna och räknar dem.
 */

/** Försök innan en händelse ges upp. Med fördröjningen nedan blir det drygt två dygn. */
export const PORTAL_OUTBOX_MAX_ATTEMPTS = 60;

/**
 * Hur länge ett utskick tar nya händelser. Ett anrop får ta 10 s, så en körning är klar inom ~70 s — väl under
 * claim-funktionens fem minuter innan en händelse i "sending" räknas som fastnad och tas igen. Utan gränsen hade 20
 * långsamma anrop tagit 200 s, och nästa körning skickat samma händelser en gång till.
 */
export const PORTAL_OUTBOX_BUDGET_MS = 60_000;

const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 3600;

/** Hur länge till nästa försök efter `attempts` misslyckade: 30 s, 1 min, 2 min, … upp till en timme. */
export function retryDelaySeconds(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(RETRY_BASE_SECONDS * 2 ** Math.min(n - 1, 20), RETRY_MAX_SECONDS);
}

const PORTAL_PATH = /^\/api\/ekovilla\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;
const QUEUE_KEY = /^.{1,200}$/su;

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

export type OutboxEventStatus = 'pending' | 'sending' | 'sent' | 'dead' | 'superseded';

/**
 * Köar en händelse. Samma `idempotencyKey` köas bara en gång: andra gången blir det `created: false` och radens
 * nuvarande status (den kan redan vara skickad, ersatt eller uppgiven). Samma nyckel med en annan route, ordning eller
 * kropp är ett programmeringsfel och kastar — nyckeln ska bära allt som skiljer två händelser åt.
 *
 * Med `supersedeKey` blir äldre väntande händelser med samma nyckel 'superseded': bara det senaste planerade datumet
 * behöver fram. Det görs också när händelsen redan fanns, så att ett omförsök efter ett avbrott gör klart jobbet.
 */
export async function enqueuePortalEvent(
  admin: SupabaseClient,
  event: PortalEventInput,
): Promise<{ id: string; created: boolean; status: OutboxEventStatus }> {
  // Ogiltiga tecken i nyckeln hade fått fetch att kasta vid varje försök, och händelsen blockerat sitt jobb i två dygn.
  if (!isValidIdempotencyKey(event.idempotencyKey)) throw new Error(`Ogiltig Idempotency-Key: ${JSON.stringify(event.idempotencyKey)}`);
  if (!PORTAL_PATH.test(event.path)) throw new Error(`Ingen portalroute: ${event.path}`);
  if (!QUEUE_KEY.test(event.orderingKey)) throw new Error('orderingKey saknas eller är för lång.');
  if (event.supersedeKey != null && !QUEUE_KEY.test(event.supersedeKey)) throw new Error('supersedeKey är tom eller för lång.');

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
    .select('id, seq, status');
  if (inserted.error) throw new Error(`Händelsen kunde inte köas: ${inserted.error.message}`);

  let row = (inserted.data ?? [])[0] as { id: string; seq: number; status: OutboxEventStatus } | undefined;
  const created = Boolean(row);
  if (!row) {
    const existing = await admin
      .from('portal_outbound_events')
      .select('id, seq, status, path, payload, ordering_key, supersede_key')
      .eq('idempotency_key', event.idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw new Error(`Händelsen fanns redan men gick inte att läsa: ${existing.error?.message ?? 'saknas'}`);
    }
    const found = existing.data as {
      id: string;
      seq: number;
      status: OutboxEventStatus;
      path: string;
      payload: unknown;
      ordering_key: string;
      supersede_key: string | null;
    };
    if (
      found.path !== event.path ||
      found.ordering_key !== event.orderingKey ||
      (found.supersede_key ?? null) !== (event.supersedeKey ?? null) ||
      canonicalJson(found.payload) !== canonicalJson(event.payload)
    ) {
      throw new Error(`Idempotency-Key ${event.idempotencyKey} är redan köad med ett annat innehåll.`);
    }
    row = { id: found.id, seq: found.seq, status: found.status };
  }

  if (event.supersedeKey && row.status === 'pending') {
    const superseded = await admin
      .from('portal_outbound_events')
      .update({ status: 'superseded' })
      .eq('supersede_key', event.supersedeKey)
      .eq('status', 'pending')
      .lt('seq', row.seq);
    if (superseded.error) throw new Error(`Äldre händelser kunde inte ersättas: ${superseded.error.message}`);
  }
  return { id: row.id, created, status: row.status };
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
  | {
      ran: true;
      claimed: number;
      sent: number;
      retried: number;
      dead: number;
      /** Tagna men inte skickade, eftersom tiden tog slut; tillbaka i kön utan att ett försök räknats. */
      returned: number;
      /** Resultatet kunde inte bokföras, eller claimen var inte längre vår. */
      bookkeepingErrors: number;
    };

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

/** Uppdaterar raden bara om claimen fortfarande är vår, och säger om den var det. */
async function updateOwnClaim(admin: SupabaseClient, event: ClaimedEvent, values: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin
    .from('portal_outbound_events')
    .update(values)
    .eq('id', event.id)
    .eq('status', 'sending')
    .eq('claimed_at', event.claimed_at)
    .select('id');
  if (error) {
    console.error('[portal-outbox] raden kunde inte uppdateras', { key: event.idempotency_key, error: error.message });
    return false;
  }
  if ((data ?? []).length === 0) {
    console.warn('[portal-outbox] claimen var inte längre vår', { key: event.idempotency_key });
    return false;
  }
  return true;
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
    budgetMs?: number;
    now?: () => Date;
    fetchImpl?: typeof fetch;
  },
): Promise<OutboxDispatchSummary> {
  const target = resolvePortalTarget(options.env);
  if (!target.ok) return { ran: false, reason: target.message };
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const budgetMs = options.budgetMs ?? PORTAL_OUTBOX_BUDGET_MS;

  const claimed = await admin.rpc('claim_portal_outbound_events', { p_limit: options.limit ?? 20 });
  if (claimed.error) throw new Error(`Kön kunde inte läsas: ${claimed.error.message}`);
  const events = (claimed.data ?? []) as ClaimedEvent[];

  const summary = { ran: true as const, claimed: events.length, sent: 0, retried: 0, dead: 0, returned: 0, bookkeepingErrors: 0 };
  for (const event of events) {
    if (now().getTime() - startedAt >= budgetMs) {
      // Tiden är slut: lämna tillbaka resten utan att räkna ett försök som aldrig gjordes.
      const returned = await updateOwnClaim(admin, event, { status: 'pending', attempts: Math.max(0, event.attempts - 1) });
      if (returned) summary.returned += 1;
      else summary.bookkeepingErrors += 1;
      continue;
    }

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
    if (!(await updateOwnClaim(admin, event, update))) {
      summary.bookkeepingErrors += 1;
      continue;
    }
    if (update.status === 'sent') summary.sent += 1;
    else if (update.status === 'dead') {
      summary.dead += 1;
      console.warn('[portal-outbox] händelsen gavs upp', { key: event.idempotency_key, error: update.last_error });
    } else summary.retried += 1;
  }
  return summary;
}
