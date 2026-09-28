import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { findUnstorableText } from '@/lib/domains/portal/inboundText';
import { PORTAL_JOB_MESSAGE_DEPARTMENTS, PORTAL_JOB_MESSAGE_MAX_CHARS, countChars } from '@/lib/domains/portal/jobMessages';
import { listPortalJobMessages, sendPortalJobReply } from '@/lib/domains/portal/jobMessagesStore';
import { invalidUuidParam, ok, requirePermission, routeError, validationError } from '../../../../_shared';

type RouteContext = { params: { workOrderId: string } };

// Kortet "Butiken" på arbetsordern (RESELLER_PORTAL_CRM_PLAN.md fas 6): tråden med butiken, och svaret.
//
// GET  crm.workorder.read. Sessionen läser tråden (RLS: alla som ser ordern kontorsvägen, och den som har den), och
//      svarens status i kön (läspolicyn för svaren). `canReply` säger om svarsfältet ska visas.
//        200 { storeName, canReply, messages }
//        404 portal_job_not_found   ingen portalorder som du ser
// POST crm.workorder.write, och sedan RLS: bara den som har ordern, eller en admin, får svara (William 2026-09-28).
//      Svaret sparas med sessionen, köas och skickas med service-rollen (kön är bara service_role), direkt och inte
//      först vid nästa cron. Ett skickat svar kan inte ändras: portalen sparar det en gång per messageId.
//        201 { message, created }       sparat; message.delivery säger om det kom fram, skickas eller inte kom fram
//        400 validation_error / invalid_text
//        403 portal_reply_forbidden      varken ansvarig för ordern eller admin
//        404 portal_job_not_found        ingen portalorder som du ser
//        409 portal_message_conflict     samma id är redan använt för ett annat svar
// Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const dynamic = 'force-dynamic';
// Svaret väntar på ett första utskick (högst ~5 s innan det sista försöket börjar, plus portalens svarstid).
export const maxDuration = 60;

const replySchema = z.object({
  messageId: z.string().uuid('Ogiltigt id för svaret.'),
  body: z
    .string()
    .trim()
    .min(1, 'Skriv ett meddelande.')
    .refine((v) => countChars(v) <= PORTAL_JOB_MESSAGE_MAX_CHARS, `Högst ${PORTAL_JOB_MESSAGE_MAX_CHARS} tecken.`),
  department: z.enum(PORTAL_JOB_MESSAGE_DEPARTMENTS, { errorMap: () => ({ message: 'Välj en avdelning.' }) }),
});

export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.read');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.workOrderId);
    if (badId) return badId;

    const perms = await getEffectivePermissions();
    const view = await listPortalJobMessages(createSessionClient(), context.params.workOrderId, {
      userId: gate.currentUser.id,
      canWrite: can(perms, 'crm.workorder.write'),
      isAdmin: can(perms, 'crm.admin'),
    });
    if (!view) return routeError(404, 'portal_job_not_found', 'Ordern kom inte från återförsäljarportalen.');
    return ok(view);
  } catch (e) {
    console.error('[portal-messages] tråden gick inte att läsa', { error: e instanceof Error ? e.message : e });
    return routeError(500, 'portal_messages_failed', 'Meddelandena kunde inte hämtas.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.workOrderId);
    if (badId) return badId;

    const raw = await req.json().catch(() => null);
    const unstorable = findUnstorableText(raw);
    if (unstorable !== null) return routeError(400, 'invalid_text', 'Meddelandet innehåller tecken som inte kan sparas.');
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) return validationError(parsed.error);

    const result = await sendPortalJobReply(
      createSessionClient(),
      getSupabaseAdmin(),
      {
        workOrderId: context.params.workOrderId,
        messageId: parsed.data.messageId,
        body: parsed.data.body,
        department: parsed.data.department,
        actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
      },
      { env: process.env },
    );
    switch (result.kind) {
      case 'sent':
        return ok({ message: result.message, created: result.created }, 201);
      case 'not_found':
        return routeError(404, 'portal_job_not_found', 'Ordern kom inte från återförsäljarportalen.');
      case 'forbidden':
        return routeError(403, 'portal_reply_forbidden', 'Bara den som har ordern, eller en admin, kan svara butiken.');
      case 'conflict':
        return routeError(409, 'portal_message_conflict', 'Svaret är redan skickat med ett annat innehåll. Ladda om kortet.');
    }
  } catch (e) {
    console.error('[portal-messages] svaret kunde inte skickas', { error: e instanceof Error ? e.message : e });
    return routeError(500, 'portal_reply_failed', 'Svaret kunde inte skickas.');
  }
}
