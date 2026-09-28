import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { portalJobSchema } from '@/lib/domains/portal/jobIntake';
import { followUpPortalJob, receivePortalJob } from '@/lib/domains/portal/jobIntakeStore';
import { runIdempotentPortalRequest, verifyPortalRequest } from '../_shared';

// Butikens säljare skickar en godkänd offert till Ekovilla (RESELLER_PORTAL_CRM_PLAN.md fas 3b, kontraktets "Flöde 2").
// Svarar 201 { crmWorkOrderId } när arbetsordern finns. Fortnox-ordern och notiserna görs efter svaret, så att ett
// Fortnox-avbrott aldrig blir butikens fel.
//
//   400 invalid_json          kroppen är inte JSON
//   400 validation_error      kroppen följer inte kontraktet (details.issues: fälten)
//   409 job_conflict          jobbet finns redan, med ett annat innehåll
//   409 work_order_removed    jobbets arbetsorder har tagits bort hos Ekovilla
//   503 no_assignee           ingen kan ta jobbet än (ingen reserv vald): portalen försöker igen
//
// Service-rollen: anropet har ingen användare bakom sig. Grinden är signaturen och svarscachen.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;

  const admin = getSupabaseAdmin();
  return runIdempotentPortalRequest(req, verified.rawBody, admin, async () => {
    let payload: unknown;
    try {
      // Grinden behåller ett inledande BOM (det signerades); JSON.parse tål det inte.
      payload = JSON.parse(verified.rawBody.replace(/^\uFEFF/, ''));
    } catch {
      return { response: routeError(400, 'invalid_json', 'Kroppen är inte JSON.') };
    }
    const parsed = portalJobSchema.safeParse(payload);
    if (!parsed.success) {
      // Med sökvägen till fältet (`lines.1.unitCost`), så att portalen ser vad som är fel.
      const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
      const first = issues[0];
      return { response: routeError(400, 'validation_error', first ? `${first.path}: ${first.message}` : 'Ogiltig kropp.', { issues }) };
    }

    const job = parsed.data;
    const result = await receivePortalJob(admin, job, payload);
    switch (result.kind) {
      case 'created':
      case 'existing':
        return {
          response: ok({ crmWorkOrderId: result.workOrderId }, 201),
          after: async () => {
            const outcome = await followUpPortalJob(admin, job.quoteId);
            console.info('[portal-jobs] efter svaret', { quoteId: job.quoteId, ...outcome });
          },
        };
      case 'conflict':
        return { response: routeError(409, 'job_conflict', 'Jobbet är redan mottaget, med ett annat innehåll.') };
      case 'work_order_removed':
        return { response: routeError(409, 'work_order_removed', 'Jobbets arbetsorder har tagits bort hos Ekovilla.') };
      case 'no_assignee': {
        console.warn('[portal-jobs] ingen kan ta jobbet', { quoteId: job.quoteId, skipped: result.assignment.skipped });
        const response = routeError(503, 'no_assignee', 'Ingen hos Ekovilla kan ta emot jobbet än. Försök igen senare.');
        response.headers.set('Retry-After', '300');
        return { response };
      }
    }
  });
}
