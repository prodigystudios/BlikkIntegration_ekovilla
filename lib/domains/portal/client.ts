import { signPortalRequest } from './signature';
import { IDEMPOTENCY_KEY_HEADER } from './idempotency';

/**
 * Ett signerat anrop till återförsäljarportalen, och vad svaret betyder för kön (RESELLER_PORTAL_CRM_PLAN.md
 * fas 1b). Vart anropet får gå och med vilken hemlighet avgör `resolvePortalTarget` i config.ts; den här modulen tar
 * emot resultatet och bestämmer ingenting om miljön.
 */

/** Hur länge ett anrop får ta. Kön gör om det som inte hann, så en kort gräns kostar bara en fördröjning. */
export const PORTAL_REQUEST_TIMEOUT_MS = 10_000;

/** Hur mycket av svarskroppen som sparas för felsökning. Kroppen loggas aldrig i sin helhet. */
const RESPONSE_EXCERPT_CHARS = 500;

/**
 * Början av en text, säker att spara i Postgres. `slice` på UTF-16 kan klyva en emoji och lämna ett ensamt
 * surrogattecken, och en kropp kan bära ett nolltecken — Postgres nekar båda. Då hade resultatet av ett försök inte
 * gått att bokföra, raden fastnat i "sending", och jobbets alla senare händelser stått bakom den.
 */
export function safeExcerpt(text: string, maxChars: number): string {
  const codePoints = Array.from(text.replace(/\u0000/g, '')).slice(0, maxChars).join('');
  // Array.from håller ihop korrekta par; ett ensamt surrogat som redan fanns i texten byts mot U+FFFD.
  return codePoints.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

export type PortalSendResult =
  | { kind: 'response'; status: number; bodyExcerpt: string }
  | { kind: 'timeout' }
  | { kind: 'network_error'; message: string };

export type PortalDeliveryOutcome = 'sent' | 'retry' | 'dead';

/**
 * Levererat, gör om eller ge upp:
 *   2xx                  levererat.
 *   401                  gör om (beslut 2026-09-28, planens punkt 15): en hemlighet som byts i en app i taget, eller
 *                        en klocka som går fel, får inte tappa händelser för gott.
 *   408, 425, 429        gör om: HTTP:s egna "försök igen senare".
 *   3xx                  gör om: en omdirigering följs aldrig (den hade kunnat leda förbi värdspärren) och tyder på
 *                        en felinställd adress, som går att rätta.
 *   5xx, timeout, nätfel gör om.
 *   övriga 4xx           ge upp: portalen säger att anropet är fel, och det blir inte rätt av att skickas igen.
 *                        409 är kontraktets "går inte längre".
 */
export function classifyPortalResult(result: PortalSendResult): PortalDeliveryOutcome {
  if (result.kind !== 'response') return 'retry';
  const { status } = result;
  if (status >= 200 && status <= 299) return 'sent';
  if (status === 401 || status === 408 || status === 425 || status === 429) return 'retry';
  if (status >= 300 && status <= 399) return 'retry';
  if (status >= 500) return 'retry';
  return 'dead';
}

export async function sendToPortal(input: {
  baseUrl: string;
  secret: string;
  path: string;
  idempotencyKey: string;
  payload: unknown;
  nowSeconds: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PortalSendResult> {
  const { baseUrl, secret, path, idempotencyKey, payload, nowSeconds } = input;
  const fetchImpl = input.fetchImpl ?? fetch;

  // Exakt de byte som signeras är de som skickas.
  const rawBody = JSON.stringify(payload);
  const signatureHeaders = signPortalRequest({ secret, method: 'POST', path, rawBody, nowSeconds });

  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        ...signatureHeaders,
      },
      body: rawBody,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs ?? PORTAL_REQUEST_TIMEOUT_MS),
    });
    const text = await response.text().catch(() => '');
    return { kind: 'response', status: response.status, bodyExcerpt: safeExcerpt(text, RESPONSE_EXCERPT_CHARS) };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
    return { kind: 'network_error', message: safeExcerpt(e instanceof Error ? e.message : String(e), 200) };
  }
}
