import type { NextRequest, NextResponse } from 'next/server';
import { routeError } from '@/lib/api/responses';
import { readPortalSecret } from '@/lib/domains/portal/config';
import {
  PORTAL_SIGNATURE_HEADER,
  PORTAL_TIMESTAMP_HEADER,
  precheckPortalSignatureHeaders,
  verifyPortalSignature,
} from '@/lib/domains/portal/signature';

/**
 * Grinden för varje route under /api/portal/ — anropen från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md,
 * fas 1c). Middleware släpper hela prefixet förbi sessionskontrollen, eftersom portalen inte har någon session; den
 * här funktionen är därför routens ENDA grind och ska vara det första varje handler gör.
 * `tests/portal/routeGuards.test.ts` vaktar det. Allt som kräver en inloggad Ekovilla-användare hör hemma under
 * /api/crm/portal/, inte här.
 *
 * Ordningen är med flit billigast först, eftersom prefixet är öppet mot internet: hemligheten, sökvägen och headrarna
 * prövas innan en enda byte av kroppen tas emot. Ett anrop utan signaturheadrar loggas inte (det är skanners);
 * ett som har dem men inte stämmer loggas, utan orsaken i svaret.
 *
 *   503 portal_not_configured  hemligheten saknas i den här miljön: integrationen är av (så går koden ut mörk i prod)
 *   400 invalid_path           sökvägen har andra tecken än A–Z, a–z, 0–9 och - _ . ~ (kontraktets punkt 16)
 *   401 unauthorized           signaturen saknas, stämmer inte, eller tidsstämpeln är för gammal
 *   413 body_too_large         kroppen är större än Vercel ändå tar emot
 *   400 unreadable_body        kroppen gick inte att läsa (avbruten uppladdning)
 *   400 invalid_encoding       korrekt signerat, men inte UTF-8 — samma byte blir inte rätt av att skickas igen
 *
 * Signaturen prövas över kroppens BYTE, som de kom. `req.text()` hade tagit bort ett inledande BOM och bytt ogiltiga
 * byte mot U+FFFD, och då hade ett korrekt signerat anrop fått 401 — som portalen gör om i två dygn.
 *
 * ⚠️ Grinden stoppar inte ett anrop som spelas upp igen inom 300 sekunder: signaturen är densamma. Varje route som
 * ÄNDRAR något måste därför gå genom svarscachen (lib/domains/portal/idempotency.ts) och sin affärsnyckel, så att
 * ett upprepat anrop inte gör något nytt.
 */

/** Större än Vercels 4,5 MB per anrop, så att gränsen bara slår till där Vercel inte redan gör det (lokalt). */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Portalens sökvägar har bara tecken som aldrig procentkodas; då är sökvägen samma för avsändaren och oss. */
const SAFE_PORTAL_PATH = /^\/api\/portal(\/[A-Za-z0-9._~-]+)+$/;

export type VerifiedPortalRequest = { ok: true; rawBody: string } | { ok: false; response: NextResponse };

export async function verifyPortalRequest(
  req: NextRequest,
  env: Record<string, string | undefined> = process.env,
  nowSeconds: number = Date.now() / 1000,
): Promise<VerifiedPortalRequest> {
  const secret = readPortalSecret(env);
  if (!secret) {
    return {
      ok: false,
      response: routeError(503, 'portal_not_configured', 'Integrationen med återförsäljarportalen är inte påslagen.'),
    };
  }

  const path = new URL(req.url).pathname;
  if (!SAFE_PORTAL_PATH.test(path)) {
    return { ok: false, response: routeError(400, 'invalid_path', 'Sökvägen innehåller tecken som portalen inte skickar.') };
  }

  const unauthorized = (reason: string, log: boolean) => {
    if (log) console.warn('[portal] nekade ett anrop', { method: req.method, path, reason });
    return { ok: false as const, response: routeError(401, 'unauthorized', 'Anropet är inte signerat av återförsäljarportalen.') };
  };

  const timestampHeader = req.headers.get(PORTAL_TIMESTAMP_HEADER);
  const signatureHeader = req.headers.get(PORTAL_SIGNATURE_HEADER);
  const pre = precheckPortalSignatureHeaders({ timestampHeader, signatureHeader, nowSeconds });
  if (!pre.ok) return unauthorized(pre.reason, pre.reason !== 'missing_headers');

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: routeError(413, 'body_too_large', 'Kroppen är för stor.') };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return { ok: false, response: routeError(400, 'unreadable_body', 'Kroppen gick inte att läsa.') };
  }
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: routeError(413, 'body_too_large', 'Kroppen är för stor.') };
  }

  const verdict = verifyPortalSignature({ secret, method: req.method, path, rawBody: bytes, timestampHeader, signatureHeader, nowSeconds });
  if (!verdict.ok) return unauthorized(verdict.reason, true);

  let rawBody: string;
  try {
    // Strikt: ogiltig UTF-8 är ett fel, inte ett U+FFFD. Ett BOM behålls, så att routen ser exakt det som signerades.
    rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, response: routeError(400, 'invalid_encoding', 'Kroppen är inte UTF-8.') };
  }
  return { ok: true, rawBody };
}
