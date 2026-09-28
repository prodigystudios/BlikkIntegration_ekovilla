import type { NextRequest, NextResponse } from 'next/server';
import { routeError } from '@/lib/api/responses';
import { readPortalSecret } from '@/lib/domains/portal/config';
import {
  PORTAL_SIGNATURE_HEADER,
  PORTAL_TIMESTAMP_HEADER,
  verifyPortalSignature,
} from '@/lib/domains/portal/signature';

/**
 * Grinden för varje route under /api/portal/ — anropen från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md,
 * fas 1c). Middleware släpper hela prefixet förbi sessionskontrollen, eftersom portalen inte har någon session; den
 * här funktionen är därför routens ENDA grind och ska vara det första varje handler gör.
 * `tests/portal/routeGuards.test.ts` vaktar det. Allt som kräver en inloggad Ekovilla-användare hör hemma under
 * /api/crm/portal/, inte här.
 *
 *   503 — hemligheten saknas i den här miljön: integrationen är av (så går koden ut mörk i prod).
 *   401 — signaturen stämmer inte, eller tidsstämpeln är för gammal. Orsaken loggas men skickas inte tillbaka.
 *
 * Kroppen läses här, som råtext, eftersom signaturen gäller exakt de byte som skickades. Routen får den tillbaka
 * och parsar den själv.
 */

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

  const rawBody = await req.text();
  // Sökvägen som den står i URL:en (procentkodad), som avsändaren signerade den.
  const path = new URL(req.url).pathname;
  const verdict = verifyPortalSignature({
    secret,
    method: req.method,
    path,
    rawBody,
    timestampHeader: req.headers.get(PORTAL_TIMESTAMP_HEADER),
    signatureHeader: req.headers.get(PORTAL_SIGNATURE_HEADER),
    nowSeconds,
  });
  if (!verdict.ok) {
    console.warn('[portal] nekade ett anrop', { method: req.method, path, reason: verdict.reason });
    return { ok: false, response: routeError(401, 'unauthorized', 'Anropet är inte signerat av återförsäljarportalen.') };
  }
  return { ok: true, rawBody };
}
