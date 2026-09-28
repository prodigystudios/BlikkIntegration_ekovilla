import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Svarscachen för portalens inkommande anrop (`portal_idempotency_keys`, RESELLER_PORTAL_CRM_PLAN.md fas 1b).
 *
 * Portalen sätter `Idempotency-Key` och gör om anropet vid timeout, 5xx och 401. Ett upprepat anrop ska få samma
 * svar och inte göra något nytt. Flödet i en route:
 *
 *   claim → 'claimed'     kör, och spara sedan svaret med completeIdempotencyKey (2xx och bestående 4xx) eller
 *                         släpp nyckeln med releaseIdempotencyKey (5xx och tillfälliga 4xx), så att omförsöket körs
 *                         på nytt. Båda tar claimens `token`: en route som tagit för lång tid och fått sin nyckel
 *                         övertagen kan då inte spara över eller släppa den nya ägarens claim.
 *   claim → 'replay'      svara med det sparade svaret
 *   claim → 'mismatch'    422: samma nyckel, en annan förfrågan
 *   claim → 'in_progress' 503 med Retry-After: ett annat anrop med nyckeln körs just nu. 503 och inte 409, eftersom
 *                         portalen gör om 5xx men ger upp 4xx.
 *
 * Tabellen är en cache, inte det enda skyddet. En route vars arbete dör mellan claim och svar lämnar nyckeln i
 * 'processing'; efter STALE_CLAIM_MS får nästa omförsök ta den igen och köra om. Därför ska varje route också vara
 * idempotent på sin affärsnyckel (quote_id, message_id, order_id).
 *
 * Tabellen nås bara med service-rollen (`getSupabaseAdmin()`); inga policyer finns.
 */

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Hur länge en claim hålls innan ett omförsök får ta över den. Längre än en routes normala körtid. */
export const STALE_CLAIM_MS = 60_000;

// Synliga ASCII-tecken, ingen blank: kontraktets nycklar är t.ex. `job-q-2026-015` och `store-order-so-1-withdraw`.
const KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;

export function isValidIdempotencyKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * Förfrågans fingeravtryck: sha256 av metod, sökväg och råkropp, med samma avgränsare som signaturen. Samma nyckel
 * på en annan route eller med en annan kropp är en annan förfrågan.
 */
export function idempotencyRequestHash(method: string, path: string, rawBody: string | Uint8Array): string {
  const hash = createHash('sha256').update(`${method.toUpperCase()}\n${path}\n`, 'utf8');
  if (typeof rawBody === 'string') hash.update(rawBody, 'utf8');
  else hash.update(rawBody);
  return hash.digest('hex');
}

export type IdempotencyRow = {
  key: string;
  request_hash: string;
  status: 'processing' | 'done';
  response_status: number | null;
  response_body: unknown;
  claimed_at: string;
};

