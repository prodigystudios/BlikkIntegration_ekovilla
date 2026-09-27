import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signaturen på varje anrop mellan CRM:et och återförsäljarportalen, i båda riktningarna
 * (RESELLER_PORTAL_INTEGRATION_PLAN.md, "Transporten"):
 *
 *   X-Ekovilla-Timestamp: unix-sekunder
 *   X-Ekovilla-Signature: v1=<hex av HMAC_SHA256(hemlighet, tidsstämpel + "." + råkropp)>
 *
 * Mottagaren nekar om tidsstämpeln avviker mer än 300 sekunder eller om signaturen inte stämmer,
 * jämför i konstant tid, och räknar alltid på den RÅA kroppen, före JSON-parsning. En kropp som
 * parsas och serialiseras om kan få en annan byteföljd än den som signerades.
 *
 * Ren logik utan miljö och nätverk: hemligheten och klockan kommer in som argument, så att allt går
 * att testa. Var hemligheten kommer ifrån avgör `config.ts`.
 */

export const PORTAL_TIMESTAMP_HEADER = 'X-Ekovilla-Timestamp';
export const PORTAL_SIGNATURE_HEADER = 'X-Ekovilla-Signature';

/** Hur långt tidsstämpeln får avvika från vår klocka, åt båda hållen. */
export const PORTAL_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Kortaste hemlighet som godtas. `openssl rand -hex 32` ger 64 tecken. En tom eller kort hemlighet
 * gör signaturen gissningsbar, och räknas därför som att ingen hemlighet finns: routen svarar 503,
 * och inget signeras.
 */
export const PORTAL_SECRET_MIN_LENGTH = 32;

const SIGNATURE_VERSION = 'v1=';
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const UNIX_SECONDS = /^\d{1,12}$/;

export function isUsablePortalSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && secret.trim().length >= PORTAL_SECRET_MIN_LENGTH;
}

/** Kroppen som den skickas: en sträng kodas som UTF-8, byte används som de är. */
function bodyBytes(rawBody: string | Uint8Array): Uint8Array {
  return typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
}

function hmacHex(secret: string, timestamp: string, rawBody: string | Uint8Array): string {
  return createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(bodyBytes(rawBody)).digest('hex');
}

/**
 * Headers för ett utgående anrop. Signera precis före varje försök, eftersom signaturen bara gäller
 * i 300 sekunder, och signera exakt den kropp som skickas.
 */
export function signPortalRequest(
  secret: string,
  rawBody: string | Uint8Array,
  nowSeconds: number,
): { [PORTAL_TIMESTAMP_HEADER]: string; [PORTAL_SIGNATURE_HEADER]: string } {
  if (!isUsablePortalSecret(secret)) throw new Error('Portalhemligheten saknas eller är för kort — inget signeras.');
  const timestamp = String(Math.floor(nowSeconds));
  return {
    [PORTAL_TIMESTAMP_HEADER]: timestamp,
    [PORTAL_SIGNATURE_HEADER]: `${SIGNATURE_VERSION}${hmacHex(secret, timestamp, rawBody)}`,
  };
}

export type PortalSignatureFailure =
  | 'secret_not_configured'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'bad_signature_format'
  | 'signature_mismatch';

export type PortalSignatureVerdict = { ok: true } | { ok: false; reason: PortalSignatureFailure };

/**
 * Prövar ett inkommande anrop. Alla nej utom `secret_not_configured` ska bli 401 för avsändaren;
 * `secret_not_configured` är vårt eget fel och blir 503. Anledningen loggas, men skickas inte
 * tillbaka i detalj.
 */
export function verifyPortalSignature(input: {
  secret: string | null | undefined;
  rawBody: string | Uint8Array;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  nowSeconds: number;
}): PortalSignatureVerdict {
  const { secret, rawBody, nowSeconds } = input;
  if (!isUsablePortalSecret(secret)) return { ok: false, reason: 'secret_not_configured' };

  const timestamp = input.timestampHeader?.trim();
  const signature = input.signatureHeader?.trim();
  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  if (!UNIX_SECONDS.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(Math.floor(nowSeconds) - Number(timestamp)) > PORTAL_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  // Formen prövas före avkodningen: Buffer.from(x, 'hex') slutar tyst vid första ogiltiga tecknet.
  if (!signature.startsWith(SIGNATURE_VERSION)) return { ok: false, reason: 'bad_signature_format' };
  const receivedHex = signature.slice(SIGNATURE_VERSION.length);
  if (!HEX_SHA256.test(receivedHex)) return { ok: false, reason: 'bad_signature_format' };

  const expected = Buffer.from(hmacHex(secret, timestamp, rawBody), 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  // timingSafeEqual kastar vid olika längd. Formkontrollen ovan gör längderna lika, men kontrollen står
  // kvar så att en ändring där inte kan göra jämförelsen till ett kast.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
