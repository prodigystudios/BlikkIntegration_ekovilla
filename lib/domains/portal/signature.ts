import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signaturen på varje anrop mellan CRM:et och återförsäljarportalen, i båda riktningarna
 * (RESELLER_PORTAL_INTEGRATION_PLAN.md, "Transporten"):
 *
 *   X-Ekovilla-Timestamp: unix-sekunder
 *   X-Ekovilla-Signature: v1=<hex av HMAC_SHA256(hemlighet, tidsstämpel \n METOD \n sökväg \n råkropp)>
 *
 * Metod och sökväg ingår (beslut 2026-09-28, RESELLER_PORTAL_CRM_PLAN.md punkt 14): utan dem gällde
 * en signatur för vilken route som helst, åt båda hållen, i 300 sekunder, och en signerad `ping`
 * med tom kropp hade också dugt till att dra tillbaka en annan butiks beställning. Fälten skiljs med
 * radbrytning, som inte kan stå i en sökväg; med punkt hade `/a.b` + `c` och `/a` + `b.c` gett samma
 * sträng. Sökvägen är URL:ens sökväg som den skickas (procentkodad), utan värd och frågesträng.
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
const HTTP_METHOD = /^[A-Z]+$/;

/** Vilket anrop signaturen gäller: metoden och sökvägen, t.ex. `POST` och `/api/portal/jobs`. */
export type PortalRequestTarget = { method: string; path: string };

/**
 * Metoden med versaler och sökvägen som den är. Ett felaktigt mål är ett programmeringsfel hos oss,
 * inte hos avsändaren, och kastar: mottagaren tar metoden och `new URL(req.url).pathname` ur sin egen
 * request, och avsändaren bygger sökvägen själv.
 */
function canonicalTarget(target: PortalRequestTarget): { method: string; path: string } {
  const method = target.method.toUpperCase();
  if (!HTTP_METHOD.test(method)) throw new Error(`Ogiltig metod i signaturen: ${target.method}`);
  const { path } = target;
  // Ingen radbrytning (avgränsaren), ingen frågesträng eller fragment, och alltid från roten.
  if (!path.startsWith('/') || /[\s?#]/.test(path)) throw new Error(`Ogiltig sökväg i signaturen: ${path}`);
  return { method, path };
}

export function isUsablePortalSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && secret.trim().length >= PORTAL_SECRET_MIN_LENGTH;
}

/**
 * HMAC:en, som byte. Hemligheten trimmas här, samma trimning som prövningen av längden gör: en
 * hemlighet med en avslutande radbrytning (vanligt när den klistras in i Vercel) ska inte ge 401 på
 * allt. Kroppen: en sträng kodas som UTF-8, byte används som de är.
 */
function hmacDigest(
  secret: string,
  timestamp: string,
  target: PortalRequestTarget,
  rawBody: string | Uint8Array,
): Buffer {
  const { method, path } = canonicalTarget(target);
  const hmac = createHmac('sha256', secret.trim()).update(`${timestamp}\n${method}\n${path}\n`, 'utf8');
  if (typeof rawBody === 'string') hmac.update(rawBody, 'utf8');
  else hmac.update(rawBody);
  return hmac.digest();
}

/**
 * Headers för ett utgående anrop. Signera precis före varje försök, eftersom signaturen bara gäller
 * i 300 sekunder, och signera exakt den metod, sökväg och kropp som skickas.
 */
export function signPortalRequest(input: {
  secret: string;
  method: string;
  path: string;
  rawBody: string | Uint8Array;
  nowSeconds: number;
}): { [PORTAL_TIMESTAMP_HEADER]: string; [PORTAL_SIGNATURE_HEADER]: string } {
  const { secret, rawBody, nowSeconds } = input;
  if (!isUsablePortalSecret(secret)) throw new Error('Portalhemligheten saknas eller är för kort — inget signeras.');
  if (!Number.isFinite(nowSeconds)) throw new Error('Klockan är inget tal — inget signeras.');
  const timestamp = String(Math.floor(nowSeconds));
  const digest = hmacDigest(secret, timestamp, { method: input.method, path: input.path }, rawBody);
  return {
    [PORTAL_TIMESTAMP_HEADER]: timestamp,
    [PORTAL_SIGNATURE_HEADER]: `${SIGNATURE_VERSION}${digest.toString('hex')}`,
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
 * Det som går att pröva utan kroppen: att båda headrarna finns, att tidsstämpeln är hela sekunder inom 300 s och
 * att signaturen har rätt form. En mottagare kör den INNAN kroppen läses, så att ett osignerat anrop nekas utan att
 * en enda byte av kroppen tas emot. `verifyPortalSignature` kör den också.
 */
export function precheckPortalSignatureHeaders(input: {
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  nowSeconds: number;
}): { ok: true; timestamp: string; receivedHex: string } | { ok: false; reason: PortalSignatureFailure } {
  const timestamp = input.timestampHeader?.trim();
  const signature = input.signatureHeader?.trim();
  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  if (!UNIX_SECONDS.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  // Skrivet så att det faller stängt: med `NaN` som klocka är varje jämförelse falsk, och
  // `Math.abs(NaN) > 300` hade släppt igenom en signatur hur gammal som helst.
  const skew = Math.abs(Math.floor(input.nowSeconds) - Number(timestamp));
  if (!(skew <= PORTAL_SIGNATURE_TOLERANCE_SECONDS)) return { ok: false, reason: 'stale_timestamp' };

  // Formen prövas före avkodningen: Buffer.from(x, 'hex') slutar tyst vid första ogiltiga tecknet.
  if (!signature.startsWith(SIGNATURE_VERSION)) return { ok: false, reason: 'bad_signature_format' };
  const receivedHex = signature.slice(SIGNATURE_VERSION.length);
  if (!HEX_SHA256.test(receivedHex)) return { ok: false, reason: 'bad_signature_format' };
  return { ok: true, timestamp, receivedHex };
}

/**
 * Prövar ett inkommande anrop. Alla nej utom `secret_not_configured` ska bli 401 för avsändaren;
 * `secret_not_configured` är vårt eget fel och blir 503. Anledningen loggas, men skickas inte
 * tillbaka i detalj.
 */
export function verifyPortalSignature(input: {
  secret: string | null | undefined;
  method: string;
  path: string;
  rawBody: string | Uint8Array;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  nowSeconds: number;
}): PortalSignatureVerdict {
  const { secret, rawBody } = input;
  if (!isUsablePortalSecret(secret)) return { ok: false, reason: 'secret_not_configured' };

  const pre = precheckPortalSignatureHeaders(input);
  if (!pre.ok) return pre;
  const { timestamp, receivedHex } = pre;

  const expected = hmacDigest(secret, timestamp, { method: input.method, path: input.path }, rawBody);
  const received = Buffer.from(receivedHex, 'hex');
  // timingSafeEqual kastar vid olika längd. Formkontrollen ovan gör längderna lika, men kontrollen står
  // kvar så att en ändring där inte kan göra jämförelsen till ett kast.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
