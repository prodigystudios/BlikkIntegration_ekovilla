import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { checkPortalCronAuth } from '@/lib/domains/portal/cronAuth';
import { runPortalCron } from '@/lib/domains/portal/cron';

export const dynamic = 'force-dynamic';
// Utskicket tar nya händelser i 60 s (outbox.ts) och Fortnox-försök påbörjas bara inom 150 s, ett tar upp mot 40 s.
export const maxDuration = 300;

// Portalens bakgrundsarbete, varje minut i prod (vercel.json): statusen tillbaka till butikerna, kön och Fortnox-
// omförsöken (RESELLER_PORTAL_CRM_PLAN.md fas 4b, lib/domains/portal/cron.ts).
//
// Utanför /api/portal/: där kräver vakttestet portalens signatur, och Vercels cron kan inte signera. Grinden är
// CRON_SECRET, jämförd i konstant tid; middleware släpper just den här sökvägen.
//
// Service-rollen: kön, jobben och Fortnox-försöken är service-rollens. Routen tar ingen indata. Se "Reviewed
// elevations" i SUPABASE_CONVENTIONS.md.
export async function GET(req: NextRequest) {
  const auth = checkPortalCronAuth(req.headers.get('authorization'), process.env.CRON_SECRET);
  if (!auth.ok) {
    return auth.status === 503
      ? routeError(503, 'cron_not_configured', 'CRON_SECRET saknas.')
      : routeError(401, 'unauthorized', 'Fel eller saknad nyckel.');
  }
  try {
    const summary = await runPortalCron(getSupabaseAdmin(), { env: process.env });
    return ok(summary);
  } catch (e: any) {
    return routeError(500, 'portal_cron_unexpected', e?.message || 'Portalens cron föll');
  }
}
