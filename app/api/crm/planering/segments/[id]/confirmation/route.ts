import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getWorkOrderCustomerContact } from '@/lib/domains/crm/work-orders';
import { sendOrderConfirmation } from '@/lib/domains/planning/confirmations';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, sendConfirmationSchema } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Prepare data for the confirmation modal: the CRM customer's contact (recipient) + the placement's
// date range. The recipient comes straight from the CRM customer — the CRM-first source of truth.
export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.read');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: seg, error: segErr } = await supabase
      .from('ops_segments')
      .select('work_order_id, start_day, end_day')
      .eq('id', context.params.id)
      .single();
    if (segErr || !seg) return routeError(404, 'planning_segment_not_found', 'Segmentet kunde inte hittas');

    const { data: contact } = await getWorkOrderCustomerContact(supabase, (seg as { work_order_id: string }).work_order_id);
    return ok({
      contact: contact ?? { contactName: null, phone: null, email: null },
      start_day: (seg as { start_day: string }).start_day,
      end_day: (seg as { end_day: string }).end_day,
    });
  } catch (e: any) {
    return routeError(500, 'planning_confirmation_prepare_unexpected', e?.message || 'Failed to prepare confirmation');
  }
}

// Send the order confirmation (email and/or SMS) to the customer and record it.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.schedule.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = sendConfirmationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const { send_email, recipient_email, send_sms, recipient_phone, custom_message } = parsed.data;
    if (!send_email && !send_sms) return routeError(400, 'no_channel', 'Välj minst en kanal (mejl eller SMS).');
    if (send_email && !recipient_email) return routeError(400, 'missing_email', 'Ange en e-postadress för mejlet.');
    if (send_sms && !recipient_phone) return routeError(400, 'missing_phone', 'Ange ett telefonnummer för SMS:et.');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await sendOrderConfirmation(supabase, {
      segmentId: context.params.id,
      sendEmail: send_email,
      recipientEmail: recipient_email ?? null,
      sendSms: send_sms,
      recipientPhone: recipient_phone ?? null,
      customMessage: custom_message ?? null,
      actorUserId: gate.currentUser.id,
      actorName: gate.currentUser.name ?? null,
    });
    if (error) return routeError(500, 'planning_confirmation_send_failed', error.message);

    return ok({ result: data });
  } catch (e: any) {
    return routeError(500, 'planning_confirmation_send_unexpected', e?.message || 'Failed to send confirmation');
  }
}
