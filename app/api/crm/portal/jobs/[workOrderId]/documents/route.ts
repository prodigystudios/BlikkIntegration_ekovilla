import { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { dispatchPortalOutbox } from '@/lib/domains/portal/outbox';
import { PORTAL_JOB_DOCUMENT_KINDS } from '@/lib/domains/portal/jobDocuments';
import { listPortalJobDocuments, portalDocumentSources, sendPortalJobDocument } from '@/lib/domains/portal/jobDocumentsStore';
import { invalidUuidParam, ok, requirePermission, routeError, validationError } from '../../../../_shared';

type RouteContext = { params: { workOrderId: string } };

// Dokumenten till butiken i kortet "Butiken" på arbetsordern (RESELLER_PORTAL_CRM_PLAN.md fas 7): orderbekräftelsen och
// egenkontrollen, som job.document.
//
// GET  crm.workorder.read, samma nyckel som arbetsordersidan kräver. Sessionen läser dokumenten och kommentarerna (RLS)
//      och frågar svarsregeln (crm_portal_job_message_can_reply) om knapparna ska visas; service-rollen läser bara köns
//      status och jobbets läge.
//        200 { canSend, blocked, latest, selfInspection }
//        404 portal_job_not_found   ingen portalorder som du ser
// POST crm.workorder.write, och sedan RLS: bara den som har ordern, eller en admin, får skicka (William 2026-09-28, samma
//      som svarar butiken). Sessionen lägger till beslutet; service-rollen hämtar PDF:en (Fortnox eller arkivet), fryser
//      den i bucketen och köar den. Direkt EFTER svaret skickas kön, bara när dokumentet väntar. Klienten skickar aldrig
//      en sökväg som läses: för egenkontrollen jämförs den bara med den som servern själv hittar på ordern.
//        201 { document, created }             fryst och köat (created: false = samma id redan skickat)
//        400 validation_error
//        403 portal_document_forbidden         varken ansvarig för ordern eller admin
//        404 portal_job_not_found              ingen portalorder som du ser
//        404 portal_document_no_source         ingen egenkontroll på ordern
//        409 portal_document_blocked           jobbet är avbrutet, eller butiken har inte fått bekräftelsen än
//        409 portal_document_source_changed    en nyare egenkontroll har kommit sedan kortet lästes
//        409 portal_document_conflict          samma id är redan använt för ett annat dokument
//        422 portal_document_wrong_order       egenkontrollen i kommentarerna gäller en annan order
//        422 portal_document_failed            gick inte (för stor, Fortnox): details.document säger varför
// Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const dynamic = 'force-dynamic';
// Orderbekräftelsen renderas med tre Fortnox-anrop, och utskicket efter svaret tar nya händelser i 60 s, där ett
// dokument får ta 30 s.
export const maxDuration = 120;

const sendSchema = z
  .object({
    documentId: z.string().uuid('Ogiltigt id för dokumentet.'),
    kind: z.enum(PORTAL_JOB_DOCUMENT_KINDS, { errorMap: () => ({ message: 'Okänt dokument.' }) }),
    sourcePath: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((v) => v.kind !== 'self_inspection' || Boolean(v.sourcePath), {
    message: 'Vilken egenkontroll saknas.',
    path: ['sourcePath'],
  });

export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.read');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.workOrderId);
    if (badId) return badId;

    const view = await listPortalJobDocuments(createSessionClient(), getSupabaseAdmin(), context.params.workOrderId);
    if (!view) return routeError(404, 'portal_job_not_found', 'Ordern kom inte från återförsäljarportalen.');
    return ok(view);
  } catch (e) {
    console.error('[portal-documents] dokumenten gick inte att läsa', { error: e instanceof Error ? e.message : e });
    return routeError(500, 'portal_documents_failed', 'Dokumenten kunde inte hämtas.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.workOrderId);
    if (badId) return badId;

    const parsed = sendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const admin = getSupabaseAdmin();
    const result = await sendPortalJobDocument(createSessionClient(), admin, portalDocumentSources(admin, process.env), {
      workOrderId: context.params.workOrderId,
      documentId: parsed.data.documentId,
      kind: parsed.data.kind,
      sourcePath: parsed.data.kind === 'self_inspection' ? (parsed.data.sourcePath ?? null) : null,
      actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
    });
    switch (result.kind) {
      case 'sent':
        if (result.document.delivery === 'sending') {
          waitUntil(
            dispatchPortalOutbox(admin, { env: process.env }).catch((e) => {
              console.error('[portal-documents] utskicket efter dokumentet föll, cron tar det', { error: e instanceof Error ? e.message : e });
            }),
          );
        }
        return ok({ document: result.document, created: result.created }, 201);
      case 'failed':
        return routeError(422, 'portal_document_failed', result.document.error ?? 'Dokumentet kunde inte skickas.', {
          document: result.document,
        });
      case 'blocked':
        return routeError(409, 'portal_document_blocked', result.message);
      case 'not_found':
        return routeError(404, 'portal_job_not_found', 'Ordern kom inte från återförsäljarportalen.');
      case 'forbidden':
        return routeError(403, 'portal_document_forbidden', 'Bara den som har ordern, eller en admin, kan skicka dokument till butiken.');
      case 'no_source':
        return routeError(404, 'portal_document_no_source', 'Det finns ingen egenkontroll på ordern.');
      case 'source_changed':
        return routeError(409, 'portal_document_source_changed', 'En nyare egenkontroll har kommit. Titta på den och skicka igen.');
      case 'wrong_order':
        return routeError(422, 'portal_document_wrong_order', 'Egenkontrollen i kommentarerna gäller en annan order.');
      case 'conflict':
        return routeError(409, 'portal_document_conflict', 'Dokumentet är redan skickat med ett annat innehåll. Ladda om kortet.');
    }
  } catch (e) {
    console.error('[portal-documents] dokumentet kunde inte skickas', { error: e instanceof Error ? e.message : e });
    return routeError(500, 'portal_document_send_failed', 'Dokumentet kunde inte skickas.');
  }
}
