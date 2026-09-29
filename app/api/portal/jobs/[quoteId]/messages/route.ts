import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { notifyPortalJobMessage, portalJobMessageSchema, receivePortalJobMessage } from '@/lib/domains/portal/jobMessagesStore';
import { parsePortalBody, runIdempotentPortalRequest, verifyPortalRequest } from '../../../_shared';

type RouteContext = { params: { quoteId: string } };

// Butiken skriver på sitt jobb (RESELLER_PORTAL_CRM_PLAN.md fas 6, kontraktets "Meddelanden från butiken"). Meddelandet
// visas på kortet "Butiken" på arbetsordern, och arbetsorderns ansvarige (annars reserven) får en notis efter svaret.
//
//   201 { messageId }         mottaget, eller redan mottaget med samma innehåll (samma messageId sparas en gång)
//   400 invalid_json          kroppen är inte JSON
//   400 invalid_text          en text som Postgres inte kan spara (nolltecken, ensamt surrogat), eller som den nekar
//   400 validation_error      kroppen följer inte kontraktet (details.issues: fälten)
//   404 unknown_job           inget jobb med det quoteId:t (sparas inte i svarscachen: jobbet kan komma senare)
//   409 work_order_removed    jobbets arbetsorder har tagits bort hos Ekovilla
//   409 message_conflict      samma messageId är redan mottaget, med ett annat innehåll
//   503 job_not_ready         jobbet tas emot just nu; portalen försöker igen (Retry-After)
// Avbrutna, utförda och fakturerade ordrar tar emot meddelanden som vanligt (William 2026-09-28).
//
// Service-rollen: anropet har ingen användare bakom sig. Grinden är signaturen och svarscachen, och affärsnyckeln är
// messageId. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: RouteContext) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;

  const admin = getSupabaseAdmin();
  return runIdempotentPortalRequest(req, verified.rawBody, admin, async () => {
    // Grinden släpper bara sökvägens säkra tecken; ett id som inget jobb har blir 404 i uppslaget.
    const quoteId = context.params.quoteId;

    const parsed = parsePortalBody(verified.rawBody, portalJobMessageSchema);
    if (!parsed.ok) return { response: parsed.response };

    const message = parsed.data;
    const result = await receivePortalJobMessage(admin, quoteId, message);
    switch (result.kind) {
      case 'created':
      case 'existing':
        return {
          response: ok({ messageId: message.messageId }, 201),
          // Också för 'existing': dog processen före notisen gör ett omförsök den. Den skickas ändå bara en gång.
          after: async () => {
            const outcome = await notifyPortalJobMessage(admin, result.id);
            console.info('[portal-messages] efter svaret', { quoteId, outcome });
          },
        };
      case 'unknown_job':
        // Inte bestående: kommer jobbet fram senare (det kan ha fått 503 no_assignee) ska samma nyckel köras igen, inte
        // få samma 404 ur svarscachen (fas 8, som butiksbeställningarnas unknown_order).
        return { response: routeError(404, 'unknown_job', 'Inget jobb med det id:t.'), cacheable: false };
      case 'work_order_removed':
        return { response: routeError(409, 'work_order_removed', 'Jobbets arbetsorder har tagits bort hos Ekovilla.') };
      case 'conflict':
        return { response: routeError(409, 'message_conflict', 'Meddelandet är redan mottaget, med ett annat innehåll.') };
      case 'invalid':
        return { response: routeError(400, 'invalid_text', 'Meddelandet innehåller tecken som inte kan sparas.') };
      case 'not_ready': {
        const response = routeError(503, 'job_not_ready', 'Jobbet tas emot just nu. Försök igen strax.');
        response.headers.set('Retry-After', '30');
        return { response };
      }
    }
  });
}
