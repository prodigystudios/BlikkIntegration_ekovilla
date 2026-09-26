import { createSessionClient } from '@/lib/supabase/session';
import { sendMaterialOrder } from '@/lib/domains/planning/materialOrdersSend';
import { describeOrderWarning } from '@/lib/domains/planning/materialOrders';
import { logActivity } from '@/lib/domains/planning/activity';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, materialOrderSendSchema } from '../../../_lib';

type RouteContext = { params: { id: string } };

// 15 s mot Resend + läsningar och RPC:er. Plan: maxDuration 30.
export const maxDuration = 30;

// Skicka en materialbeställning till fabriken. Reglerna bor i sendMaterialOrder; här är bara HTTP.
//
// 🧨 SESSIONSKLIENTEN. Spärren (VERCEL_ENV=production OCH MATERIAL_ORDER_SEND_ENABLED=true) prövas i
// domänen FÖRE varje skrivning.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = materialOrderSendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createSessionClient();
    const outcome = await sendMaterialOrder(
      { supabase, env: process.env, today: stockholmTodayISO(), actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null } },
      {
        orderId: context.params.id,
        revision: parsed.data.revision,
        attempt: parsed.data.attempt,
        acknowledgedWarnings: parsed.data.acknowledged_warnings,
      },
    );

    switch (outcome.kind) {
      case 'blocked':
        return routeError(
          503,
          'material_order_send_blocked',
          'Beställningar skickas bara från produktionsmiljön när utskicket är påslaget. Skicka ett testmail till dig själv i stället.',
        );
      case 'not_found':
        return routeError(404, 'material_order_not_found', 'Beställningen finns inte');
      case 'already_sent':
        return ok({ state: 'already_sent' });
      case 'conflict':
        return routeError(409, `material_order_${outcome.code}`, outcome.message);
      case 'acknowledge_required':
        // Varningarna har ändrats sedan sidan visade dem (eller visades aldrig): visa de aktuella och deras avtryck.
        return routeError(409, 'material_order_acknowledge_warnings', 'Ta ställning till varningarna innan beställningen skickas', {
          warnings: outcome.warnings.map((w) => ({ ...w, text: describeOrderWarning(w) })),
          warnings_fingerprint: outcome.fingerprint,
        });
      case 'rejected':
        // attempt: försöket nästa Skicka ska använda — utkastet är tillbaka, med en ny nyckel.
        return routeError(422, 'material_order_rejected', `Mailet avvisades och skickades inte: ${outcome.message}`, {
          code: outcome.code,
          attempt: outcome.attempt,
        });
      case 'unknown':
        // 202: ordern står kvar som "skickas". Ingen logg — vi vet inte om något gick. Försök igen med SAMMA försök
        // efter retry_after_seconds; tidigare svarar databasen "pågår".
        return ok({ state: 'unknown', message: outcome.message, retry_after_seconds: outcome.retry_after_seconds }, 202);
      case 'db_error':
        return routeError(500, 'material_order_send_db_error', outcome.message);
      case 'sent':
        // Bara antal och nummer i loggen: den läses med schedule.read. Aldrig leverantör, adress eller text.
        await logActivity(supabase, gate.currentUser, {
          action: 'material_order.send',
          entityType: 'material_order',
          entityId: context.params.id,
          summary: `Skickade materialbeställning #${outcome.order_no} (${outcome.expected} ${outcome.expected === 1 ? 'rad' : 'rader'})`,
          details: { order_no: outcome.order_no, lines: outcome.expected, expected_created: outcome.created },
        });
        return ok(
          {
            state: 'sent',
            order_no: outcome.order_no,
            created: outcome.created,
            // En depå som raderades mellan claim och finalize hoppas över i databasen. Säg det.
            missing: Math.max(0, outcome.expected - outcome.created),
          },
          201,
        );
    }
  } catch (e: any) {
    return routeError(500, 'material_order_send_unexpected', e?.message || 'Failed to send material order');
  }
}
