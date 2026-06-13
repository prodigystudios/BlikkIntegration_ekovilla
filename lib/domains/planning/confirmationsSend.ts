import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { toSwedishE164 } from '@/lib/phone';
import { buildPlanningNotificationEmail } from '@/lib/planningNotificationEmail';
import { buildPlanningNotificationSms } from '@/lib/planningNotificationSms';
import type { ConfirmationChannel } from './confirmations';

// Server-only half of order confirmations: build the message from a scheduled job + send it via
// Resend/Twilio + record each successful send. Kept apart from ./confirmations (the client-safe
// summary/presentation half) so the Node-only transports never reach the browser bundle.

// The job fields needed to compose a confirmation, loaded from a segment + its work order + truck.
type SegmentConfirmContext = {
  work_order_id: string;
  project_name: string;
  client_name: string;
  order_number: string;
  fortnox_order_number: string | null;
  start_day: string;
  end_day: string;
  truck_name: string | null;
};

async function loadSegmentContext(
  supabase: SupabaseClient,
  segmentId: string,
): Promise<{ data: SegmentConfirmContext | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('ops_segments')
    .select(
      'work_order_id, start_day, end_day, ' +
        'work_order:crm_work_orders(project_name, client_name, order_number, fortnox_order_number), ' +
        'truck:ops_trucks(name)',
    )
    .eq('id', segmentId)
    .single();
  if (error || !data) return { data: null, error: error ?? { message: 'Segmentet kunde inte hittas' } };

  const row = data as Record<string, any>;
  const wo = Array.isArray(row.work_order) ? row.work_order[0] : row.work_order;
  const truck = Array.isArray(row.truck) ? row.truck[0] : row.truck;
  return {
    data: {
      work_order_id: row.work_order_id,
      project_name: wo?.project_name ?? '',
      client_name: wo?.client_name ?? '',
      order_number: wo?.order_number ?? '',
      fortnox_order_number: wo?.fortnox_order_number ?? null,
      start_day: row.start_day,
      end_day: row.end_day,
      truck_name: truck?.name ?? null,
    },
    error: null,
  };
}

type RecordConfirmationInput = {
  workOrderId: string;
  segmentId: string;
  channel: ConfirmationChannel;
  recipient: string;
  startDay: string;
  endDay: string;
  providerMessageId: string | null;
  status: string | null;
  actorUserId: string;
};

async function recordConfirmation(
  supabase: SupabaseClient,
  input: RecordConfirmationInput,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('ops_work_order_confirmations').insert({
    work_order_id: input.workOrderId,
    segment_id: input.segmentId,
    channel: input.channel,
    recipient: input.recipient,
    start_day: input.startDay,
    end_day: input.endDay,
    provider_message_id: input.providerMessageId,
    status: input.status,
    created_by: input.actorUserId,
  });
  return { error: error ?? null };
}

export type SendConfirmationInput = {
  segmentId: string;
  sendEmail: boolean;
  recipientEmail: string | null;
  sendSms: boolean;
  recipientPhone: string | null;
  customMessage: string | null;
  actorUserId: string;
  actorName: string | null;
};

export type SendConfirmationResult = {
  // `recorded` is false when the message was sent but its audit row failed to persist — the caller
  // must warn the planner NOT to re-send (the customer was already contacted, just not logged).
  email: { sent: boolean; recorded: boolean; error: string | null };
  sms: { sent: boolean; recorded: boolean; status: string | null; error: string | null };
};

// Build + send the requested channels, recording each successful send. Channels are independent: a
// failure in one (e.g. SMS not configured) is returned as an error and never blocks the other.
// Note: sendEmail is a no-op in non-production when Resend isn't configured (it logs and resolves),
// so a dev "sent" reflects the app-wide email stub — production really sends.
export async function sendOrderConfirmation(
  supabase: SupabaseClient,
  input: SendConfirmationInput,
): Promise<{ data: SendConfirmationResult | null; error: { message: string } | null }> {
  const { data: ctx, error: ctxErr } = await loadSegmentContext(supabase, input.segmentId);
  if (ctxErr || !ctx) return { data: null, error: ctxErr };

  // The reference the business follows: the Fortnox order number when synced, else the internal AO.
  const orderNumber = ctx.fortnox_order_number || ctx.order_number || null;
  const customerName = ctx.client_name || null;
  const result: SendConfirmationResult = {
    email: { sent: false, recorded: false, error: null },
    sms: { sent: false, recorded: false, status: null, error: null },
  };

  if (input.sendEmail && input.recipientEmail) {
    try {
      const { subject, html, text } = buildPlanningNotificationEmail({
        recipientEmail: input.recipientEmail,
        projectName: ctx.project_name,
        customerName,
        orderNumber,
        startDay: ctx.start_day,
        endDay: ctx.end_day,
        truck: ctx.truck_name,
        salesResponsible: input.actorName,
        customMessage: input.customMessage,
      });
      await sendEmail({ to: input.recipientEmail, subject, html, text });
      result.email.sent = true;
      const rec = await recordConfirmation(supabase, {
        workOrderId: ctx.work_order_id,
        segmentId: input.segmentId,
        channel: 'email',
        recipient: input.recipientEmail,
        startDay: ctx.start_day,
        endDay: ctx.end_day,
        providerMessageId: null,
        status: null,
        actorUserId: input.actorUserId,
      });
      result.email.recorded = !rec.error;
      if (rec.error) {
        console.error('[planning] confirmation email sent but not recorded:', rec.error.message);
        result.email.error = 'Skickat, men kunde inte loggas — skicka inte igen.';
      }
    } catch (e: any) {
      result.email.error = e?.message || 'Mejlet kunde inte skickas';
    }
  }

  if (input.sendSms && input.recipientPhone) {
    // Twilio needs E.164 (+46…); normalise the Swedish number the planner typed so a plain
    // "0701234567" / "070-123 45 67" isn't rejected as invalid.
    const to = toSwedishE164(input.recipientPhone);
    if (!to) {
      result.sms.error = 'Ogiltigt telefonnummer';
    } else try {
      const body = buildPlanningNotificationSms({
        projectName: ctx.project_name,
        orderNumber,
        customerName,
        startDay: ctx.start_day,
        endDay: ctx.end_day,
        truck: ctx.truck_name,
        salesResponsible: input.actorName,
      });
      const res = await sendSms({ to, body });
      result.sms.sent = true;
      result.sms.status = res.status;
      const rec = await recordConfirmation(supabase, {
        workOrderId: ctx.work_order_id,
        segmentId: input.segmentId,
        channel: 'sms',
        recipient: to,
        startDay: ctx.start_day,
        endDay: ctx.end_day,
        providerMessageId: res.sid,
        status: res.status,
        actorUserId: input.actorUserId,
      });
      result.sms.recorded = !rec.error;
      if (rec.error) {
        console.error('[planning] confirmation SMS sent but not recorded:', rec.error.message);
        result.sms.error = 'Skickat, men kunde inte loggas — skicka inte igen.';
      }
    } catch (e: any) {
      result.sms.error = e?.message || 'SMS kunde inte skickas';
    }
  }

  return { data: result, error: null };
}
