import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import { routeError } from '@/lib/api/responses';
import { isPortalDatabaseAllowed, readPortalSecret } from '@/lib/domains/portal/config';
import { findUnstorableText } from '@/lib/domains/portal/inboundText';
import {
  IDEMPOTENCY_KEY_HEADER,
  claimIdempotencyKey,
  completeIdempotencyKey,
  idempotencyRequestHash,
  isCacheableResponseStatus,
  isValidIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/domains/portal/idempotency';
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
 *   503 portal_not_configured  hemligheten saknas i den här miljön: integrationen är av (så går koden ut mörk i prod);
 *                              eller fel databas utanför prod (`isPortalDatabaseAllowed`), med orsaken bara i loggen
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
  // Fel databas utanför prod (T4b, `isPortalDatabaseAllowed`) svarar som en avstängd integration: portalen
  // försöker igen, och inget skrivs förrän miljön är rättad. Orsaken står bara i vår logg.
  const wrongDatabase = Boolean(secret) && !isPortalDatabaseAllowed(env);
  if (wrongDatabase) console.error('[portal] nekade: utanför prod körs integrationen bara mot den lokala databasen eller testprojektet');
  if (!secret || wrongDatabase) {
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

// ---------------------------------------------------------------------------------------------------- svarscachen

/**
 * Vad en ändrande route svarar, och det som ska göras efter svaret (Fortnox-ordern, notiserna). `cacheable: false` släpper
 * nyckeln i stället för att spara svaret, för ett nej som kan bli ett ja vid ett senare försök med samma nyckel: en
 * tillbakadragning (fast nyckel) av en beställning som ännu inte kommit fram (fas 8).
 */
export type PortalHandlerResult = { response: NextResponse; after?: () => Promise<unknown>; cacheable?: false };

/** Vercel väntar in arbetet efter svaret; lokalt, utan Vercel, fortsätter det bara i processen. */
function scheduleAfterResponse(work: Promise<unknown>) {
  waitUntil(work);
}

function cachedResponse(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Kör en ändrande route genom svarscachen (`portal_idempotency_keys`, se idempotency.ts). Portalen gör om anropet
 * vid timeout, 5xx och 401; ett upprepat anrop med samma `Idempotency-Key` får samma svar utan att något körs igen.
 *
 *   400 invalid_idempotency_key  nyckeln saknas eller har otillåtna tecken
 *   422 idempotency_key_reused   samma nyckel, en annan förfrågan (metod, sökväg eller kropp)
 *   503 request_in_progress      ett annat anrop med nyckeln körs just nu (Retry-After)
 *   500 portal_request_failed    routen kastade; nyckeln släpps, så att omförsöket körs på nytt
 *
 * Svaret sparas när det blir samma vid ett omförsök (2xx och bestående 4xx), annars släpps nyckeln. En route kan säga att
 * ett visst svar inte är bestående (`cacheable: false`), och då släpps nyckeln också. Det som ska göras
 * efter svaret (`after`) körs bara av det anrop som faktiskt körde routen, aldrig av en upprepning.
 */
export async function runIdempotentPortalRequest(
  req: NextRequest,
  rawBody: string,
  admin: SupabaseClient,
  handler: () => Promise<PortalHandlerResult>,
  options: { schedule?: (work: Promise<unknown>) => void; now?: () => Date } = {},
): Promise<NextResponse> {
  const key = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (!isValidIdempotencyKey(key)) {
    return routeError(400, 'invalid_idempotency_key', 'Idempotency-Key saknas eller är ogiltig.');
  }
  const path = new URL(req.url).pathname;
  const now = options.now ?? (() => new Date());

  let claim;
  try {
    claim = await claimIdempotencyKey(admin, key, idempotencyRequestHash(req.method, path, rawBody), now());
  } catch (e) {
    console.error('[portal] svarscachen svarar inte', { path, error: e instanceof Error ? e.message : String(e) });
    return routeError(500, 'portal_request_failed', 'Anropet kunde inte tas emot. Försök igen.');
  }
  if (claim.kind === 'replay') return cachedResponse(claim.status, claim.body);
  if (claim.kind === 'mismatch') {
    return routeError(422, 'idempotency_key_reused', 'Idempotency-Key är redan använd för en annan förfrågan.');
  }
  if (claim.kind === 'in_progress') {
    const busy = routeError(503, 'request_in_progress', 'Ett anrop med samma Idempotency-Key körs redan.');
    busy.headers.set('Retry-After', '5');
    return busy;
  }
  const owned = { key, token: claim.token };

  let result: PortalHandlerResult;
  try {
    result = await handler();
  } catch (e) {
    console.error('[portal] routen föll', { path, error: e instanceof Error ? e.message : String(e) });
    result = { response: routeError(500, 'portal_request_failed', 'Anropet kunde inte tas emot. Försök igen.') };
  }

  const { response } = result;
  try {
    if (result.cacheable !== false && isCacheableResponseStatus(response.status)) {
      const saved = await completeIdempotencyKey(admin, owned, response.status, await response.clone().json(), now());
      if (!saved) console.warn('[portal] svaret sparades inte: claimen var inte längre vår', { path });
    } else {
      await releaseIdempotencyKey(admin, owned);
    }
  } catch (e) {
    // Svaret gäller ändå för det här anropet. Ett omförsök kör routen igen, som är idempotent på sin affärsnyckel.
    console.error('[portal] svarscachen kunde inte uppdateras', { path, error: e instanceof Error ? e.message : String(e) });
  }

  if (result.after) {
    const work = result.after().catch((e) => {
      console.error('[portal] arbetet efter svaret föll', { path, error: e instanceof Error ? e.message : String(e) });
    });
    (options.schedule ?? scheduleAfterResponse)(work);
  }
  return response;
}

// ---------------------------------------------------------------------------------------------------------- kroppen

/**
 * Ett id i kroppen som måste vara sökvägens (butiksbeställningens orderId): 400 validation_error med fältets sökväg när
 * de skiljer sig, annars null.
 */
export function portalPathIdMismatch(field: string, inBody: string, inPath: string): NextResponse | null {
  if (inBody === inPath) return null;
  return routeError(400, 'validation_error', `${field}: samma id som i sökvägen.`, {
    issues: [{ path: field, message: 'Samma id som i sökvägen.' }],
  });
}

export type ParsedPortalBody<T> = { ok: true; data: T; payload: unknown } | { ok: false; response: NextResponse };

/**
 * Kroppen som JSON och mot kontraktets schema, med samma svar som jobbets route när den inte håller:
 *
 *   400 invalid_json       kroppen är inte JSON
 *   400 invalid_text       en text som Postgres inte kan spara (nolltecken, ensamt surrogat), med sökvägen
 *   400 validation_error   kroppen följer inte kontraktet (details.issues: fälten, som `lines.1.unitCost`)
 *
 * `payload` är kroppen som den kom, `data` den tolkade (trimmad, med schemats standardvärden).
 */
export function parsePortalBody<T>(rawBody: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ParsedPortalBody<T> {
  let payload: unknown;
  try {
    // Grinden behåller ett inledande BOM (det signerades); JSON.parse tål det inte.
    payload = JSON.parse(rawBody.charCodeAt(0) === 0xfeff ? rawBody.slice(1) : rawBody);
  } catch {
    return { ok: false, response: routeError(400, 'invalid_json', 'Kroppen är inte JSON.') };
  }
  const unstorable = findUnstorableText(payload);
  if (unstorable !== null) {
    return {
      ok: false,
      response: routeError(400, 'invalid_text', `${unstorable}: innehåller ett nolltecken eller ett ensamt surrogat, som inte kan sparas.`),
    };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    return {
      ok: false,
      response: routeError(400, 'validation_error', first ? `${first.path}: ${first.message}` : 'Ogiltig kropp.', { issues }),
    };
  }
  return { ok: true, data: parsed.data, payload };
}
