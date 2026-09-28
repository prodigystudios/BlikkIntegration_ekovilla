import type { NextRequest } from 'next/server';
import { ok } from '@/lib/api/responses';
import { verifyPortalRequest } from '../_shared';

// Återförsäljarportalen provar kopplingen hit (RESELLER_PORTAL_CRM_PLAN.md, fas 1c, punkt 11 bland
// kontraktsrättelserna). Svarar 200 bara på ett korrekt signerat anrop; 401 annars, 503 när integrationen är av.
// Läser och skriver ingenting.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;
  return ok({ pong: true });
}
