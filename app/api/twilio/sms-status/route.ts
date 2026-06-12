import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function getRequestUrl(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!host) return req.url;
  return `${proto}://${host}${req.nextUrl.pathname}`;
}

function firstField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

const twilioStatusSchema = z.object({
  MessageSid: z.string().trim().min(1, 'Missing MessageSid'),
  MessageStatus: z.string().trim().min(1, 'Missing MessageStatus'),
  ErrorCode: z.string().trim().optional().nullable(),
  ErrorMessage: z.string().trim().optional().nullable(),
});

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getOptionalSupabaseAdmin();
    if (!supabase) {
      return routeError(500, 'service_role_missing', 'Server not configured');
    }

    const authToken = env('TWILIO_AUTH_TOKEN');
    const signature = req.headers.get('x-twilio-signature') || '';
    if (!authToken || !signature) {
      return routeError(401, 'signature_config_missing', 'Missing Twilio signature configuration');
    }

    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') params[key] = value;
    }

    const twilioModule = await import('twilio');
    const isValid = twilioModule.validateRequest(authToken, signature, getRequestUrl(req), params);
    if (!isValid) {
      return routeError(403, 'invalid_twilio_signature', 'Invalid Twilio signature');
    }

    const parsed = twilioStatusSchema.safeParse({
      MessageSid: firstField(form.get('MessageSid')),
      MessageStatus: firstField(form.get('MessageStatus')),
      ErrorCode: firstField(form.get('ErrorCode')),
      ErrorMessage: firstField(form.get('ErrorMessage')),
    });
    if (!parsed.success) {
      return routeError(400, 'validation_error', 'Missing Twilio payload fields', parsed.error.flatten());
    }

    const { MessageSid: messageSid, MessageStatus: messageStatus, ErrorCode: errorCode, ErrorMessage: errorMessage } = parsed.data;

    const { error } = await supabase
      .from('planning_project_meta')
      .update({
        sms_delivery_status: messageStatus,
        sms_last_error: errorMessage || errorCode || null,
      })
      .eq('sms_provider_message_id', messageSid);

    if (error) throw error;

    // Also update the new CRM-first planning's confirmation log (Wave 7). A given MessageSid lives
    // in at most one of the two tables, so both updates are safe no-ops otherwise. Best-effort —
    // never let the new table break the established callback.
    const { error: opsError } = await supabase
      .from('ops_work_order_confirmations')
      .update({ status: messageStatus })
      .eq('provider_message_id', messageSid);
    if (opsError) console.error('[api/twilio/sms-status] ops_work_order_confirmations update failed', opsError);

    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    console.error('[api/twilio/sms-status] error', e);
    return routeError(500, 'twilio_status_failed', String(e?.message || e || 'Unknown error'));
  }
}
