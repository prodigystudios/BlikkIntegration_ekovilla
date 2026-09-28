import { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { dispatchPortalOutbox } from '@/lib/domains/portal/outbox';
import { findUnstorableText } from '@/lib/domains/portal/inboundText';
import { PORTAL_JOB_MESSAGE_DEPARTMENTS, PORTAL_JOB_MESSAGE_MAX_CHARS, countChars } from '@/lib/domains/portal/jobMessages';
import { listPortalJobMessages, sendPortalJobReply } from '@/lib/domains/portal/jobMessagesStore';
import { invalidUuidParam, ok, requirePermission, routeError, validationError } from '../../../../_shared';

type RouteContext = { params: { workOrderId: string } };

// Kortet "Butiken" på arbetsordern (RESELLER_PORTAL_CRM_PLAN.md fas 6): tråden med butiken, och svaret.
//
// GET  crm.workorder.read, samma nyckel som arbetsordersidan kräver. Sessionen läser tråden (RLS) och frågar svarsregeln
//      (crm_portal_job_message_can_reply, samma som svarspolicyn) om svarsfältet ska visas; service-rollen läser bara
//      svarens status i kön, för de svar sessionen själv kunde läsa.
//        200 { storeName, canReply, messages }
//        404 portal_job_not_found   ingen portalorder som du ser
// POST crm.workorder.write, och sedan RLS: bara den som har ordern, eller en admin, får svara (William 2026-09-28).
//      Svaret sparas med sessionen och köas med service-rollen (kön är bara service_role). Direkt EFTER svaret skickas
//      kön, så svaret går nu och inte vid nästa cron, utan att knappen väntar på portalen. Bara utskicket, och bara när
//      svaret fortfarande väntar: en upprepning av ett levererat svar startar ingenting. Ett skickat svar kan inte
//      ändras: portalen sparar det en gång per messageId.
//        201 { message, created }       sparat och köat; message.delivery är köns läge just nu
//        400 validation_error / invalid_text
//        403 portal_reply_forbidden      varken ansvarig för ordern eller admin
//        404 portal_job_not_found        ingen portalorder som du ser
//        409 portal_message_conflict     samma id är redan använt för ett annat svar
// Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const dynamic = 'force-dynamic';
// Utskicket efter svaret räknas in i funktionens tid: det tar nya händelser i 60 s, och varje anrop har 10 s, ett
// dokument i samma kö 30 s (fas 7).
export const maxDuration = 120;

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

    const view = await listPortalJobMessages(createSessionClient(), getSupabaseAdmin(), context.params.workOrderId);
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

    const admin = getSupabaseAdmin();
    const result = await sendPortalJobReply(
      createSessionClient(),
      admin,
      {
        workOrderId: context.params.workOrderId,
        messageId: parsed.data.messageId,
        body: parsed.data.body,
        department: parsed.data.department,
        actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
      },
    );
    switch (result.kind) {
      case 'sent':
        if (result.message.delivery === 'sending') {
          waitUntil(
            dispatchPortalOutbox(admin, { env: process.env }).catch((e) => {
              console.error('[portal-messages] utskicket efter svaret föll, cron tar det', { error: e instanceof Error ? e.message : e });
            }),
          );
        }
        return ok({ message: result.message, created: result.created }, 201);
      case 'invalid':
        return routeError(400, 'invalid_text', 'Meddelandet innehåller tecken som inte kan sparas.');
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