export type IdempotencyClaim =
  | { kind: 'claimed'; token: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

/**
 * Vad en befintlig rad betyder för ett nytt anrop med samma nyckel. `take_over` = claimen är gammal och får tas
 * (det avgör databasen, så att bara ett omförsök vinner).
 */
/**
 * Får svaret sparas? 2xx och de 4xx som blir samma vid ett omförsök. 401, 408, 425 och 429 är tillfälliga (401 görs
 * om enligt beslutet 2026-09-28), 3xx svarar portalens routes inte med, och ett 5xx ska köras om. Samma regel som
 * tabellens CHECK.
 */
export function isCacheableResponseStatus(status: number): boolean {
  if (status >= 200 && status <= 299) return true;
  return status >= 400 && status <= 499 && ![401, 408, 425, 429].includes(status);
}

export function decideExistingIdempotencyKey(
  row: IdempotencyRow,
  requestHash: string,
  now: Date,
): Exclude<IdempotencyClaim, { kind: 'claimed' }> | { kind: 'take_over' } {
  if (row.request_hash !== requestHash) return { kind: 'mismatch' };
  if (row.status === 'done' && row.response_status !== null) {
    return { kind: 'replay', status: row.response_status, body: row.response_body };
  }
  const claimedAt = Date.parse(row.claimed_at);
  // En claim med en oläsbar tidpunkt räknas som gammal: annars hade nyckeln varit låst för alltid.
  if (!Number.isFinite(claimedAt) || now.getTime() - claimedAt >= STALE_CLAIM_MS) return { kind: 'take_over' };
  return { kind: 'in_progress' };
}

const SELECT = 'key, request_hash, status, response_status, response_body, claimed_at';

export async function claimIdempotencyKey(
  admin: SupabaseClient,
  key: string,
  requestHash: string,
  now: Date = new Date(),
): Promise<IdempotencyClaim> {
  // Tiden claimen skrivs med är också dess token.
  const token = now.toISOString();

  // Ny nyckel: raden läggs in, och bara det anrop som lade in den får köra.
  const inserted = await admin
    .from('portal_idempotency_keys')
    .upsert(
      { key, request_hash: requestHash, status: 'processing', claimed_at: token },
      { onConflict: 'key', ignoreDuplicates: true },
    )
    .select('key');
  if (inserted.error) throw new Error(`Idempotensnyckeln kunde inte tas: ${inserted.error.message}`);
  if ((inserted.data ?? []).length > 0) return { kind: 'claimed', token };

  const existing = await admin.from('portal_idempotency_keys').select(SELECT).eq('key', key).maybeSingle();
  if (existing.error) throw new Error(`Idempotensnyckeln kunde inte läsas: ${existing.error.message}`);
  // Släppt mellan våra två frågor: ett annat anrop håller på. Portalen gör om.
  if (!existing.data) return { kind: 'in_progress' };

  const row = existing.data as IdempotencyRow;
  const decision = decideExistingIdempotencyKey(row, requestHash, now);
  if (decision.kind !== 'take_over') return decision;

  // Ta över en gammal claim — bara om ingen annan hunnit före (claimed_at är oförändrad).
  const taken = await admin
    .from('portal_idempotency_keys')
    .update({ claimed_at: token })
    .eq('key', key)
    .eq('status', 'processing')
    .eq('claimed_at', row.claimed_at)
    .select('key');
  if (taken.error) throw new Error(`Idempotensnyckeln kunde inte tas över: ${taken.error.message}`);
  return (taken.data ?? []).length > 0 ? { kind: 'claimed', token } : { kind: 'in_progress' };
}

/**
 * Sparar svaret, om claimen fortfarande är vår. `false` = den togs över eller släpptes medan routen körde; svaret
 * gäller ändå för det här anropet, men sparas inte. (Kolla alltid: en UPDATE som inte träffar någon rad svarar utan
 * fel i PostgREST.)
 */
export async function completeIdempotencyKey(
  admin: SupabaseClient,
  claim: { key: string; token: string },
  responseStatus: number,
  responseBody: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isCacheableResponseStatus(responseStatus)) {
    throw new Error(`Svaret ${responseStatus} sparas inte — släpp nyckeln med releaseIdempotencyKey.`);
  }
  const { data, error } = await admin
    .from('portal_idempotency_keys')
    .update({ status: 'done', response_status: responseStatus, response_body: responseBody ?? null, completed_at: now.toISOString() })
    .eq('key', claim.key)
    .eq('status', 'processing')
    .eq('claimed_at', claim.token)
    .select('key');
  if (error) throw new Error(`Svaret kunde inte sparas för idempotensnyckeln: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Släpper nyckeln efter ett svar som inte sparas (5xx, tillfälligt 4xx), så att portalens omförsök körs på nytt i
 * stället för att vänta ut claimen — men bara vår egen claim. `false` = någon annan äger den nu.
 */
export async function releaseIdempotencyKey(admin: SupabaseClient, claim: { key: string; token: string }): Promise<boolean> {
  const { data, error } = await admin
    .from('portal_idempotency_keys')
    .delete()
    .eq('key', claim.key)
    .eq('status', 'processing')
    .eq('claimed_at', claim.token)
    .select('key');
  if (error) throw new Error(`Idempotensnyckeln kunde inte släppas: ${error.message}`);
  return (data ?? []).length > 0;
}
