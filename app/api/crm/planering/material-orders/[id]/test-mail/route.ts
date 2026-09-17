import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getOrder } from '@/lib/domains/planning/materialOrdersStore';
import { EmailSendError, sendEmail } from '@/lib/email';
import { ok, routeError, invalidUuidParam, requirePermission } from '../../../_lib';

type RouteContext = { params: { id: string } };

// Testmail av en beställnings LAGRADE mail, till den inloggade — aldrig till fabriken.
//
// 🧨 MOTTAGAREN ÄR DIN EGEN ADRESS, ur sessionen. Ingen nyckel, ingen DB-skrivning. Fungerar i alla miljöer
// och är den lokala QA-vägen för beställningsflödet: lokala dev-servern skickar på riktigt, men hit.
export async function POST(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: order, error } = await getOrder(supabase, context.params.id);
    if (error) return routeError(500, 'material_order_read_failed', error.message);
    if (!order) return routeError(404, 'material_order_not_found', 'Beställningen finns inte');
    if (!order.email_subject || !order.email_text) {
      return routeError(409, 'material_order_not_reviewed', 'Beställningen har inget granskat mail — granska den först');
    }

    const { data: auth } = await supabase.auth.getUser();
    const to = auth?.user?.email?.trim();
    if (!to) return routeError(400, 'material_order_test_mail_no_address', 'Ditt konto saknar e-postadress');

    let result;
    try {
      result = await sendEmail({
        to,
        subject: `[TEST – inte skickad till fabriken] ${order.email_subject}`,
        text: `Det här är ett testmail. Det har INTE skickats till ${order.supplier_name ?? 'fabriken'} (${order.recipient_email ?? 'okänd adress'}).\n\n----------------------------------------\n\n${order.email_text}`,
      });
    } catch (e) {
      if (e instanceof EmailSendError) return routeError(502, 'material_order_test_mail_failed', `Testmailet kunde inte skickas: ${e.message}`);
      throw e;
    }
    if (result.skipped) return routeError(503, 'material_order_test_mail_not_configured', 'Mail är inte konfigurerat i den här miljön — inget testmail skickades');
    return ok({ sent_to: to });
  } catch (e: any) {
    return routeError(500, 'material_order_test_mail_unexpected', e?.message || 'Failed to send test mail');
  }
}
