import type { SupabaseClient } from '@supabase/supabase-js';

// Order confirmations (orderbekräftelse) for a scheduled job — the CLIENT-SAFE, pure half: types,
// the per-work-order summary read, and presentation helpers. The actual sending (Twilio/Resend,
// server-only) lives in ./confirmationsSend so this module can be imported by board cards without
// pulling Node-only transports into the browser bundle.

export type ConfirmationChannel = 'email' | 'sms';

// Per-work-order confirmation state shown as a badge on every one of the job's cards.
export type ConfirmationSummary = {
  email_sent_at: string | null;
  email_to: string | null;
  sms_sent_at: string | null;
  sms_to: string | null;
  // Latest SMS delivery status from Twilio (queued/sent/delivered/failed/undelivered), updated by
  // the status callback. Null when no SMS was sent or no status has arrived yet.
  sms_status: string | null;
};

export const EMPTY_CONFIRMATION: ConfirmationSummary = {
  email_sent_at: null,
  email_to: null,
  sms_sent_at: null,
  sms_to: null,
  sms_status: null,
};

type RawConfirmation = {
  work_order_id: string;
  channel: string;
  recipient: string;
  created_at: string;
  status?: string | null;
};

// Pure: reduce confirmation rows into a per-work-order summary (the latest email + latest sms).
// Order-independent — keeps whichever row has the newest created_at per channel.
export function summarizeConfirmations(rows: RawConfirmation[]): Map<string, ConfirmationSummary> {
  const map = new Map<string, ConfirmationSummary>();
  for (const r of rows) {
    const cur = map.get(r.work_order_id) ?? { ...EMPTY_CONFIRMATION };
    if (r.channel === 'email' && (!cur.email_sent_at || r.created_at > cur.email_sent_at)) {
      cur.email_sent_at = r.created_at;
      cur.email_to = r.recipient;
    }
    if (r.channel === 'sms' && (!cur.sms_sent_at || r.created_at > cur.sms_sent_at)) {
      cur.sms_sent_at = r.created_at;
      cur.sms_to = r.recipient;
      cur.sms_status = r.status ?? null;
    }
    map.set(r.work_order_id, cur);
  }
  return map;
}

export type SmsStatusTone = 'ok' | 'fail' | 'pending';

// Pure: map a Twilio SMS status to a Swedish label + tone for the badge. Returns null when there is
// no status to show (so the card falls back to a plain "sent" badge).
export function describeSmsStatus(status: string | null | undefined): { label: string; tone: SmsStatusTone } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'delivered') return { label: 'Levererat', tone: 'ok' };
  if (s === 'failed' || s === 'undelivered') return { label: 'Ej levererat', tone: 'fail' };
  return { label: 'Skickat', tone: 'pending' };
}

export async function confirmationsByWorkOrder(
  supabase: SupabaseClient,
  workOrderIds: string[],
): Promise<Map<string, ConfirmationSummary>> {
  if (workOrderIds.length === 0) return new Map();
  const { data } = await supabase
    .from('ops_work_order_confirmations')
    .select('work_order_id, channel, recipient, created_at, status')
    .in('work_order_id', workOrderIds);
  return summarizeConfirmations((data ?? []) as RawConfirmation[]);
}
